-- =====================================================================
-- Phase 4: One-time self-service password change for students.
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor for
-- this project and run it once. Safe to re-run.
--
-- Reuses profiles.must_change_password (added in phase1, never
-- enforced until now) — true means "hasn't used their one-time change
-- yet", false means "already used it". A student can only ever change
-- their own password once through the dashboard; after that they must
-- go through the admissions team for a reset, same as any other
-- identity-adjacent change in this system.
-- =====================================================================

create or replace function public.mark_password_changed()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set must_change_password = false where id = auth.uid();
end;
$$;

grant execute on function public.mark_password_changed() to authenticated;
