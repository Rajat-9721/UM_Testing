-- =====================================================================
-- Phase 1: Authorization fix + Student Management + Enrollments +
--          Fee/Payment tracking + Receipts
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor for
-- this project and run it once. It only adds/replaces objects (columns
-- with IF NOT EXISTS, functions with CREATE OR REPLACE, policies with
-- DROP POLICY IF EXISTS + CREATE) — nothing here deletes existing rows
-- or tables. Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TRUSTED ROLE CHECK
--    Replaces the vulnerable `auth.jwt() -> user_metadata ->> role`
--    check (user_metadata is end-user-editable). profiles.role is the
--    source of truth from here on — it has no INSERT/UPDATE policy for
--    ordinary users, so it cannot be self-edited by a student.
-- ---------------------------------------------------------------------
create or replace function public.current_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

grant execute on function public.current_role() to authenticated;


-- ---------------------------------------------------------------------
-- 2. AUTO-CREATE A PROFILE ROW FOR EVERY NEW AUTH USER
--    Defaults to role='student' (least privilege). Promoting a user to
--    'assistant' is a deliberate manual step (see notes at the bottom
--    of this file) — never something reachable from client code.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, lower(new.email), 'student')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();


-- ---------------------------------------------------------------------
-- 3. PROFILES: new columns for student management
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists student_id text unique,
  add column if not exists full_name text,
  add column if not exists phone text,
  add column if not exists must_change_password boolean not null default true,
  add column if not exists created_by uuid references public.profiles(id);

-- Note: must_change_password is stored now but NOT enforced yet — the
-- forced-password-change + OTP flow is a future phase, deferred per
-- instruction. No UI currently reads this column.

create sequence if not exists public.student_id_seq;

create or replace function public.generate_student_id()
returns text
language plpgsql
as $$
begin
  return 'UM' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.student_id_seq')::text, 4, '0');
end;
$$;


-- ---------------------------------------------------------------------
-- 4. ENROLLMENTS: fee + lifecycle fields
-- ---------------------------------------------------------------------
alter table public.enrollments
  add column if not exists total_fee numeric(10,2) not null default 0,
  add column if not exists status text not null default 'active' check (status in ('active','completed','withdrawn')),
  add column if not exists enrolled_at timestamptz not null default timezone('utc', now());


-- ---------------------------------------------------------------------
-- 5. PAYMENTS
--    Columns entry_method / source_attachment_url / ocr_raw_extract are
--    unused placeholders for the future screenshot-OCR feature — no
--    OCR logic exists, this just avoids a schema migration later.
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id uuid default uuid_generate_v4() primary key,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  payment_date date not null default current_date,
  payment_method text not null check (payment_method in ('cash','upi','netbanking','bank_transfer','cheque')),
  reference_number text,
  cheque_bank_name text,
  cheque_date date,
  internal_note text,
  recorded_by uuid references public.profiles(id),
  receipt_number text unique,
  entry_method text not null default 'manual' check (entry_method in ('manual','screenshot_ocr')),
  source_attachment_url text,
  ocr_raw_extract jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create sequence if not exists public.receipt_number_seq;

alter table public.payments enable row level security;


-- ---------------------------------------------------------------------
-- 6. DERIVED STATUS VIEWS
--    status/total_paid/balance are NEVER stored — always computed here,
--    so an assistant can never manually set an incorrect status.
--    security_invoker=true is required (PG15+) so these views enforce
--    the *querying user's* RLS, not the view owner's — without it,
--    every authenticated user could see every student's data through
--    the view regardless of the policies below.
-- ---------------------------------------------------------------------
create or replace view public.enrollment_payment_summary
with (security_invoker = true) as
select
  e.id as enrollment_id,
  e.student_id,
  e.course_id,
  e.total_fee,
  coalesce(sum(p.amount), 0) as total_paid,
  e.total_fee - coalesce(sum(p.amount), 0) as balance,
  case
    when coalesce(sum(p.amount), 0) <= 0 then 'UNPAID'
    when coalesce(sum(p.amount), 0) < e.total_fee then 'PARTIALLY_PAID'
    else 'PAID'
  end as status
from public.enrollments e
left join public.payments p on p.enrollment_id = e.id
group by e.id, e.student_id, e.course_id, e.total_fee;

