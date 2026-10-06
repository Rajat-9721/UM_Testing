// Run: deno test supabase/functions/lead-otp
// Exercises the request logic with an in-memory stand-in for the
// database (the real SQL is tested separately against Postgres).
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';
import { createHandler, type AttemptLimits, type CodeRow, type LeadStore, type OtpMessage, type VerifyResult } from './handler.ts';
import type { CleanLead } from './rules.ts';
import { codeHash, sha256Hex } from './security.ts';

const ORIGIN = 'https://utkarshminds.com';

function setup(overrides: { captcha?: boolean | 'throw'; emailFails?: boolean; allowed?: boolean; storeThrows?: boolean } = {}) {
  const codes = new Map<string, CodeRow & { attempts: number; verified: boolean; trustHash?: string }>();
  const leads: { lead: CleanLead; verified: boolean; consentAt: string }[] = [];
  const attempts: { kind: string; ipHash: string | null; email: string | null; limits: AttemptLimits }[] = [];
  const sent: OtpMessage[] = [];
  const logs: string[] = [];

  const store: LeadStore = {
    attempt: async (kind, ipHash, email, limits) => {
      attempts.push({ kind, ipHash, email, limits });
      return overrides.allowed === false ? { allowed: false, reason: 'cooldown', retry_after: 42 } : { allowed: true };
    },
    recordLead: async (lead, consentAt, verified) => {
      if (overrides.storeThrows) throw new Error('db down: secret details');
      leads.push({ lead, verified, consentAt });
      return 'lead-1';
    },
    trustedEmail: async (hash) => [...codes.values()].find((c) => c.trustHash === hash)?.email ?? null,
    createCode: async (row) => void codes.set(row.id, { ...row, attempts: 0, verified: false }),
    markCodeSent: async () => {},
    cancelPendingCodes: async (email) => {
      for (const c of codes.values()) if (c.email === email && !c.verified) c.expires_at = new Date(0).toISOString();
    },
    verifyCode: async (id, hash, trustHash): Promise<VerifyResult> => {
      const c = codes.get(id);
      if (!c) return { status: 'not_found' };
      if (c.verified) return { status: 'used' };
      if (c.attempts >= 5) return { status: 'locked' };
      if (new Date(c.expires_at) <= new Date()) return { status: 'expired' };
      if (c.code_hash !== hash) {
        c.attempts++;
        return c.attempts >= 5 ? { status: 'locked' } : { status: 'wrong_code', attempts_left: 5 - c.attempts };
      }
      c.verified = true;
      c.trustHash = trustHash;
      leads.push({ lead: { ...c, education: c.education_status } as unknown as CleanLead, verified: true, consentAt: c.consent_at });
      return { status: 'verified', lead_id: 'lead-1' };
    },
    purge: async () => {},
  };

  const handler = createHandler({
    store,
    verifyCaptcha: async (token) => {
      if (overrides.captcha === 'throw') throw new Error('turnstile down');
      return (overrides.captcha ?? true) && token === 'captcha-ok';
    },
    sendCode: async (message) => {
      if (overrides.emailFails) throw new Error('smtp down');
      sent.push(message);
      return 'resend';
    },
    hashIp: async (ip) => `hash(${ip})`,
    allowedOrigins: [ORIGIN],
    dailyCodeLimit: 300,
    log: (message) => logs.push(message),
    random: () => 1, // never purge in tests
  });

  const call = async (body: unknown, init: { origin?: string | null; method?: string; raw?: string } = {}) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' };
    const origin = init.origin === undefined ? ORIGIN : init.origin;
    if (origin) headers.Origin = origin;
    const res = await handler(
      new Request('https://x.supabase.co/functions/v1/lead-otp', {
        method: init.method ?? 'POST',
        headers,
        body: init.method === 'OPTIONS' || init.method === 'GET' ? undefined : init.raw ?? JSON.stringify(body),
      }),
    );
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
  };

  return { call, codes, leads, attempts, sent, logs };
}

const lead = (extra: Record<string, unknown> = {}) => ({
  name: 'Neha Sharma',
  email: 'Neha@Example.com',
  mobile: '+91 98765 43210',
  program: 'Professional Certification in AI',
  source: 'ai_brochure',
  consent: true,
  ...extra,
});

