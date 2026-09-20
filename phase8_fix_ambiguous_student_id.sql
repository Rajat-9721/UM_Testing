-- =====================================================================
-- Phase 8: Fix "column reference student_id is ambiguous" on
-- Register New Student.
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor for
-- this project and run it once. Safe to re-run.
--
-- BUG: register_student_full is declared as
--   returns table (student_id text, enrollment_id uuid)
-- In PL/pgSQL, RETURNS TABLE columns become implicit variables in
-- scope for the whole function body — same as OUT parameters. That
-- makes "student_id" ambiguous with the real student_id column on
-- profiles/enrollments wherever it's referenced *unqualified* in a
-- position Postgres treats as a general expression rather than a
-- plain column-name list.
--
-- Every reference inside the function IS correctly table-qualified
-- (e.g. `returning pr.student_id`) — except one place that cannot be
-- qualified at all: the enrollments insert's own conflict target,
--   on conflict (student_id, course_id)
-- Postgres parses ON CONFLICT's column list as expressions (to
-- support expression indexes), so this bare "student_id" collides
-- with the RETURNS TABLE variable of the same name. That fires only
-- when p_course_id is not null, i.e. exactly when a course is picked
-- on the Add Student form — matching what was observed.
--
-- Confirmed by reproducing the identical error (byte-for-byte,
-- including the "It could refer to either a PL/pgSQL variable or a
-- table column" detail) in a throwaway temp table with no relation to
-- the real schema, using the same RETURNS TABLE(student_id, ...) +
-- ON CONFLICT (student_id, ...) shape.
--
-- FIX: rename the RETURNS TABLE output columns so nothing in the
-- function body collides with a real column name. The frontend
-- (assistant-dashboard.astro) only reads the RPC's `error`, never its
-- returned data, so renaming the output columns is safe with no JS
-- changes needed. Postgres won't let CREATE OR REPLACE change a
-- function's return type, so this drops and recreates it.
--
-- SECOND BUG, same symptom, found while verifying the fix above:
-- handle_new_auth_user() (an AFTER INSERT trigger on auth.users, see
-- phase1) inserts a stub profiles row (id, email, role only) the
-- moment auth.signUp() runs — before register_student_full ever
-- executes. That means register_student_full's own insert ALWAYS
-- lands on `on conflict (id) do update`, never the fresh-insert path,
-- and that update's SET list never included student_id. So even a
-- first-time registration with no prior failed attempt ended up with
-- student_id permanently NULL — masked until now because the bug
-- above crashed the whole transaction (rolling back the full_name
-- update too) before this gap was ever visible. Fixed by having the
-- update also backfill student_id when it's missing, reusing the
-- generate_student_id() value already computed in the insert's VALUES
-- list (available as excluded.student_id) instead of calling it
-- twice.
-- =====================================================================

drop function if exists public.register_student_full(uuid, text, text, text, uuid, numeric);

create or replace function public.register_student_full(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_phone text,
  p_course_id uuid,
  p_total_fee numeric
)
returns table (out_student_id text, out_enrollment_id uuid)
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
    public.generate_student_id(), auth.uid()
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    phone = excluded.phone,
    student_id = coalesce(pr.student_id, excluded.student_id)
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
