# Resetting test data before handover — run this once, right before go-live

This is **not** a phase file, not idempotent, and not safe to run casually — it
permanently deletes data. Only run this when testing is completely finished
and you're ready to hand the project to your ma'am with a clean slate.

## Step 1 — Delete test students via the Supabase Dashboard (not SQL)

Go to **Authentication → Users** in the Supabase dashboard, select every
test student account, and delete them there — not via a SQL `DELETE`.

Why the dashboard and not SQL: `profiles.id` references `auth.users.id` with
`ON DELETE CASCADE`, and `enrollments`/`payments` cascade from `profiles` the
same way. So deleting the **auth user** from the dashboard automatically and
correctly wipes their profile, enrollments, and payments in one clean action.
Deleting directly from `profiles` via SQL instead would work for your own
tables, but leaves orphaned rows behind in Supabase's internal `auth.*`
tables (sessions, identities, refresh tokens) that only the dashboard/Admin
API knows how to clean up properly.

If you also created test **assistant** accounts you don't want to keep,
delete those the same way. Leave the real assistant account(s) — including
whichever one your ma'am will actually use — untouched.

## Step 2 — Reset the numbering sequences, in the SQL Editor

Once every test student is gone, run this to make sure the *next* student
registered starts fresh at 1, not wherever testing left off:

```sql
-- Drop every leftover per-course-per-year sequence from the old ID
-- scheme (phase3) — they're no longer used now that IDs are
-- course-independent (phase7), so there's nothing to reset, just
-- clean up. Safe even if none exist.
do $$
declare
  r record;
begin
  for r in
    select sequencename from pg_sequences
    where schemaname = 'public' and sequencename like 'student_seq_%'
  loop
    execute format('drop sequence if exists public.%I', r.sequencename);
  end loop;
end $$;

-- Reset (or drop) this year's student ID sequence, so the next
-- registration starts at {year}0001 again.
drop sequence if exists public.student_id_seq_2026;

-- Reset receipt numbering back to 00001 for the current year too.
alter sequence public.receipt_number_seq restart with 1;
```

(Change `student_id_seq_2026` to whichever year you're actually resetting in,
if it's not 2026 by the time you do this.)

You don't need to touch `courses` — the course list, prices, and any codes
you've set are real production content, not test data, and aren't affected
by any of this.

## Step 3 — Verify

Register one real (or throwaway) student through **Add Student** and confirm
the ID comes back as `{year}0001`. Then delete that one too via the
dashboard if it was just a check, and you're ready to hand off.