create or replace view public.assistant_student_overview
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
  s.total_fee,
  s.total_paid,
  s.balance,
  s.status
from public.profiles pr
join public.enrollments e on e.student_id = pr.id
join public.courses c on c.id = e.course_id
join public.enrollment_payment_summary s on s.enrollment_id = e.id
where pr.role = 'student';

-- Per-payment view with the running (point-in-time) cumulative total,
-- so a receipt reflects the fee status AS OF that payment, not the
-- account's current status if later payments have since been made.
create or replace view public.payment_receipts
with (security_invoker = true) as
select
  p.id as payment_id,
  p.receipt_number,
  p.amount,
  p.payment_date,
  p.payment_method,
  p.reference_number,
  p.cheque_bank_name,
  p.cheque_date,
  p.internal_note,
  p.created_at,
  e.id as enrollment_id,
  e.student_id,
  e.total_fee,
  c.title as program_title,
  pr.full_name as student_name,
  pr.student_id as student_code,
  pr.email as student_email,
  sum(p.amount) over (
    partition by p.enrollment_id order by p.created_at
    rows between unbounded preceding and current row
  ) as cumulative_paid_at_payment,
  e.total_fee - sum(p.amount) over (
    partition by p.enrollment_id order by p.created_at
    rows between unbounded preceding and current row
  ) as balance_after_payment,
  case
    when sum(p.amount) over (
      partition by p.enrollment_id order by p.created_at
      rows between unbounded preceding and current row
    ) < e.total_fee then 'PARTIALLY_PAID'
    else 'PAID'
  end as status_after_payment
from public.payments p
join public.enrollments e on e.id = p.enrollment_id
join public.courses c on c.id = e.course_id
join public.profiles pr on pr.id = e.student_id;


-- ---------------------------------------------------------------------
-- 7. RLS POLICIES
--    All writes stay behind SECURITY DEFINER RPCs (section 8) — no
--    INSERT/UPDATE policy is granted here for profiles/enrollments/
--    payments, matching the existing choke-point pattern. This section
--    only adds the read access assistants need.
-- ---------------------------------------------------------------------
drop policy if exists "Assistants can view all profiles" on public.profiles;
create policy "Assistants can view all profiles" on public.profiles
  for select using (public.current_role() = 'assistant');

drop policy if exists "Assistants can view all enrollments" on public.enrollments;
create policy "Assistants can view all enrollments" on public.enrollments
  for select using (public.current_role() = 'assistant');

drop policy if exists "Students can view own payments" on public.payments;
create policy "Students can view own payments" on public.payments
  for select using (
    exists (
      select 1 from public.enrollments e
      where e.id = payments.enrollment_id and e.student_id = auth.uid()
    )
  );

drop policy if exists "Assistants can view all payments" on public.payments;
create policy "Assistants can view all payments" on public.payments
  for select using (public.current_role() = 'assistant');


