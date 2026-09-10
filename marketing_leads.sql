-- Marketing leads captured from on-site "Notify Me" style CTAs.
-- Collection only — no automated email/SMS/WhatsApp is triggered by this table.
-- Run this against the same Supabase project referenced by supabaseClient.js.

CREATE TABLE IF NOT EXISTS public.marketing_leads (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL CHECK (char_length(trim(name)) >= 2),
    email TEXT NOT NULL CHECK (email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
    mobile TEXT NOT NULL CHECK (mobile ~ '^[6-9][0-9]{9}$'),
    program TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.marketing_leads ENABLE ROW LEVEL SECURITY;

-- Public (anon) visitors may submit a lead, but may not read, update, or
-- delete any lead — including their own — once submitted. No SELECT/UPDATE/
-- DELETE policy is defined for anon/authenticated, so RLS default-denies them;
-- only the Supabase dashboard (or a service-role key, never exposed to the
-- client) can read this table.
DROP POLICY IF EXISTS "Public can submit a marketing lead" ON public.marketing_leads;
CREATE POLICY "Public can submit a marketing lead" ON public.marketing_leads
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Added for the "Book a Free Demo Lecture" bar — optional, so it stays
-- nullable rather than breaking the existing brochure/notify-me inserts
-- that don't send it.
ALTER TABLE public.marketing_leads
    ADD COLUMN IF NOT EXISTS education_status TEXT;
