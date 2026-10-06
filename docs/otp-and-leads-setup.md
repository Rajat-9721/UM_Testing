# Email OTP + Leads — setup guide

Step-by-step setup for the email-verified enquiry forms and the **Leads** tab in the
Assistant Dashboard. Do the parts in order. Parts A–D work **before** BigRock access;
part E needs the BigRock (domain DNS) login.

Never put a password or API key in a file that goes to GitHub. Secrets only go in the
Supabase Dashboard (or a local `.env` file, which git ignores).

## How it works (one minute)

```
Visitor fills a form on the website
  → lead-otp server function (Supabase) checks every field + the invisible CAPTCHA
  → brochure / demo forms: emails a 6-digit code (Resend first, cPanel mailbox as automatic backup)
  → visitor types the code → lead saved as "Verified"
  → next-batch alert form: saved straight away (no code)
Assistant → Assistant Dashboard → Leads → call / WhatsApp / status / notes → Download Excel
```

| Piece | Where |
|---|---|
| Database tables + functions | `phase11_lead_otp.sql` (run once), later `phase12_close_public_lead_inserts.sql` |
| Server function | `supabase/functions/lead-otp/` |
| Website forms | `astro-site/src/components/LeadCaptureDialog.astro`, `astro-site/src/lib/leads/` |
| Leads tab | `astro-site/src/pages/assistant-dashboard.astro`, `astro-site/src/lib/leads/leadsPanel.ts` |

---

## Part A — Database (2 minutes)

1. Supabase Dashboard → your project → **SQL Editor** → **New query**.
2. Paste the whole of `phase11_lead_otp.sql` and click **Run**. It only adds things and is
   safe to run again.
3. Check: **Table Editor** now shows `lead_statuses` (9 rows), `lead_otp_requests`,
   `lead_form_attempts`, and `marketing_leads` has new columns (`status`, `notes`, …).

Do **not** run `phase12_close_public_lead_inserts.sql` yet — that's for go-live (Part G).

## Part B — Deploy the server function (5 minutes)

From the repo root on your laptop (needs Node.js; no Docker needed):

```bash
npx supabase login
npx supabase functions deploy lead-otp --project-ref ohytjcwcmzalftmsdvbq --no-verify-jwt --use-api
```

`--no-verify-jwt` is required: website visitors aren't logged in.

Check: Supabase Dashboard → **Edge Functions** → `lead-otp` is listed, and in its
settings **JWT verification is OFF**. (If it's on, every form shows "We couldn't reach
our server".)

<details>
<summary>No terminal? Deploy from the Dashboard instead</summary>

Edge Functions → **Deploy a new function** → **Via Editor** → name it `lead-otp` →
create the files `index.ts`, `handler.ts`, `rules.ts`, `security.ts`, `email.ts` with the
contents of the same files in `supabase/functions/lead-otp/` → **Deploy**. Then open the
function's settings and turn **JWT verification off**. (The `*_test.ts` files are not
needed there.)
</details>

## Part C — Secrets for testing (3 minutes)

Supabase Dashboard → **Edge Functions** → **Secrets** → add:

