-- =====================================================================
-- Phase 7: Decouple Student UID from course — identity vs. enrollment.
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor for
-- this project and run it once. Safe to re-run.
--
-- WHY: a student is one person who may enroll in one or many courses
-- over time (enrollments already models this correctly — one row per
-- course, all pointing at the same student). Embedding a course code
-- into profiles.student_id (phase3) was wrong: the ID is meant to
-- identify the PERSON, permanently, regardless of how many programs
-- they take. This reverts ID generation to be course-independent —
-- {year}{sequence}, e.g. 20260001 — while leaving courses.code in
-- place as optional, purely informational metadata (no longer
-- auto-assigned, no longer required, no longer used by anything).
--
-- Existing students keep whatever ID they already have (course-coded,
-- hyphenated, or blank) — this only changes what NEW registrations get.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. courses.code becomes purely optional metadata — stop auto-
--    assigning it on insert. The unique constraint (phase6) stays:
--    harmless, since Postgres allows any number of NULLs under a
--    unique constraint and only blocks two courses sharing the same
--    real code.
-- ---------------------------------------------------------------------
drop trigger if exists trg_assign_course_code on public.courses;


-- ---------------------------------------------------------------------
-- 2. generate_student_id: course-independent, per-year sequence.
--    Same dynamic-sequence technique as phase3 (one sequence per year,
--    created on first use, nextval() is atomic) — just without the
--    course-code segment.
-- ---------------------------------------------------------------------
drop function if exists public.generate_student_id(uuid);

create or replace function public.generate_student_id()
returns text
language plpgsql
as $$
declare
  v_year text := to_char(now(), 'YYYY');
  v_seq_name text := 'student_id_seq_' || v_year;
  v_seq bigint;
begin
  execute format('create sequence if not exists public.%I', v_seq_name);
  execute format('select nextval(%L)', 'public.' || v_seq_name) into v_seq;
  return v_year || lpad(v_seq::text, 4, '0');
end;
$$;


-- ---------------------------------------------------------------------
-- 3. register_student_full: one-line change — stop passing the course
--    ID into the ID generator. It's still used, unchanged, to create
--    the enrollment row right below.
-- ---------------------------------------------------------------------
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
    public.generate_student_id(), auth.uid()
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


-- ---------------------------------------------------------------------
-- 4. update_student_profile: same one-line change in its ID-backfill
--    path (used to repair accounts left incomplete by a partial
--    registration failure — see phase5).
-- ---------------------------------------------------------------------
create or replace function public.update_student_profile(
  p_student_id uuid,
  p_full_name text,
  p_email text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_needs_id boolean;
begin
  if public.current_role() <> 'assistant' then
    raise exception 'Only assistants can edit student profiles';
  end if;

  select (student_id is null) into v_needs_id
  from public.profiles where id = p_student_id and role = 'student';

  if v_needs_id is null then
    raise exception 'Student not found';
  end if;

  update public.profiles
  set full_name = p_full_name,
      email = lower(p_email),
      phone = p_phone
  where id = p_student_id;

  if v_needs_id then
    update public.profiles set student_id = public.generate_student_id() where id = p_student_id;
  end if;
end;
$$;

grant execute on function public.update_student_profile(uuid, text, text, text) to authenticated;
