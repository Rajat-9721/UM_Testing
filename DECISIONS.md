# Decisions Log

Running record of non-obvious decisions made on this project — what was decided, why, and what alternatives were considered. Newest entries at the top.

---

## 2026-10-07 — Email OTP for the enquiry forms + Leads tab

**Context:** the brochure form's OTP only ever reached our own inbox, leads were invisible to non-technical staff, and the forms wrote to `marketing_leads` straight from the browser.

### Decision: Our own `lead-otp` Edge Function instead of Supabase Auth's email OTP
The old flow used `signInWithOtp`, which creates a real `auth.users` row for every visitor — and `handle_new_auth_user` gives each one a `profiles` row with role `student`. The "sign out afterwards" step ran in the browser, so anyone could skip it and keep a student session (student dashboard, AI resume/LinkedIn tools that spend our AI quota). The lead insert was also unverified: the public insert policy accepted anything, with or without a code.
**Chosen:** a dedicated function that stores only a hash of a 6-digit code, keeps the visitor's details server-side with the code (so what was verified is exactly what is saved), allows 5 tries, and writes the lead with the service role. No login accounts are created for visitors.

### Decision: Resend first, cPanel SMTP as automatic backup
Both are free. Resend: HTTPS API (Supabase Edge Functions block SMTP ports 25/587), better inbox placement, a dashboard showing delivery per email, and its DNS records are new names only. cPanel alone would need editing the domain's main SPF record (risk to existing @utkarshminds.com mail) and has a weaker shared-server reputation. Resend's free plan is capped at 100 emails/day, so any Resend failure (quota or otherwise) falls through to the cPanel mailbox — nobody has to watch the limit.
**Backup sends from `noreply@notify.utkarshminds.com`, not `@utkarshminds.com`:** a subdomain has its own SPF/DKIM records, so setting it up only *adds* DNS records and never touches the main domain's email settings.

### Decision: Cloudflare Turnstile, invisible ("interaction-only")
Without a CAPTCHA, a script could use our form to email codes to strangers and get the domain blacklisted. Turnstile is free, privacy-friendly and almost always invisible. Rate limits (per email, per IP, site-wide daily cap) back it up.

### Decision: "Remember this browser" for 30 days after verifying
A visitor who verified for the brochure and then books a demo isn't asked for a second code. The browser keeps a random token; the server stores only its hash and accepts it for the same email only. Saves emails against Resend's daily quota.

### Decision: Leads tab in the existing Assistant Dashboard + CSV export (not a Google Sheet)
Assistants already log in there; the data stays in one access-controlled place. A live Google Sheet would be a second copy of personal data with its own sharing risks and setup. The CSV opens in Excel (UTF-8 BOM for Indian-language names) and neutralises formula-like cells (`=`, `+`, `-`, `@`), since lead text comes from public forms.

### Decision: Statuses are a table (`lead_statuses`), not a hard-coded list
The institute can rename/reorder/hide statuses in the Table Editor without a code change. Assistant edits go through `update_marketing_lead(p_changes jsonb)`, which updates only the fields sent — so an inline status change never overwrites notes saved a moment earlier by someone else.

### Decision: One validation file shared by the server and the website
`supabase/functions/lead-otp/rules.ts` is imported by both (the site via `astro-site/src/lib/leads/rules.ts`), so they can't drift apart. It also fixed a bug: "+91 98765 43210" used to be rejected.

### Decision: Closing the public insert is a separate step (`phase12`)
Running it before the new forms are live would break the forms in use. Until then, phase 11 narrows the public insert to the old columns, so nobody can insert a lead marked as verified.

---

## 2026-09-12 — Register New Student: ambiguous `student_id` bug, root cause + fix

**Context:** Assistant Dashboard → Add Student was failing with `column reference "student_id" is ambiguous`, leaving a partial state (auth account created, profile with no name/ID).