| Name | Value for testing |
|---|---|
| `TURNSTILE_SECRET_KEY` | `1x0000000000000000000000000000000AA` (Cloudflare's always-pass test key) |
| `RESEND_API_KEY` | from resend.com → **API Keys** → Create (permission: Sending access) |

Leave `RESEND_FROM` unset for now. Until the domain is verified (Part E), Resend can
only deliver to **the email address the Resend account was created with**, so test with
that address.

The full list of optional secrets is in `supabase/functions/lead-otp/.env.example`.

## Part D — Test it on your laptop (10 minutes)

```bash
cd astro-site
npm install
npm run dev
```

1. Open http://localhost:4321 → **Download Brochure**.
2. Fill the form using **your Resend account's email** → **Send code**.
3. The code arrives (check spam too) → type it → the brochure downloads.
4. Open **Book a Free Demo Lecture** with the same email: it should go straight to
   "Demo request received" without a new code (this browser is remembered for 30 days).
5. Try **Notify Me for Next Batch** (on /courses): saves with no code.
6. Log in at http://localhost:4321/login with an assistant account → **Leads**: your
   three test leads are there. Change a status, add a note, click **Download Excel**.

What else to try: a wrong code (shows tries left), "Resend code" (60-second wait),
`+91 98765 43210` style numbers, a Hindi name.

## Part E — After BigRock access: send to every email

Two independent jobs. Each only **adds new** DNS records — no existing record is edited,
so the website and any existing @utkarshminds.com mail are not affected. Before
starting, take a screenshot of BigRock's current DNS list as a record of how it was.

In BigRock's DNS management, the "host"/"name" is usually entered without
`.utkarshminds.com` (e.g. `send`, not `send.utkarshminds.com`) — follow what BigRock's
form expects.

### E1. Verify the domain in Resend (main sender)

1. resend.com → **Domains** → **Add Domain** → `utkarshminds.com`.
2. Resend shows a few DNS records (TXT / MX or CNAME). Add each one in BigRock **exactly**
   as shown. They live on new names such as `send` and `resend._domainkey`.
3. Back in Resend click **Verify**. DNS can take from minutes to a few hours.
4. When it shows **Verified**, add the Supabase secret
   `RESEND_FROM` = `Utkarsh Minds <noreply@utkarshminds.com>`.
   (No mailbox called noreply needs to exist for Resend.)
5. Test with any email address.

### E2. cPanel mailbox (automatic backup)

Used only when Resend fails — for example after its free 100 emails/day. It sends from a
separate sub-address so the main domain's email settings are never touched.

1. cPanel → **Domains** → create the subdomain `notify.utkarshminds.com`.
2. cPanel → **Email Accounts** → **Create** → `noreply@notify.utkarshminds.com` with a
   strong password.
3. cPanel → **Email Accounts** → that account → **Connect Devices**. Note the outgoing
   server under **Secure SSL/TLS Settings (Recommended)** and use that exact host name
   (often the server's own name, not mail.utkarshminds.com — otherwise the SSL
   certificate won't match). Port **465**.
4. cPanel → **Email Deliverability** → `notify.utkarshminds.com` → **Manage**: it lists the
   SPF and DKIM records it needs. Add them in BigRock as **new** records on `notify` and
   `default._domainkey.notify`. If BigRock has no record for `notify` yet, also add an
   `A` record for `notify` pointing to the hosting server's IP (shown in cPanel).
5. Supabase secrets:

   | Name | Value |
   |---|---|
   | `SMTP_HOST` | the host from step 3 |
   | `SMTP_PORT` | `465` |
   | `SMTP_USER` | `noreply@notify.utkarshminds.com` |
   | `SMTP_PASS` | the mailbox password |
   | `SMTP_FROM` | `Utkarsh Minds <noreply@notify.utkarshminds.com>` |

6. Test the backup on its own: add secret `EMAIL_PROVIDERS` = `smtp`, request a code,
   check it arrives (and not in spam), then **delete** `EMAIL_PROVIDERS` so Resend is
   used first again.

Supabase blocks ports 25 and 587 for outgoing mail, so 465 is the only option.

## Part F — Real CAPTCHA keys (5 minutes, before go-live)

1. Create a free Cloudflare account → **Turnstile** → **Add widget**.
   Name: "Utkarsh Minds website". Hostnames: `utkarshminds.com`, `www.utkarshminds.com`.
   Widget mode: **Managed**.
2. **Site key** → `astro-site/.env` as `PUBLIC_TURNSTILE_SITE_KEY=...` on the computer
   that builds the website (it's baked in at build time; it's public, not a secret).
3. **Secret key** → Supabase secret `TURNSTILE_SECRET_KEY` (replaces the test value).

The two must be a matching pair: a real site key with the test secret (or the reverse)
makes every form fail with "The security check failed". For local testing keep both on
the test values.

## Part G — Go-live

1. Real Turnstile keys (Part F), Resend domain verified (E1), backup tested (E2).
2. Build the site (`npm run build` in `astro-site`) and upload it.
3. Submit each form once on the live site and check the Leads tab.
4. Run `phase12_close_public_lead_inserts.sql` in the SQL Editor. From then on, leads can
   only be created through the server function (no more junk inserted directly).

If the site is ever served from another address (a test subdomain, say), add it to the
`ALLOWED_ORIGINS` secret — see `.env.example`.

---

## Troubleshooting

Logs: Supabase → **Edge Functions** → `lead-otp` → **Logs**. Sent emails: Resend →
**Emails**.

| What the visitor sees | Likely cause | Fix |
|---|---|---|
| "We couldn't reach our server…" | Function not deployed, or JWT verification still on | Part B |
| "The security check failed…" | Turnstile site key and secret don't match | Part F |
| "We couldn't run the security check right now…" | `TURNSTILE_SECRET_KEY` missing | Part C |
| "We couldn't send the email right now…" | Every email provider failed | Function logs say why: e.g. `Resend 403` (domain not verified — only your own email works), `Resend 429` (daily quota, needs the backup), SMTP login/host errors |
| Code lands in spam | DNS records missing/not yet active | Finish E1 / E2, wait for DNS |
| "Too many codes were requested…" | Rate limit (5 codes/email/hour, 10/day; 20/IP/hour) | Wait, or adjust `LIMITS` in `handler.ts` |
| "We're receiving a lot of requests right now…" | Site-wide daily cap (default 300 codes/24h) | Raise `OTP_DAILY_LIMIT` secret if genuine |
| Leads tab: "Leads are not set up yet" | `phase11_lead_otp.sql` not run | Part A |

## Tests (for developers)

```bash
deno test --allow-read --allow-env supabase/functions/lead-otp/
```

Runs the validation rules, the request logic (with stand-ins for database/email/CAPTCHA)
and both SQL files against an in-memory Postgres. Nothing touches the real project.
