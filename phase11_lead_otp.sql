-- =====================================================================
-- Phase 11: Email OTP for the website enquiry forms + Leads tab
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor for
-- this project and run it once. It only ADDS tables, columns, indexes,
-- functions and policies — it does not delete any existing row.
-- Safe to re-run.
--
-- What it adds:
--   lead_statuses        the statuses an assistant can give a lead (New,
--                        Contacted, Follow-up, ...). Editable later in the
--                        Table Editor without any code change: rename a
--                        label, reorder with sort_order, or hide one with
--                        is_active = false. Don't delete a status that
--                        leads still use (the database will refuse).
--   marketing_leads      + email_verified, verified_at, consent_at, status,
--                        follow_up_on, notes, updated_at, updated_by
--   lead_otp_requests    one row per verification code emailed by the
--                        lead-otp Edge Function. Only a hash of the code is
--                        stored. Server-only: no browser can read it.
--   lead_form_attempts   one row per form action, used only for rate
--                        limits (stores a one-way hash of the IP, never
--                        the IP itself). Server-only.
--
-- Functions:
--   lead_attempt()           rate-limit check + record     (server-only)
--   lead_record()            create/update a lead          (server-only)
--   lead_otp_verify()        check a code, atomically      (server-only)
--   lead_otp_purge()         delete expired OTP/rate rows  (server-only)
--   update_marketing_lead()  status / follow-up / notes    (assistants)
--
-- Access model:
--   * Assistants can read every lead and change only its status,
--     follow-up date and notes (through update_marketing_lead).
--   * Website visitors no longer write to these tables directly — the
--     lead-otp Edge Function does it with the service role, after
--     validating every field and (for brochure/demo) the email OTP.
--   * The old "Public can submit a marketing lead" policy is kept for now
--     so the forms already in use keep working until the new site is
--     live, but it is narrowed here so it can no longer set any of the
--     new columns (e.g. it cannot mark a lead as email-verified). Run
--     phase12_close_public_lead_inserts.sql after the new site is live
--     to remove it.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. LEAD STATUSES
-- ---------------------------------------------------------------------
create table if not exists public.lead_statuses (
  key text primary key check (key ~ '^[a-z][a-z_]{1,29}$'),
  label text not null check (char_length(label) between 1 and 40),
  description text,
  stage text not null default 'open' check (stage in ('open', 'won', 'lost')),
  sort_order int not null default 0,
  is_active boolean not null default true
);

-- Seeded once. ON CONFLICT DO NOTHING means re-running this file never
-- overwrites labels the institute has edited since.
insert into public.lead_statuses (key, label, description, stage, sort_order) values
  ('new',            'New',            'Not contacted yet',                               'open', 10),
  ('contacted',      'Contacted',      'Spoke to them or got a reply',                    'open', 20),
  ('not_reachable',  'Not reachable',  'Call not answered, busy or switched off',         'open', 30),
  ('follow_up',      'Follow-up',      'Call again on the follow-up date',                'open', 40),
  ('interested',     'Interested',     'Wants to join and is deciding',                   'open', 50),
  ('demo_scheduled', 'Demo scheduled', 'A demo lecture date is fixed',                    'open', 60),
  ('enrolled',       'Enrolled',       'Joined a program',                                'won',  70),
  ('not_interested', 'Not interested', 'Decided not to join',                             'lost', 80),
  ('invalid',        'Invalid / junk', 'Wrong number, fake or test entry',                'lost', 90)
on conflict (key) do nothing;

alter table public.lead_statuses enable row level security;

drop policy if exists "Assistants can view lead statuses" on public.lead_statuses;
create policy "Assistants can view lead statuses" on public.lead_statuses
  for select to authenticated
  using (public.current_role() = 'assistant');


-- ---------------------------------------------------------------------
-- 2. MARKETING LEADS: new columns
--    Existing rows get email_verified = false and status = 'new'.
-- ---------------------------------------------------------------------
alter table public.marketing_leads
  add column if not exists email_verified boolean not null default false,
  add column if not exists verified_at timestamptz,
  add column if not exists consent_at timestamptz,
  add column if not exists status text not null default 'new',
  add column if not exists follow_up_on date,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'marketing_leads_status_fkey') then
    alter table public.marketing_leads
      add constraint marketing_leads_status_fkey
      foreign key (status) references public.lead_statuses (key) on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'marketing_leads_notes_length') then
    alter table public.marketing_leads
      add constraint marketing_leads_notes_length check (notes is null or char_length(notes) <= 2000);
  end if;
