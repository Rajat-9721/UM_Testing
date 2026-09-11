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
begin
  if public.current_role() <> 'assistant' then
    raise exception 'Only assistants can edit student profiles';
  end if;

  update public.profiles
  set full_name = p_full_name,
      email = lower(p_email),
      phone = p_phone
  where id = p_student_id and role = 'student';

  if not found then
    raise exception 'Student not found';
  end if;
end;
$$;

grant execute on function public.update_student_profile(uuid, text, text, text) to authenticated;
