// Checks phase11_lead_otp.sql and phase12_close_public_lead_inserts.sql
// against a real (in-memory) Postgres with a small stand-in for
// Supabase's roles, grants and auth schema. Nothing touches the real
// database.
//
// Run from the repo root:
//   deno test --allow-read --allow-env supabase/functions/lead-otp/sql_test.ts
import { PGlite } from 'npm:@electric-sql/pglite@0.5.8';

const repo = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '');
const readFileSync = (path: string) => Deno.readTextFileSync(path);

Deno.test('phase 11 / phase 12 SQL', async () => {
  const db = new PGlite();
  let failures = 0;
  const ok = (cond: unknown, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
  const expectError = async (sql: string, params: unknown[], re: RegExp, msg: string) => {
    try { await db.query(sql, params); ok(false, `${msg} (no error)`); }
    catch (e) { ok(re.test((e as Error).message), `${msg} -> ${(e as Error).message}`); }
  };
  const as = async (role: string | null, sub?: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ''}', false);`);
    if (role) await db.exec(`set role ${role};`);
  };
  const one = async (sql: string, params?: unknown[]): Promise<any> => (await db.query(sql, params)).rows[0];

  // --- Supabase-like scaffolding ---------------------------------------
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create table public.profiles (id uuid primary key, role text not null default 'student');
    create or replace function public.current_role() returns text language sql security definer set search_path = public stable
      as $$ select role from public.profiles where id = auth.uid() $$;
    insert into public.profiles values ('00000000-0000-0000-0000-00000000000a', 'assistant'), ('00000000-0000-0000-0000-00000000000b', 'student');
  `);
  await db.exec(readFileSync(`${repo}/marketing_leads.sql`));

  // A lead from the current (old) forms, before phase 11.
  await as('anon');
  await db.query(`insert into public.marketing_leads (name, email, mobile, program, source) values ('Old Lead', 'Old@Example.com', '9876543210', 'AI', 'ai_brochure')`);
  await as(null);

  // --- phase 11, twice (must be re-runnable) ----------------------------
  const phase11 = readFileSync(`${repo}/phase11_lead_otp.sql`);
  await db.exec(phase11);
  await db.exec(phase11);
  ok(true, 'phase11 runs twice without error');

  const old = await one(`select status, email_verified from public.marketing_leads where name = 'Old Lead'`);
  ok(old.status === 'new' && old.email_verified === false, 'existing lead backfilled: status=new, not verified');
  ok((await one(`select count(*)::int as n from public.lead_statuses`)).n === 9, '9 statuses seeded once');

  // --- legacy public insert is narrowed --------------------------------
  await as('anon');
  await db.query(`insert into public.marketing_leads (name, email, mobile, program, source) values ('Anon OK', 'a@example.com', '9876543211', 'AI', 'next_batch_notify')`);
  ok(true, 'anon can still insert the old columns (old forms keep working)');
  await expectError(`insert into public.marketing_leads (name, email, mobile, program, source, email_verified) values ('Fake', 'f@example.com', '9876543212', 'AI', 'ai_brochure', true)`, [], /permission denied/, 'anon cannot set email_verified');
  const anonRows: { rows: unknown[] | null } = await db.query(`select * from public.marketing_leads`).catch(() => ({ rows: null }));
  ok(!anonRows.rows || anonRows.rows.length === 0, 'anon cannot read leads');
  await expectError(`select public.lead_record('X Y', 'x@example.com', '9876543213', 'AI', 'ai_brochure', null, now(), true)`, [], /permission denied/, 'anon cannot call lead_record');
  await expectError(`select * from public.lead_otp_requests`, [], /permission denied/, 'anon cannot read OTP table');
  await expectError(`select public.lead_otp_verify(gen_random_uuid(), 'x', null, 30)`, [], /permission denied/, 'anon cannot call lead_otp_verify');

  // --- rate limits (service role) --------------------------------------
  await as('service_role');
  const attempt = (email: string, ip = 'ip1') => one(`select public.lead_attempt('code', $1, $2, 20, 5, 10, 60, 500) as r`, [ip, email]).then((x) => x.r);
  let r = await attempt('rate@example.com');
  ok(r.allowed === true, 'first code allowed');
  r = await attempt('rate@example.com');
  ok(r.allowed === false && r.reason === 'cooldown' && r.retry_after > 0 && r.retry_after <= 60, `second code within 60s blocked by cooldown (retry ${r.retry_after}s)`);
  // simulate 5 sends spread over the last hour
  await as(null);
  await db.exec(`update public.lead_form_attempts set created_at = now() - interval '50 minutes' where email = 'rate@example.com'`);
  await db.exec(`insert into public.lead_form_attempts (kind, ip_hash, email, created_at) select 'code', 'ip9', 'rate@example.com', now() - interval '40 minutes' from generate_series(1, 4)`);
  await as('service_role');
  r = await attempt('rate@example.com', 'ip2');
  ok(r.allowed === false && r.reason === 'email_hour', `6th code in an hour blocked (retry ${r.retry_after}s)`);
  await as(null);
  await db.exec(`insert into public.lead_form_attempts (kind, ip_hash, email, created_at) select 'code', 'ipX', 'other' || g || '@example.com', now() - interval '5 minutes' from generate_series(1, 20) g`);
  await as('service_role');
  r = await attempt('fresh@example.com', 'ipX');
  ok(r.allowed === false && r.reason === 'ip_hour', 'IP with 20 codes in the last hour blocked');

  // --- lead_record dedupe ----------------------------------------------
  const rec = (name: string, email: string, mobile: string, verified: boolean, source = 'ai_brochure', edu: string | null = null) =>
    one(`select public.lead_record($1, $2, $3, 'AI', $4, $5, now(), $6) as id`, [name, email, mobile, source, edu, verified]).then((x) => x.id);
  const id1 = await rec('Asha Rao', 'asha@example.com', '9876500001', false, 'next_batch_notify');
  const id2 = await rec('Asha Rao', 'asha@example.com', '9876500002', false, 'next_batch_notify');
  ok(id1 === id2, 'same email + form within 24h updates the same row');
  ok((await one(`select mobile from public.marketing_leads where id = $1`, [id1])).mobile === '9876500002', 'corrected mobile number saved');
  const v1 = await rec('Ravi K', 'ravi@example.com', '9876500003', true);
  const v2 = await rec('Imposter', 'ravi@example.com', '9876500004', false);
  const ravi = await one(`select name, mobile, email_verified from public.marketing_leads where id = $1`, [v1]);
  ok(v1 === v2 && ravi.name === 'Ravi K' && ravi.email_verified, 'unverified submission never overwrites verified details');
  const legacyMatch = await rec('Old Lead', 'old@example.com', '9876543210', true);
  const legacy = await one(`select count(*)::int as n, bool_and(email_verified) as v from public.marketing_leads where lower(email) = 'old@example.com'`);
  ok(legacy.n === 1 && legacy.v && legacyMatch, 'match is case-insensitive (old mixed-case email upgraded to verified)');

  // --- OTP verify ------------------------------------------------------
  const newRequest = async (email: string, expires = "now() + interval '10 minutes'") => {
    const id = (await one(`select gen_random_uuid() as id`)).id;
    await db.query(`insert into public.lead_otp_requests (id, email, code_hash, name, mobile, program, source, consent_at, expires_at)
                    values ($1, $2, 'right', 'Neha S', '9876500010', 'AI', 'demo_lecture_request', now(), ${expires})`, [id, email]);
    return id;
  };
  const verify = (id: string, hash: string, token: string | null = null) => one(`select public.lead_otp_verify($1, $2, $3, 30) as r`, [id, hash, token]).then((x) => x.r);

  let req = await newRequest('neha@example.com');
  r = await verify(req, 'wrong');
  ok(r.status === 'wrong_code' && r.attempts_left === 4, 'wrong code -> 4 tries left');
  for (let i = 0; i < 3; i++) r = await verify(req, 'wrong');
  ok(r.status === 'wrong_code' && r.attempts_left === 1, '4 wrong codes -> 1 try left');
  r = await verify(req, 'wrong');
  ok(r.status === 'locked', '5th wrong code locks the request');
  r = await verify(req, 'right');
  ok(r.status === 'locked', 'correct code after lock is still refused');

  req = await newRequest('neha@example.com');
  r = await verify(req, 'right', 'tokenhash1');
  ok(r.status === 'verified' && r.lead_id, 'correct code verifies and returns lead id');
  const lead = await one(`select email_verified, source, consent_at is not null as c from public.marketing_leads where id = $1`, [r.lead_id]);
  ok(lead.email_verified && lead.source === 'demo_lecture_request' && lead.c, 'lead stored as verified with consent');
  const trust = await one(`select trusted_until > now() + interval '29 days' as t from public.lead_otp_requests where id = $1`, [req]);
  ok(trust.t, 'trust token stored for 30 days');
  r = await verify(req, 'right');
  ok(r.status === 'used', 'a code can only be used once');

  req = await newRequest('late@example.com', "now() - interval '1 second'");
  r = await verify(req, 'right');
  ok(r.status === 'expired', 'expired code refused');
  r = await verify('00000000-0000-0000-0000-000000000000', 'right');
  ok(r.status === 'not_found', 'unknown request id refused');

  // --- assistant access ------------------------------------------------
  await as('authenticated', '00000000-0000-0000-0000-00000000000a');
  const seen = await one(`select count(*)::int as n from public.marketing_leads`);
  ok(seen.n >= 5, `assistant can read all leads (${seen.n})`);
  ok((await one(`select count(*)::int as n from public.lead_statuses`)).n === 9, 'assistant can read statuses');
  await db.query(`select public.update_marketing_lead($1, $2::jsonb)`, [v1, JSON.stringify({ notes: 'Call after 6pm', follow_up_on: '2026-10-20' })]);
  await db.query(`select public.update_marketing_lead($1, $2::jsonb)`, [v1, JSON.stringify({ status: 'contacted' })]);
  let row = await one(`select status, notes, follow_up_on::text as f, updated_by from public.marketing_leads where id = $1`, [v1]);
  ok(row.status === 'contacted' && row.notes === 'Call after 6pm' && row.f === '2026-10-20', 'status change keeps notes + follow-up (partial update)');
  ok(row.updated_by === '00000000-0000-0000-0000-00000000000a', 'updated_by records the assistant');
  await db.query(`select public.update_marketing_lead($1, $2::jsonb)`, [v1, JSON.stringify({ notes: '  ', follow_up_on: '' })]);
  row = await one(`select notes, follow_up_on from public.marketing_leads where id = $1`, [v1]);
  ok(row.notes === null && row.follow_up_on === null, 'blank notes / follow-up clear the fields');
  await expectError(`select public.update_marketing_lead($1, '{"status":"made_up"}'::jsonb)`, [v1], /Unknown lead status/, 'unknown status refused');
  await expectError(`select public.update_marketing_lead($1, $2::jsonb)`, [v1, JSON.stringify({ notes: 'x'.repeat(2001) })], /at most 2000/, 'notes over 2000 chars refused');
  await db.query(`update public.marketing_leads set status = 'enrolled' where id = '${v1}'`);
  row = await one(`select status from public.marketing_leads where id = $1`, [v1]);
  ok(row.status === 'contacted', 'direct UPDATE by assistant has no effect (RLS)');
  await expectError(`select * from public.lead_otp_requests`, [], /permission denied/, 'assistant cannot read OTP table');

  await as('authenticated', '00000000-0000-0000-0000-00000000000b');
  ok((await one(`select count(*)::int as n from public.marketing_leads`)).n === 0, 'student sees no leads');
  await expectError(`select public.update_marketing_lead($1, '{"status":"enrolled"}'::jsonb)`, [v1], /Only assistants/, 'student cannot update leads');

  // --- purge ----------------------------------------------------------
  await as(null);
  await db.exec(`update public.lead_otp_requests set created_at = now() - interval '2 days'`);
  await db.exec(`update public.lead_form_attempts set created_at = now() - interval '3 days'`);
  await as('service_role');
  await db.query(`select public.lead_otp_purge()`);
  await as(null);
  const left = await one(`select (select count(*)::int from public.lead_otp_requests) as otp, (select count(*)::int from public.lead_form_attempts) as att`);
  ok(left.otp === 1 && left.att === 0, `purge keeps only the row backing a live trust token (otp=${left.otp}, attempts=${left.att})`);

  // --- phase 12 -------------------------------------------------------
  await db.exec(readFileSync(`${repo}/phase12_close_public_lead_inserts.sql`));
  await db.exec(readFileSync(`${repo}/phase12_close_public_lead_inserts.sql`));
  await as('anon');
  await expectError(`insert into public.marketing_leads (name, email, mobile, program, source) values ('After', 'after@example.com', '9876543299', 'AI', 'ai_brochure')`, [], /permission denied|row-level security/, 'after phase12, anon cannot insert at all');
  await as('service_role');
  ok(Boolean(await rec('Svc Path', 'svc@example.com', '9876500020', true)), 'after phase12, the Edge Function path still records leads');

  if (failures) throw new Error(`${failures} SQL check(s) failed`);
});
