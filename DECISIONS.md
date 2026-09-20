# Decisions Log

Running record of non-obvious decisions made on this project — what was decided, why, and what alternatives were considered. Newest entries at the top.

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
