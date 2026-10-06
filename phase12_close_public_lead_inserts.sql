-- =====================================================================
-- Phase 12: Close the old "anyone can insert a lead" door
--
-- HOW TO RUN: only AFTER the new website (with the lead-otp Edge
-- Function forms from phase 11) is live. Paste into the Supabase SQL
-- Editor and run once. Safe to re-run.
--
-- WHY: until now any visitor's browser could write straight into
-- marketing_leads, so anyone could add junk or fake leads without the
-- email OTP, CAPTCHA or server-side checks. From phase 11 on, every form
-- goes through the lead-otp Edge Function, which writes with the service
-- role — so the public insert permission is no longer needed.
--
-- Effect: browsers can no longer insert leads directly. Nothing else
-- changes; existing leads are untouched and assistants can still read
-- and update them.
--
-- UNDO (only if the new forms ever have to be rolled back): re-run
-- marketing_leads.sql and then phase11_lead_otp.sql (both are safe to
-- re-run) — together they restore the narrowed public insert.
-- =====================================================================

drop policy if exists "Public can submit a marketing lead" on public.marketing_leads;

-- Also removes the column-level insert grants added in phase 11.
revoke insert on public.marketing_leads from anon, authenticated;

notify pgrst, 'reload schema';
