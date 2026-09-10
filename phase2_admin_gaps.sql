-- =====================================================================
-- Phase 2: Close the handover gaps — course management and assistant
--          promotion, both now doable from inside the app so the
--          incoming assistant never needs Supabase dashboard access
--          for routine admin work.
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor for
-- this project and run it once. Like phase1, it only adds/replaces
-- objects (columns with IF NOT EXISTS, functions with CREATE OR
-- REPLACE, policies with DROP POLICY IF EXISTS + CREATE) — nothing
-- here deletes existing rows or tables. Safe to re-run.
--
-- ONE MANUAL DASHBOARD STEP THIS FILE CANNOT DO (see bottom of file):
-- turning off "Confirm email" for the Email provider, so new student
-- and assistant accounts created by an assistant can log in right
-- away without you manually confirming them in Supabase Auth.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. COURSES: archive flag instead of hard delete
--    Courses are referenced by enrollments with ON DELETE CASCADE, so
--    deleting a course would silently wipe every enrollment/payment
--    tied to it. "Delete" in the UI instead sets is_active = false —
--    the course disappears from the "add student" picker but every
--    past enrollment, payment and receipt referencing it is untouched.
-- ---------------------------------------------------------------------
alter table public.courses
  add column if not exists is_active boolean not null default true;

-- Assistants can create/edit/archive courses; the existing "viewable
-- by everyone" SELECT policy from init.sql is untouched (kept for the
-- marketing site and any other public read), this just adds write
-- access scoped to the assistant role.
drop policy if exists "Assistants can manage courses" on public.courses;
create policy "Assistants can manage courses" on public.courses
  for all
  using (public.current_role() = 'assistant')
  with check (public.current_role() = 'assistant');


-- ---------------------------------------------------------------------
-- 2. PROMOTING A USER TO ASSISTANT — now an RPC instead of a manual
--    SQL UPDATE. Still gated to existing assistants only (an assistant
--    account can only ever be created by another assistant, or by you
--    once via the SQL editor to bootstrap the very first one — see
--    the note at the bottom of phase1_student_assistant.sql).
-- ---------------------------------------------------------------------
create or replace function public.register_assistant(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'assistant' then
    raise exception 'Only assistants can create other assistant accounts';
  end if;

  update public.profiles
  set role = 'assistant',
      email = lower(p_email),
      full_name = coalesce(p_full_name, full_name),
      phone = coalesce(p_phone, phone),
      created_by = auth.uid()
  where id = p_user_id;

  if not found then
    raise exception 'No profile found for that user id — the auth signup step may have failed';
  end if;
end;
$$;

grant execute on function public.register_assistant(uuid, text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. FIX: students with no enrollment yet were invisible to assistants
--    assistant_student_overview used an INNER JOIN to enrollments, so
--    a student whose enrollment step failed or was skipped (e.g. no
--    course selected, or the register_student_full bug fixed above)
--    silently disappeared from the assistant's table entirely, even
--    though their login worked fine. Switched to LEFT JOINs so every
--    student with a profile always shows up, with blank program/fee
--    fields when there's genuinely no enrollment yet.
-- ---------------------------------------------------------------------
-- Postgres won't let CREATE OR REPLACE VIEW change an existing column's
-- type (the coalesce() below turns total_fee from numeric(10,2) into
-- plain numeric), so drop it first instead.
drop view if exists public.assistant_student_overview;

create view public.assistant_student_overview
with (security_invoker = true) as
select
  pr.id as profile_id,
  pr.student_id,
  pr.full_name,
  pr.email,
  pr.phone,
  e.id as enrollment_id,
  e.status as enrollment_status,
  c.id as course_id,
  c.title as program,
  coalesce(s.total_fee, 0) as total_fee,
  coalesce(s.total_paid, 0) as total_paid,
  coalesce(s.balance, 0) as balance,
  coalesce(s.status, 'UNPAID') as status
from public.profiles pr
left join public.enrollments e on e.student_id = pr.id
left join public.courses c on c.id = e.course_id
left join public.enrollment_payment_summary s on s.enrollment_id = e.id
where pr.role = 'student';

-- Lets the assistant fix a student who has no enrollment yet, directly
-- from the "Manage Enrollment" action — inserts one if none exists,
-- otherwise behaves like update_enrollment.
create or replace function public.assign_enrollment(
  p_student_id uuid,
  p_course_id uuid,
  p_total_fee numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'assistant' then
    raise exception 'Only assistants can manage enrollments';
  end if;

  insert into public.enrollments (student_id, course_id, total_fee)
  values (p_student_id, p_course_id, coalesce(p_total_fee, 0))
  on conflict (student_id, course_id) do update set total_fee = excluded.total_fee;
end;
$$;

grant execute on function public.assign_enrollment(uuid, uuid, numeric) to authenticated;


-- =====================================================================
-- MANUAL STEP — disable email confirmation (do this once, in the
-- Supabase Dashboard, not in SQL):
--
--   Authentication -> Sign In / Providers -> Email -> turn OFF
--   "Confirm email"
--
-- Every student and assistant account here is created by an assistant
-- who already typed in a known, verified email address — there is no
-- public self-signup flow this could be abused through — so requiring
-- email confirmation adds friction without adding real security.
-- With it off, a newly created account can sign in immediately, and
-- the "Email not confirmed" error on the login page (and the manual
-- confirm-in-Supabase-Auth workaround) goes away entirely.
-- =====================================================================
