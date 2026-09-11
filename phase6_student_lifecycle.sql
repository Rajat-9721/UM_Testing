-- =====================================================================
-- Phase 6: Assistant-editable course codes, and a soft-delete lifecycle
--          for students ("Delete" in the UI, but the record is kept —
--          never hard-deleted — so payment/receipt history survives).
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor for
-- this project and run it once. Safe to re-run.
--
-- WHY SOFT DELETE, NOT A REAL DELETE:
-- profiles/enrollments/payments are wired with real foreign keys
-- (enrollments.student_id -> profiles.id, payments.enrollment_id ->
-- enrollments.id, both ON DELETE CASCADE). Actually deleting a student
-- would silently wipe every payment and receipt tied to them — the
-- opposite of what you asked for ("his data will still be in the
-- database"). So "Delete" in the UI sets profiles.withdrawn_at instead:
-- the student disappears from the active roster and can no longer log
-- in, but every record they're linked to (payments, receipts,
-- enrollment history) stays exactly as it was, and is restorable.
--
-- WHY THE ID SEQUENCE IS ALREADY SAFE ACROSS DELETES:
-- generate_student_id() (phase3) uses a real Postgres sequence
-- (nextval) per (year, course code). A sequence only ever moves
-- forward — once it hands out 003, it can never hand out 003 again,
-- deleted or not. So if student #3 under a course is removed, the
-- next new student under that same course still gets 004, never a
-- reused number. Nothing needed here to make that true — it already
-- was, by construction.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Course codes become assistant-editable (Add/Edit Program form),
--    with a uniqueness guard so two courses can never collide.
--    assign_course_code() (phase3) already only fills in a code when
--    the assistant leaves it blank — this just adds the safety net.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'courses_code_unique') then
    alter table public.courses add constraint courses_code_unique unique (code);
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 2. Soft delete for students.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists withdrawn_at timestamptz;

create or replace function public.withdraw_student(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'assistant' then
    raise exception 'Only assistants can remove a student';
  end if;

  update public.profiles set withdrawn_at = now() where id = p_student_id and role = 'student';
  if not found then
    raise exception 'Student not found';
  end if;
end;
$$;

grant execute on function public.withdraw_student(uuid) to authenticated;

create or replace function public.restore_student(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'assistant' then
    raise exception 'Only assistants can restore a student';
  end if;

  update public.profiles set withdrawn_at = null where id = p_student_id and role = 'student';
  if not found then
    raise exception 'Student not found';
  end if;
end;
$$;

grant execute on function public.restore_student(uuid) to authenticated;

-- Expose withdrawn_at to the assistant's student list (appended at the
-- end — CREATE OR REPLACE VIEW can't reorder or retype existing columns).
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
  coalesce(s.total_fee, 0) as total_fee,
  coalesce(s.total_paid, 0) as total_paid,
  coalesce(s.balance, 0) as balance,
  coalesce(s.status, 'UNPAID') as status,
  pr.withdrawn_at
from public.profiles pr
left join public.enrollments e on e.student_id = pr.id
left join public.courses c on c.id = e.course_id
left join public.enrollment_payment_summary s on s.enrollment_id = e.id
where pr.role = 'student';