end $$;

create index if not exists marketing_leads_created_idx on public.marketing_leads (created_at desc);
create index if not exists marketing_leads_email_source_idx on public.marketing_leads (lower(email), source, created_at desc);
create index if not exists marketing_leads_status_idx on public.marketing_leads (status);

-- Assistants can read every lead. They still cannot INSERT/UPDATE/DELETE
-- directly (no such policy) — edits go through update_marketing_lead().
drop policy if exists "Assistants can view leads" on public.marketing_leads;
create policy "Assistants can view leads" on public.marketing_leads
  for select to authenticated
  using (public.current_role() = 'assistant');

-- Narrow the legacy public insert to the columns the old forms send, so
-- nobody can insert a lead that claims to be email-verified, carries a
-- status, notes, etc. Removed entirely by phase12.
revoke insert on public.marketing_leads from anon, authenticated;
grant insert (name, email, mobile, program, source, education_status)
  on public.marketing_leads to anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. OTP REQUESTS (server-only)
--    The visitor's details are stored with the code, so whatever was
--    verified is exactly what becomes the lead — the browser can't swap
--    the email or number between "send code" and "verify".
-- ---------------------------------------------------------------------
create table if not exists public.lead_otp_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  name text not null,
  mobile text not null,
  program text not null,
  source text not null,
  education_status text,
  consent_at timestamptz,
  sent_via text check (sent_via in ('resend', 'smtp')),
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  lead_id uuid references public.marketing_leads (id) on delete set null,
  -- "Remember this browser": a verified visitor's browser keeps a random
  -- token (only its hash is stored here) so the same person isn't asked
  -- for a new code on every form until trusted_until.
  trust_token_hash text,
  trusted_until timestamptz
);

create index if not exists lead_otp_requests_email_idx on public.lead_otp_requests (email, created_at desc);
create index if not exists lead_otp_requests_created_idx on public.lead_otp_requests (created_at);
create unique index if not exists lead_otp_requests_trust_idx
  on public.lead_otp_requests (trust_token_hash) where trust_token_hash is not null;

alter table public.lead_otp_requests enable row level security;
revoke all on public.lead_otp_requests from anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. RATE-LIMIT LOG (server-only)
-- ---------------------------------------------------------------------
create table if not exists public.lead_form_attempts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('code', 'submit', 'verify')),
  ip_hash text,
  email text,
  created_at timestamptz not null default now()
);

create index if not exists lead_form_attempts_ip_idx on public.lead_form_attempts (kind, ip_hash, created_at desc);
create index if not exists lead_form_attempts_email_idx on public.lead_form_attempts (kind, email, created_at desc);
create index if not exists lead_form_attempts_created_idx on public.lead_form_attempts (created_at);

