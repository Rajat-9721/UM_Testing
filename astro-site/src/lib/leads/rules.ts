// The enquiry-form rules live next to the lead-otp Edge Function so the
// server and the website can never disagree on what's valid. This file
// just makes them importable from the site.
export * from '../../../../supabase/functions/lead-otp/rules.ts';
