-- =====================================================================
-- Phase 5: Let an assistant edit a student's Full Name, Email and
--          Phone directly from Student Management.
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor for
-- this project and run it once. Safe to re-run.
--
-- IMPORTANT CAVEAT — read before using the Edit feature:
-- This updates profiles.email only (the display/record copy). It does
-- NOT change the student's actual Supabase Auth login email. Changing
-- the real login email requires the Admin API with the service-role
-- key, which this app deliberately never exposes to the browser (see
-- lib/supabase.ts). So if a student needs to log in with a different
-- email, that still has to be done from the Supabase dashboard
-- directly — editing it here only fixes what's shown on their profile
-- and receipts, e.g. correcting a typo, not changing their credentials.
-- =====================================================================

-- Also backfills student_id if it's still null (see phase3's
-- generate_student_id) — covers accounts left incomplete by a partial
-- registration failure (auth signup succeeded, register_student_full
-- didn't), so Edit doubles as a repair path for exactly that case
-- rather than leaving a student permanently without an ID.
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
  v_course_id uuid;
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
    select course_id into v_course_id from public.enrollments where student_id = p_student_id limit 1;
    update public.profiles set student_id = public.generate_student_id(v_course_id) where id = p_student_id;
  end if;
end;
$$;

grant execute on function public.update_student_profile(uuid, text, text, text) to authenticated;