alter table public.lead_form_attempts enable row level security;
revoke all on public.lead_form_attempts from anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. lead_attempt(): checks the limits and, only if allowed, records the
--    attempt — in one locked step, so two requests at the same instant
--    can't both slip under a limit. The numbers live in the Edge Function
--    (see LIMITS in supabase/functions/lead-otp/index.ts); pass null to
--    skip a check. Returns {allowed, reason, retry_after (seconds)}.
-- ---------------------------------------------------------------------
create or replace function public.lead_attempt(
  p_kind text,
  p_ip_hash text,
  p_email text,
  p_ip_per_hour int,
  p_email_per_hour int,
  p_email_per_day int,
  p_cooldown_seconds int,
  p_global_per_day int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_oldest timestamptz;
  v_last timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('lead_attempt:' || p_kind || ':' || coalesce(p_email, p_ip_hash, '')));

  if p_ip_hash is not null and p_ip_per_hour is not null then
    select count(*), min(created_at) into v_count, v_oldest
      from public.lead_form_attempts
     where kind = p_kind and ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if v_count >= p_ip_per_hour then
      return jsonb_build_object('allowed', false, 'reason', 'ip_hour',
        'retry_after', greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - now())))));
    end if;
  end if;

  if p_email is not null and p_cooldown_seconds is not null then
    select max(created_at) into v_last
      from public.lead_form_attempts
     where kind = p_kind and email = p_email;
    if v_last is not null and v_last > now() - make_interval(secs => p_cooldown_seconds) then
      return jsonb_build_object('allowed', false, 'reason', 'cooldown',
        'retry_after', greatest(1, ceil(extract(epoch from (v_last + make_interval(secs => p_cooldown_seconds) - now())))));
    end if;
  end if;

  if p_email is not null and p_email_per_hour is not null then
    select count(*), min(created_at) into v_count, v_oldest
      from public.lead_form_attempts
     where kind = p_kind and email = p_email and created_at > now() - interval '1 hour';
    if v_count >= p_email_per_hour then
      return jsonb_build_object('allowed', false, 'reason', 'email_hour',
        'retry_after', greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - now())))));
    end if;
  end if;

  if p_email is not null and p_email_per_day is not null then
    select count(*), min(created_at) into v_count, v_oldest
      from public.lead_form_attempts
     where kind = p_kind and email = p_email and created_at > now() - interval '1 day';
    if v_count >= p_email_per_day then
      return jsonb_build_object('allowed', false, 'reason', 'email_day',
        'retry_after', greatest(1, ceil(extract(epoch from (v_oldest + interval '1 day' - now())))));
    end if;
  end if;

  if p_global_per_day is not null then
    select count(*) into v_count
      from public.lead_form_attempts
     where kind = p_kind and created_at > now() - interval '1 day';
    if v_count >= p_global_per_day then
      return jsonb_build_object('allowed', false, 'reason', 'global_day', 'retry_after', 3600);
    end if;
  end if;

  insert into public.lead_form_attempts (kind, ip_hash, email) values (p_kind, p_ip_hash, p_email);
  return jsonb_build_object('allowed', true);
end;
$$;


-- ---------------------------------------------------------------------
-- 6. lead_record(): creates a lead, or — if the same email already used
--    the same form in the last 24 hours — updates that row instead of
--    adding a duplicate (double clicks, a second brochure download, a
--    corrected mobile number). Details that were email-verified are
--    never overwritten by an unverified submission.
-- ---------------------------------------------------------------------
create or replace function public.lead_record(
  p_name text,
  p_email text,
  p_mobile text,
  p_program text,
  p_source text,
  p_education_status text,
  p_consent_at timestamptz,
  p_verified boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.marketing_leads%rowtype;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('lead_record:' || lower(p_email) || ':' || p_source));

  select * into v_existing
    from public.marketing_leads
   where lower(email) = lower(p_email)
     and source = p_source
     and created_at > now() - interval '24 hours'
   order by created_at desc
   limit 1
   for update;

  if found then
    if v_existing.email_verified and not p_verified then
      return v_existing.id;
    end if;

    update public.marketing_leads
       set name = p_name,
           mobile = p_mobile,
           program = p_program,
           education_status = coalesce(p_education_status, education_status),
           consent_at = coalesce(p_consent_at, consent_at),
           email_verified = email_verified or p_verified,
           verified_at = case when p_verified and not email_verified then now() else verified_at end
     where id = v_existing.id;
    return v_existing.id;
  end if;

  insert into public.marketing_leads
    (name, email, mobile, program, source, education_status, consent_at, email_verified, verified_at)
  values
    (p_name, p_email, p_mobile, p_program, p_source, p_education_status, p_consent_at, p_verified,
     case when p_verified then now() end)
  returning id into v_id;

  return v_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 7. lead_otp_verify(): checks a code with the row locked, so parallel
