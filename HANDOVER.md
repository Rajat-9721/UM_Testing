# Handover — Utkarsh Minds website

What someone taking over this project needs to know: which accounts it depends on, where
settings and secrets live, and how to look after it. **No passwords or keys belong in
this file or anywhere in this repository.**

Detailed guides:

- [docs/otp-and-leads-setup.md](docs/otp-and-leads-setup.md) — setting up / re-creating the
  email OTP and Leads features, plus troubleshooting
- [docs/leads-guide-for-assistants.md](docs/leads-guide-for-assistants.md) — plain-language
  guide for the people who follow up on enquiries
- [DECISIONS.md](DECISIONS.md) — why things were built the way they were
- [RESET_BEFORE_GO_LIVE.md](RESET_BEFORE_GO_LIVE.md) — one-time cleanup before launch

## Accounts the website depends on

Ideally every account below is owned by one permanent institute-controlled email address
(not a personal or college address that may stop working), with the password kept by the
institute. Fill in the owner column when this is decided.

| Service | Used for | Free-plan limits worth knowing | Owner |
|---|---|---|---|
| GitHub (`Rajat-9721/UM_Testing`) | Source code | — | _to be confirmed_ |
| Supabase (project `ohytjcwcmzalftmsdvbq`) | Database, logins, server functions, their secrets | — | _to be confirmed_ |
| Resend | Sends the verification-code emails | 100 emails/day, 3,000/month | _to be confirmed_ |
| Cloudflare (Turnstile only) | Invisible "are you human?" check on forms | — | _to be confirmed_ |
| cPanel hosting | Website files; backup mailbox `noreply@notify.utkarshminds.com` | Host's hourly email limit | Institute |
| BigRock | The domain `utkarshminds.com` and its DNS records | — | Institute |

## Where secrets live

All in **Supabase Dashboard → Edge Functions → Secrets** (names only listed here):

| Secret | What it is | Where to get a new one |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret | Cloudflare → Turnstile → widget → Settings |
| `RESEND_API_KEY` | Resend sending key | Resend → API Keys |
| `RESEND_FROM` | Sender shown on code emails | — |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | cPanel backup mailbox | cPanel → Email Accounts |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | AI for the resume & LinkedIn tools | Google AI Studio / OpenAI |

The only website-side setting is `PUBLIC_TURNSTILE_SITE_KEY` in `astro-site/.env` (public,
not secret). The Supabase URL and publishable key in `astro-site/src/lib/supabaseConfig.ts`
are public by design; Row Level Security protects the data.

**Changing a key** (e.g. someone leaves the team): create the new key in the service,
update the Supabase secret, then delete the old key in the service. No code change or
redeploy needed for secrets.

## Looking after the enquiry forms and leads

- **Did a code email go out?** Resend → Emails shows every email and whether it was
  delivered. Problems with the server function: Supabase → Edge Functions → `lead-otp` →
  Logs.
- **Resend's daily limit** doesn't need watching: when it runs out, the cPanel mailbox
  takes over automatically.
- **Lead statuses** (New, Contacted, …) live in the `lead_statuses` table. Rename a label
  or change `sort_order` in Supabase → Table Editor; hide one with `is_active = false`.
  Don't delete a status that leads still use (the database refuses).
- **Leads are never deleted** by the system. Mark junk as "Invalid / junk".
- **Limits** (codes per email/IP, wait between codes) are the `LIMITS` block in
  `supabase/functions/lead-otp/handler.ts`; the site-wide daily cap is the
  `OTP_DAILY_LIMIT` secret. Changing `handler.ts` needs a redeploy of the function.
- **Adding a new enquiry form**: add its source to `LEAD_SOURCES` in
  `supabase/functions/lead-otp/rules.ts` (decide whether it needs an email code), redeploy
  the function, then use `<LeadCaptureDialog source="…">` on the page.

## Code map (enquiries and leads)

| Path | What |
|---|---|
| `phase11_lead_otp.sql`, `phase12_close_public_lead_inserts.sql` | Database objects (run in the SQL Editor) |
| `supabase/functions/lead-otp/` | Server function: `index.ts` (setup), `handler.ts` (logic), `rules.ts` (validation, shared with the website), `email.ts` (Resend + cPanel), `*_test.ts` (tests) |
| `astro-site/src/components/LeadCaptureDialog.astro` | The form popup used by every enquiry form |
| `astro-site/src/lib/leads/` | Form behaviour, CAPTCHA, Leads tab, Excel export |

Tests: `deno test --allow-read --allow-env supabase/functions/lead-otp/`

## Known limitations / open items

- The brochure PDF itself is a public file; the form captures who downloads it but
  doesn't stop someone who has the direct link.
- A privacy policy page is still to be written; the forms' consent checkbox should link
  to it once it exists.
- Supabase's own login emails (e.g. password resets) are configured separately, in
  Supabase → Authentication → Emails → SMTP settings — not by the `lead-otp` function.
  Supabase's built-in sender only delivers to project team members; if those settings
  point at Resend, they start reaching everyone once the domain is verified in Resend.