-- ---------------------------------------------------------------------
-- 8. RPCs
--    register_student / register_student_courses (pre-existing) are
--    patched in place to use current_role() instead of the JWT
--    metadata check — closing the privilege-escalation hole everywhere
--    it existed, even though the frontend now calls the new function
--    below going forward.
-- ---------------------------------------------------------------------
create or replace function public.register_student(
  student_id uuid,
  student_email text,
  purchased_course_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'assistant' then
    raise exception 'Only assistants can register students';
  end if;

  insert into public.profiles (id, email, role)
  values (student_id, lower(student_email), 'student')
  on conflict (id) do update set email = excluded.email;

  if purchased_course_id is not null then
    insert into public.enrollments (student_id, course_id)
    values (student_id, purchased_course_id)
    on conflict (student_id, course_id) do nothing;
  end if;
end;
$$;

create or replace function public.register_student_courses(
  p_student_id uuid,
  p_student_email text,
  p_purchased_course_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'assistant' then
    raise exception 'Only assistants can register students';
  end if;

  insert into public.profiles (id, email, role)
  values (p_student_id, lower(p_student_email), 'student')
  on conflict (id) do update set email = excluded.email;

  insert into public.enrollments (student_id, course_id)
  select p_student_id, selected_courses.course_id
  from unnest(p_purchased_course_ids) as selected_courses(course_id)
  on conflict (student_id, course_id) do nothing;
end;
$$;

-- New: full student registration with the fields the admissions
-- workflow actually needs (name, phone, program, fee).
create or replace function public.register_student_full(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_phone text,
  p_course_id uuid,
  p_total_fee numeric
)
returns table (student_id text, enrollment_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id text;
  v_enrollment_id uuid;
begin
  if public.current_role() <> 'assistant' then
    raise exception 'Only assistants can register students';
  end if;

  insert into public.profiles (id, email, full_name, phone, role, student_id, created_by)
  values (
    p_user_id, lower(p_email), p_full_name, p_phone, 'student',
    public.generate_student_id(), auth.uid()
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    phone = excluded.phone
  returning student_id into v_student_id;

  if p_course_id is not null then
    insert into public.enrollments (student_id, course_id, total_fee)
    values (p_user_id, p_course_id, coalesce(p_total_fee, 0))
    on conflict (student_id, course_id) do update set total_fee = excluded.total_fee
    returning id into v_enrollment_id;
  end if;

  return query select v_student_id, v_enrollment_id;
end;
$$;

grant execute on function public.register_student_full(uuid, text, text, text, uuid, numeric) to authenticated;

-- Record a payment. Validates method-specific required fields and
-- generates the receipt number atomically — the assistant never
-- chooses a status, and every call produces exactly one receipt.
create or replace function public.record_payment(
  p_enrollment_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_payment_method text,
  p_reference_number text default null,
  p_cheque_bank_name text default null,
  p_cheque_date date default null,
  p_internal_note text default null
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
begin
  if public.current_role() <> 'assistant' then
    raise exception 'Only assistants can record payments';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  if p_payment_method not in ('cash','upi','netbanking','bank_transfer','cheque') then
    raise exception 'Invalid payment method: %', p_payment_method;
  end if;

  if p_payment_method in ('upi','netbanking','bank_transfer')
     and (p_reference_number is null or length(trim(p_reference_number)) = 0) then
    raise exception 'A transaction/reference number is required for % payments', p_payment_method;
  end if;

  if p_payment_method = 'cheque'
     and (p_reference_number is null or length(trim(p_reference_number)) = 0
          or p_cheque_bank_name is null or length(trim(p_cheque_bank_name)) = 0
          or p_cheque_date is null) then
    raise exception 'Cheque number, bank name and cheque date are all required for cheque payments';
  end if;

  insert into public.payments (
    enrollment_id, amount, payment_date, payment_method,
    reference_number, cheque_bank_name, cheque_date, internal_note,
    recorded_by, receipt_number
  ) values (
    p_enrollment_id,
    p_amount,
    coalesce(p_payment_date, current_date),
    p_payment_method,
    case when p_payment_method = 'cash' then null else p_reference_number end,
    case when p_payment_method = 'cheque' then p_cheque_bank_name else null end,
    case when p_payment_method = 'cheque' then p_cheque_date else null end,
    p_internal_note,
    auth.uid(),
    'UM-RCPT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.receipt_number_seq')::text, 5, '0')
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

grant execute on function public.record_payment(uuid, numeric, date, text, text, text, date, text) to authenticated;

-- Manage Enrollment: change program and/or total fee on an existing
-- enrollment. Kept minimal for Phase 1 (single active enrollment).
create or replace function public.update_enrollment(
  p_enrollment_id uuid,
  p_course_id uuid default null,
  p_total_fee numeric default null
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

  update public.enrollments
  set course_id = coalesce(p_course_id, course_id),
      total_fee = coalesce(p_total_fee, total_fee)
  where id = p_enrollment_id;
end;
$$;

grant execute on function public.update_enrollment(uuid, uuid, numeric) to authenticated;


-- =====================================================================
-- MANUAL STEP — promoting an assistant account
--
-- There is still no self-serve or in-app way to create an assistant
-- account (by design — this is your highest-trust role). After a
-- person signs up as a normal user (or you create them via Supabase
-- Auth), run:
--
--   update public.profiles set role = 'assistant' where email = 'someone@example.com';
--
-- That single UPDATE is safe: it only works from the SQL editor (or
-- another service-role context), never from the app.
-- =====================================================================