--    guesses can't get more than 5 tries between them. On success the
--    lead is recorded as email-verified and the code can't be reused.
--    Returns {status: verified | wrong_code | locked | expired | used |
--    not_found, attempts_left?, lead_id?}.
-- ---------------------------------------------------------------------
create or replace function public.lead_otp_verify(
  p_request_id uuid,
  p_code_hash text,
  p_trust_token_hash text,
  p_trust_days int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_max_attempts constant int := 5;
  r public.lead_otp_requests%rowtype;
  v_lead uuid;
begin
  select * into r from public.lead_otp_requests where id = p_request_id for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if r.verified_at is not null then
    return jsonb_build_object('status', 'used');
  end if;
  if r.attempts >= c_max_attempts then
    return jsonb_build_object('status', 'locked');
  end if;
  if r.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;

  if r.code_hash <> p_code_hash then
    update public.lead_otp_requests set attempts = attempts + 1 where id = r.id;
    if r.attempts + 1 >= c_max_attempts then
      return jsonb_build_object('status', 'locked');
    end if;
    return jsonb_build_object('status', 'wrong_code', 'attempts_left', c_max_attempts - r.attempts - 1);
  end if;

  v_lead := public.lead_record(r.name, r.email, r.mobile, r.program, r.source, r.education_status, r.consent_at, true);

  update public.lead_otp_requests
     set verified_at = now(),
         lead_id = v_lead,
         trust_token_hash = p_trust_token_hash,
         trusted_until = case when p_trust_token_hash is null then null
                              else now() + make_interval(days => coalesce(p_trust_days, 30)) end
   where id = r.id;

  return jsonb_build_object('status', 'verified', 'lead_id', v_lead);
end;
$$;


-- ---------------------------------------------------------------------
-- 8. lead_otp_purge(): housekeeping, called now and then by the Edge
--    Function. Rate-limit rows are only needed for a day; OTP rows hold a
--    copy of the visitor's details, so they're deleted a day after they
--    were created unless they back a still-valid "remember this browser"
--    token. The lead itself (marketing_leads) is never touched.
-- ---------------------------------------------------------------------
create or replace function public.lead_otp_purge()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.lead_form_attempts where created_at < now() - interval '2 days';
  delete from public.lead_otp_requests
   where created_at < now() - interval '1 day'
     and (trusted_until is null or trusted_until < now());
$$;


-- Server-only functions: only the Edge Function (service role) may call
-- them. Supabase grants EXECUTE on new functions to anon/authenticated
-- by default, so revoke explicitly.
revoke all on function public.lead_attempt(text, text, text, int, int, int, int, int) from public, anon, authenticated;
revoke all on function public.lead_record(text, text, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.lead_otp_verify(uuid, text, text, int) from public, anon, authenticated;
revoke all on function public.lead_otp_purge() from public, anon, authenticated;
grant execute on function public.lead_attempt(text, text, text, int, int, int, int, int) to service_role;
grant execute on function public.lead_record(text, text, text, text, text, text, timestamptz, boolean) to service_role;
grant execute on function public.lead_otp_verify(uuid, text, text, int) to service_role;
grant execute on function public.lead_otp_purge() to service_role;


-- ---------------------------------------------------------------------
-- 9. update_marketing_lead(): the only way an assistant edits a lead.
--    p_changes holds just the fields being changed, e.g.
--      {"status": "contacted"}
--      {"follow_up_on": "2026-10-20", "notes": "Call after 6pm"}
--    so changing a status from the table never overwrites notes another
--    assistant saved a moment earlier. Empty follow_up_on / notes clear
--    the field.
-- ---------------------------------------------------------------------
create or replace function public.update_marketing_lead(p_lead_id uuid, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() is distinct from 'assistant' then
    raise exception 'Only assistants can update leads.' using errcode = '42501';
  end if;

  if p_changes ? 'status'
     and not exists (select 1 from public.lead_statuses where key = p_changes->>'status') then
    raise exception 'Unknown lead status.' using errcode = '22023';
  end if;

  if p_changes ? 'notes' and char_length(coalesce(p_changes->>'notes', '')) > 2000 then
    raise exception 'Notes can be at most 2000 characters.' using errcode = '22001';
  end if;

  update public.marketing_leads
     set status = case when p_changes ? 'status' then p_changes->>'status' else status end,
         follow_up_on = case when p_changes ? 'follow_up_on'
                             then nullif(p_changes->>'follow_up_on', '')::date else follow_up_on end,
         notes = case when p_changes ? 'notes'
                      then nullif(btrim(p_changes->>'notes'), '') else notes end,
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_lead_id;

  if not found then
    raise exception 'Lead not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.update_marketing_lead(uuid, jsonb) from public, anon;
grant execute on function public.update_marketing_lead(uuid, jsonb) to authenticated;


-- Make the new tables/functions visible to the API straight away.
notify pgrst, 'reload schema';