### Decision: Diagnose by reproducing in isolation before touching production code
Rather than guessing at more SQL changes, reproduced the exact error (byte-for-byte, including the Postgres hint text) in a throwaway temp table with no relation to the real schema, using only the same shape (`RETURNS TABLE(student_id, ...)` + `ON CONFLICT (student_id, ...)`).
**Why:** the function body itself was already fully qualified (no unqualified `student_id` in any expression) — the previous session had already verified this. A repro was the only way to prove the actual mechanism instead of re-guessing at SQL edits.
**How to apply:** for any "impossible" Postgres error where the visible SQL looks correct, check for signature-level shadowing (RETURNS TABLE / OUT params) before assuming the function body is wrong.

### Decision: Fix by renaming `RETURNS TABLE` output columns, not by restructuring the SQL
`register_student_full`'s `RETURNS TABLE(student_id text, enrollment_id uuid)` makes `student_id` an implicit PL/pgSQL variable for the whole function body. It collided with the real column specifically in `enrollments`'s `ON CONFLICT (student_id, course_id)` — a position that can't be table-qualified because Postgres parses it as an expression list.
**Why chosen over alternatives** (e.g. restructuring the conflict clause, using a different upsert pattern): renaming the output columns (`student_id`/`enrollment_id` → `out_student_id`/`out_enrollment_id`) is the smallest possible change, and is safe because the only caller (`assistant-dashboard.astro`) destructures `{ error }` from the RPC response and never reads the returned data.
**How to apply:** if this function's return shape is ever consumed by data (not just checked for error), the JSON key names changed — update the caller.

### Decision: Fix the second bug (student_id staying NULL even after bug 1's fix) in the same migration, not a separate one
While verifying the fix above, found that even a fresh registration left `student_id` NULL. Root cause: `handle_new_auth_user` (an `AFTER INSERT` trigger on `auth.users`) inserts a stub `profiles` row the instant `auth.signUp()` runs, *before* `register_student_full` executes — so `register_student_full`'s own insert always hits `ON CONFLICT (id) DO UPDATE`, and that branch's `SET` list never included `student_id`. This was invisible until bug 1 was fixed, because the crash was rolling back the whole transaction (including the `full_name` update) every time.
**Why fixed together:** same user-visible symptom ("no student ID"), same root migration, and leaving it would have meant every registration silently producing IDless students even though the reported error was gone.
**Fix:** `student_id = coalesce(pr.student_id, excluded.student_id)` added to the `ON CONFLICT ... DO UPDATE SET` list — reuses the ID already computed by `generate_student_id()` in the `VALUES` clause rather than calling it a second time.
**How to apply:** any other `ON CONFLICT DO UPDATE` on `profiles` that's meant to handle "resume after partial failure" should backfill `student_id` the same way if it's missing from the SET list.

### Decision: Reload PostgREST schema cache via `NOTIFY pgrst, 'reload schema'` after every function signature change
Both fixes changed `register_student_full`'s return type, which requires `DROP FUNCTION` + `CREATE FUNCTION` (Postgres won't let `CREATE OR REPLACE` change a return type). Ran the NOTIFY after each such change so PostgREST's schema cache doesn't serve a stale signature.
**How to apply:** any future migration that changes a function's parameter list or return type needs this same reload step, not just a plain `CREATE OR REPLACE`.

### Decision: Save the migration as `phase8_fix_ambiguous_student_id.sql`, matching the existing phase1–7 convention
Kept the same header style (HOW TO RUN / WHY, safe-to-re-run) as prior phase files rather than inventing a new format.

### Decision: Save the fix as a named, described query in the Supabase SQL Editor; don't save the diagnostic/debug queries
Saved only the actual fix (title: "Phase 8: Fix ambiguous student_id in register_student_full", with a full description) as a private query next to "Phase 7", so it's discoverable later. The temp-table repro, `pg_proc` lookups, and one-off `SELECT`s used to find the bug were left unsaved — they're not reusable, just scratch work.
**How to apply:** going forward, only save a SQL Editor query when it's something worth re-running later (a migration, a recurring check) — not every ad-hoc lookup made while debugging.

### Open decision: whether to delete the test accounts created while verifying the fix
Created three dummy students (`debugtest`, `freshtest`, `finalverify` @example.com) while testing. `RESET_BEFORE_GO_LIVE.md` says test students must be deleted via **Dashboard → Authentication → Users**, not SQL, so cascading delete (auth → profiles → enrollments → payments) works correctly. Asked the user whether to clean these up now or leave them — not yet resolved.
