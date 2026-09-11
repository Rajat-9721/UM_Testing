-- =====================================================================
-- Phase 3: Fee Receipt module — matches the official SPIT payment
--          receipt template (uploaded by the client) as the source of
--          truth for the generated PDF.
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor for
-- this project and run it once. Like phase1/phase2, it only adds or
-- replaces objects — safe to re-run.
--
-- DESIGN NOTES (field-mapping decisions made without a spec answer —
-- flag if any of these should be different):
--   - "Student PRN" on the receipt is the SAME value as the existing
--     auto-generated profiles.student_id (e.g. UM2026-0004). There is
--     no separate university-issued PRN concept in this system, and
--     the spec says not to duplicate student records — so it's reused
--     rather than added as a second, never-populated identifier.
--   - Receipt number KEEPS the existing UM-RCPT-YYYY-NNNNN convention
--     already live in production (phase1), per the spec's own
--     instruction to keep an existing convention if one exists.
--   - "Particulars of Fees" (up to 5 line items on the template) are
--     stored as fee_particulars jsonb on the payment row, purely for
--     receipt rendering. The single `amount` column stays the one
--     number that feeds the existing balance/status calculations
--     (enrollment_payment_summary) — the particulars must sum to it,
--     enforced below — so a receipt still represents exactly one real
--     payment transaction, never a re-statement of the whole course fee.
--   - Academic Year / Financial Year are captured per payment (not on
--     the student profile) because they describe the receipt's period,
--     which can differ across a student's multiple payments over time.
--   - Roll No. lives on profiles (reused across all of a student's
--     receipts), since it's a property of the student, not the payment.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. NEW COLUMNS
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists roll_no text;

alter table public.payments
  add column if not exists academic_year text,
  add column if not exists financial_year text,
  add column if not exists fee_particulars jsonb;


-- ---------------------------------------------------------------------
-- 2. record_payment: extended with the new optional fields.
--    Dropped and recreated (rather than CREATE OR REPLACE) because
--    Postgres treats a changed parameter list as a different function
--    signature — OR REPLACE would leave the old 8-argument version
--    behind as a stale duplicate instead of actually replacing it.
-- ---------------------------------------------------------------------
drop function if exists public.record_payment(uuid, numeric, date, text, text, text, date, text);

create or replace function public.record_payment(
  p_enrollment_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_payment_method text,
  p_reference_number text default null,
  p_cheque_bank_name text default null,
  p_cheque_date date default null,
  p_internal_note text default null,
  p_academic_year text default null,
  p_financial_year text default null,
  p_fee_particulars jsonb default null,
  p_roll_no text default null
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_student_id uuid;
  v_particulars_sum numeric;
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

  if p_fee_particulars is not null then
    select coalesce(sum((item->>'amount')::numeric), 0) into v_particulars_sum
    from jsonb_array_elements(p_fee_particulars) as item;

    if round(v_particulars_sum, 2) <> round(p_amount, 2) then
      raise exception 'Fee particulars (total %) must add up to the payment amount (%)', v_particulars_sum, p_amount;
    end if;
  end if;

  select student_id into v_student_id from public.enrollments where id = p_enrollment_id;
  if v_student_id is null then
    raise exception 'Enrollment not found';
  end if;

  if p_roll_no is not null then
    update public.profiles set roll_no = p_roll_no where id = v_student_id;
  end if;

  insert into public.payments (
    enrollment_id, amount, payment_date, payment_method,
    reference_number, cheque_bank_name, cheque_date, internal_note,
    recorded_by, receipt_number, academic_year, financial_year, fee_particulars
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
    'UM-RCPT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.receipt_number_seq')::text, 5, '0'),
    p_academic_year,
    p_financial_year,
    p_fee_particulars
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

grant execute on function public.record_payment(uuid, numeric, date, text, text, text, date, text, text, text, jsonb, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. payment_receipts: expose the new fields. Only appended at the end
--    — CREATE OR REPLACE VIEW can't reorder or retype existing columns.
-- ---------------------------------------------------------------------
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
  end as status_after_payment,
  p.academic_year,
  p.financial_year,
  p.fee_particulars,
  pr.phone as student_phone,
  pr.roll_no as student_roll_no
from public.payments p
join public.enrollments e on e.id = p.enrollment_id
join public.courses c on c.id = e.course_id
join public.profiles pr on pr.id = e.student_id;


-- ---------------------------------------------------------------------
-- 4. Student ID scheme change: {year}{course code}-{per-course
--    sequence}, e.g. 2026100-001 — the AI course becomes code 100 (the
--    first course, in creation order), the next distinct course would
--    become 200, and so on. Replaces the old "UM2026-0004" format so
--    the ID itself encodes which course a student registered under,
--    and doubles as the receipt's "Roll No. (UID)" field (see below —
--    the separate "Student PRN" row is being dropped from the receipt
--    in favour of this single identifier).
-- ---------------------------------------------------------------------
alter table public.courses
  add column if not exists code text;

-- Backfill any existing courses without a code, oldest first, so the
-- course actually in use (the AI certification) lands on 100.
do $$
declare
  r record;
  v_next int := 100;
begin
  for r in select id from public.courses where code is null order by created_at loop
    update public.courses set code = v_next::text where id = r.id;
    v_next := v_next + 100;
  end loop;
end $$;

-- Every new course gets the next multiple of 100 automatically —
-- no manual code assignment needed when adding a program.
create or replace function public.assign_course_code()
returns trigger
language plpgsql
as $$
declare
  v_max int;
begin
  if new.code is null then
    select coalesce(max(code::int), 0) into v_max from public.courses where code ~ '^[0-9]+$';
    new.code := (v_max + 100)::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_course_code on public.courses;
create trigger trg_assign_course_code
  before insert on public.courses
  for each row execute function public.assign_course_code();

-- A dedicated sequence per (year, course code) is created on first
-- use — nextval() is atomic, so two assistants registering students
-- for the same course at the same moment can never collide the way a
-- plain "count existing rows" approach could.
drop function if exists public.generate_student_id();

create or replace function public.generate_student_id(p_course_id uuid)
returns text
language plpgsql
as $$
declare
  v_code text;
  v_year text := to_char(now(), 'YYYY');
  v_seq_name text;
  v_seq bigint;
begin
  if p_course_id is not null then
    select code into v_code from public.courses where id = p_course_id;
  end if;
  v_code := coalesce(v_code, '000');

  v_seq_name := 'student_seq_' || v_year || '_' || v_code;
  execute format('create sequence if not exists public.%I', v_seq_name);
  execute format('select nextval(%L)', 'public.' || v_seq_name) into v_seq;

  return v_year || v_code || '-' || lpad(v_seq::text, 3, '0');
end;
$$;

-- register_student_full re-created (same signature — CREATE OR REPLACE
-- is a true replace here, not an overload) to call the course-coded
-- generator instead of the old one.
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

  insert into public.profiles as pr (id, email, full_name, phone, role, student_id, created_by)
  values (
    p_user_id, lower(p_email), p_full_name, p_phone, 'student',
    public.generate_student_id(p_course_id), auth.uid()
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    phone = excluded.phone
  returning pr.student_id into v_student_id;

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