Deno.test('CORS: only our own site may call', async () => {
  const t = setup();
  const pre = await t.call(null, { method: 'OPTIONS' });
  assertEquals(pre.status, 204);
  assertEquals(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const evil = await t.call({ action: 'send', lead: lead(), captchaToken: 'captcha-ok' }, { origin: 'https://evil.example' });
  assertEquals(evil.status, 403);
  assertEquals(t.sent.length, 0);
});

Deno.test('bad requests are refused politely', async () => {
  const t = setup();
  assertEquals((await t.call(null, { raw: '{not json' })).status, 400);
  assertEquals((await t.call({ action: 'delete_everything' })).status, 400);
  assertEquals((await t.call(null, { raw: JSON.stringify({ action: 'send', pad: 'x'.repeat(5000) }) })).status, 413);
  assertEquals((await t.call(null, { method: 'GET' })).status, 405);
});

Deno.test('send: invalid fields come back per field, nothing is sent', async () => {
  const t = setup();
  const res = await t.call({ action: 'send', lead: lead({ email: 'nope', mobile: '123', consent: false }), captchaToken: 'captcha-ok' });
  assertEquals(res.status, 400);
  assertEquals(Object.keys(res.json.fields).sort(), ['consent', 'email', 'mobile']);
  assertEquals(t.sent.length, 0);
  assertEquals(t.attempts.length, 0);
});

Deno.test('send: CAPTCHA is required', async () => {
  const t = setup();
  assertEquals((await t.call({ action: 'send', lead: lead(), captchaToken: 'wrong' })).status, 403);
  assertEquals((await t.call({ action: 'send', lead: lead() })).status, 403);
  assertEquals((await setup({ captcha: 'throw' }).call({ action: 'send', lead: lead(), captchaToken: 'captcha-ok' })).status, 503);
  assertEquals(t.sent.length, 0);
});

Deno.test('send -> verify: happy path', async () => {
  const t = setup();
  const sent = await t.call({ action: 'send', lead: lead(), captchaToken: 'captcha-ok' });
  assertEquals(sent.status, 200);
  assertEquals(sent.json.status, 'code_sent');
  assertEquals(sent.json.email, 'neha@example.com');
  assertEquals(sent.json.expiresIn, 600);
  assertEquals(sent.json.resendAfter, 60);

  // The email got a 6-digit code; the database only has its hash.
  assertEquals(t.sent.length, 1);
  const code = t.sent[0].code;
  assertMatch(code, /^\d{6}$/);
  const row = t.codes.get(sent.json.requestId)!;
  assertEquals(row.code_hash, await codeHash(sent.json.requestId, code));
  assert(!JSON.stringify(row).includes(`"${code}"`));
  assertEquals(row.mobile, '9876543210');
  assertEquals(t.attempts[0].kind, 'code');
  assertEquals(t.attempts[0].ipHash, 'hash(203.0.113.7)');
  assertEquals(t.attempts[0].limits.globalPerDay, 300);

  const wrongCode = code === '000000' ? '111111' : '000000';
  const wrong = await t.call({ action: 'verify', requestId: sent.json.requestId, code: wrongCode });
  assertEquals(wrong.status, 400);
  assertEquals(wrong.json.attemptsLeft, 4);
  assertEquals(wrong.json.error, "That code isn't right. 4 tries left.");

  const ok = await t.call({ action: 'verify', requestId: sent.json.requestId, code: `${code.slice(0, 3)} ${code.slice(3)}` });
  assertEquals(ok.status, 200);
  assertEquals(ok.json.status, 'verified');
  assertMatch(ok.json.trustToken, /^[A-Za-z0-9_-]{43}$/);
  assertEquals(row.trustHash, await sha256Hex(ok.json.trustToken));
  assertEquals(t.leads.length, 1);
  assertEquals(t.leads[0].verified, true);

  const again = await t.call({ action: 'verify', requestId: sent.json.requestId, code });
  assertEquals(again.status, 410);
  assertEquals(again.json.code, 'used');
});

Deno.test('send: a new code cancels the previous one', async () => {
  const t = setup();
  const first = await t.call({ action: 'send', lead: lead(), captchaToken: 'captcha-ok' });
  await t.call({ action: 'send', lead: lead(), captchaToken: 'captcha-ok' });
  const old = await t.call({ action: 'verify', requestId: first.json.requestId, code: t.sent[0].code });
  assertEquals(old.status, 410);
  assertEquals(old.json.code, 'expired');
});

Deno.test('send: rate limit returns a wait time', async () => {
  const t = setup({ allowed: false });
  const res = await t.call({ action: 'send', lead: lead(), captchaToken: 'captcha-ok' });
  assertEquals(res.status, 429);
  assertEquals(res.json.retryAfter, 42);
  assertEquals(res.json.reason, 'cooldown');
  assertEquals(t.sent.length, 0);
});

Deno.test('send: if no email provider works, the code is cancelled', async () => {
  const t = setup({ emailFails: true });
  const res = await t.call({ action: 'send', lead: lead(), captchaToken: 'captcha-ok' });
  assertEquals(res.status, 503);
  assertEquals(res.json.code, 'email_failed');
  const row = [...t.codes.values()][0];
  assert(new Date(row.expires_at) <= new Date());
});

Deno.test('verify: malformed input', async () => {
  const t = setup();
  assertEquals((await t.call({ action: 'verify', requestId: 'not-a-uuid', code: '123456' })).status, 410);
  const short = await t.call({ action: 'verify', requestId: crypto.randomUUID(), code: '12345' });
  assertEquals(short.status, 400);
  assertEquals(short.json.code, 'invalid_code');
  assertEquals((await t.call({ action: 'verify', requestId: crypto.randomUUID(), code: '123456' })).json.code, 'expired');
});

Deno.test('verify: five wrong codes lock the request', async () => {
  const t = setup();
  const sent = await t.call({ action: 'send', lead: lead(), captchaToken: 'captcha-ok' });
  const wrongCode = t.sent[0].code === '000000' ? '111111' : '000000';
  let res;
  for (let i = 0; i < 5; i++) res = await t.call({ action: 'verify', requestId: sent.json.requestId, code: wrongCode });
  assertEquals(res!.json.code, 'locked');
  const right = await t.call({ action: 'verify', requestId: sent.json.requestId, code: t.sent[0].code });
  assertEquals(right.json.code, 'locked');
});

Deno.test('trusted browser: same email skips the code, other email does not', async () => {
  const t = setup();
  const sent = await t.call({ action: 'send', lead: lead(), captchaToken: 'captcha-ok' });
  const { json } = await t.call({ action: 'verify', requestId: sent.json.requestId, code: t.sent[0].code });

  const demo = await t.call({
    action: 'send',
    lead: lead({ source: 'demo_lecture_request', education: 'Graduate' }),
    captchaToken: 'captcha-ok',
    trustToken: json.trustToken,
  });
  assertEquals(demo.json.status, 'verified');
  assertEquals(t.sent.length, 1); // no second email
  assertEquals(t.leads.at(-1)!.verified, true);

  const other = await t.call({ action: 'send', lead: lead({ email: 'someone.else@example.com' }), captchaToken: 'captcha-ok', trustToken: json.trustToken });
  assertEquals(other.json.status, 'code_sent');
  assertEquals(t.sent.length, 2);
});

Deno.test('submit: next-batch alert saves without a code', async () => {
  const t = setup();
  const res = await t.call({ action: 'submit', lead: lead({ source: 'next_batch_notify' }), captchaToken: 'captcha-ok' });
  assertEquals(res.status, 200);
  assertEquals(res.json.status, 'submitted');
  assertEquals(t.leads[0].verified, false);
  assertEquals(t.sent.length, 0);

  // Forms that need a code can't sneak in through submit.
  const sneaky = await t.call({ action: 'submit', lead: lead({ source: 'ai_brochure' }), captchaToken: 'captcha-ok' });
  assertEquals(sneaky.status, 400);
  assertEquals((await t.call({ action: 'submit', lead: lead({ source: 'next_batch_notify' }) })).status, 403);
});

Deno.test('unexpected errors never leak details', async () => {
  const t = setup({ storeThrows: true });
  const res = await t.call({ action: 'submit', lead: lead({ source: 'next_batch_notify' }), captchaToken: 'captcha-ok' });
  assertEquals(res.status, 500);
  assert(!JSON.stringify(res.json).includes('secret'));
  assertEquals(t.logs, ['unexpected error']);
});
