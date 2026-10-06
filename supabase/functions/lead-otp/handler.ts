// The lead-otp request logic. index.ts plugs in the real database,
// CAPTCHA check and email sender; tests plug in stand-ins
// (run: deno test supabase/functions/lead-otp).

import { cleanOtp, LEAD_SOURCES, OTP_LENGTH, validateLead, type CleanLead } from './rules.ts';
import { codeHash, randomCode, randomToken, sha256Hex, UUID_RE } from './security.ts';

export const CODE_TTL_MINUTES = 10;
export const RESEND_AFTER_SECONDS = 60;
export const TRUST_DAYS = 30;
const MAX_BODY_BYTES = 4096;
const PURGE_CHANCE = 0.05;

// Rate limits per action (null = not limited that way). The daily cap on
// codes sent by the whole site comes from OTP_DAILY_LIMIT (see index.ts).
export const LIMITS = {
  code: { ipPerHour: 20, emailPerHour: 5, emailPerDay: 10, cooldownSeconds: RESEND_AFTER_SECONDS },
  submit: { ipPerHour: 20, emailPerHour: 5, emailPerDay: 10, cooldownSeconds: null },
  verify: { ipPerHour: 60, emailPerHour: null, emailPerDay: null, cooldownSeconds: null },
} as const;

export type AttemptKind = keyof typeof LIMITS;

export interface AttemptLimits {
  ipPerHour: number | null;
  emailPerHour: number | null;
  emailPerDay: number | null;
  cooldownSeconds: number | null;
  globalPerDay: number | null;
}

export interface AttemptResult {
  allowed: boolean;
  reason?: 'ip_hour' | 'cooldown' | 'email_hour' | 'email_day' | 'global_day';
  retry_after?: number;
}

export type VerifyResult =
  | { status: 'verified'; lead_id: string }
  | { status: 'wrong_code'; attempts_left: number }
  | { status: 'locked' | 'expired' | 'used' | 'not_found' };

export interface CodeRow {
  id: string;
  email: string;
  code_hash: string;
  name: string;
  mobile: string;
  program: string;
  source: string;
  education_status: string | null;
  consent_at: string;
  expires_at: string;
}

// Everything the handler needs from the database (see phase11_lead_otp.sql).
export interface LeadStore {
  attempt(kind: AttemptKind, ipHash: string | null, email: string | null, limits: AttemptLimits): Promise<AttemptResult>;
  recordLead(lead: CleanLead, consentAt: string, verified: boolean): Promise<string>;
  trustedEmail(trustTokenHash: string): Promise<string | null>;
  createCode(row: CodeRow): Promise<void>;
  markCodeSent(requestId: string, via: string): Promise<void>;
  cancelPendingCodes(email: string): Promise<void>;
  verifyCode(requestId: string, codeHash: string, trustTokenHash: string, trustDays: number): Promise<VerifyResult>;
  purge(): Promise<void>;
}

export interface OtpMessage {
  to: string;
  name: string;
  code: string;
  minutes: number;
  purpose: string;
  requestId: string;
}

export interface HandlerDeps {
  store: LeadStore;
  verifyCaptcha(token: unknown, ip: string | null, action: string): Promise<boolean>;
  sendCode(message: OtpMessage): Promise<string>; // returns the provider that sent it
  hashIp(ip: string): Promise<string>;
  allowedOrigins: string[];
  dailyCodeLimit: number;
  log?: (message: string, error?: unknown) => void;
  random?: () => number;
}

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

function clientIp(req: Request): string | null {
  const raw =
    req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip');
  const ip = raw?.trim();
  return ip && ip.length <= 64 ? ip : null;
}

const RATE_MESSAGES: Record<AttemptKind, Partial<Record<NonNullable<AttemptResult['reason']>, string>>> = {
  code: {
    cooldown: 'Please wait a moment before asking for another code.',
    email_hour: 'Too many codes were requested for this email. Please try again later.',
    email_day: 'Too many codes were requested for this email today. Please try again tomorrow, or reach us on WhatsApp.',
  },
  submit: {
    email_hour: 'We already have your details — our team will contact you soon.',
    email_day: 'We already have your details — our team will contact you soon.',
  },
  verify: {},
};
const RATE_FALLBACK: Record<string, string> = {
  ip_hour: 'Too many attempts from your network. Please try again in a while.',
  global_day: "We're receiving a lot of requests right now. Please try again later, or reach us on WhatsApp.",
};

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const log =
    deps.log ?? ((message: string, error?: unknown) => console.error(`lead-otp: ${message}`, error instanceof Error ? error.message : error ?? ''));
  const random = deps.random ?? Math.random;

  function parseLead(raw: unknown): CleanLead {
    const result = validateLead(raw);
    if (!result.ok) throw new HttpError(400, 'invalid', 'Please check the highlighted fields.', { fields: result.errors });
    return result.lead;
  }

  async function requireCaptcha(token: unknown, ip: string | null, action: string) {
    let passed = false;
    try {
      passed = await deps.verifyCaptcha(token, ip, action);
    } catch (error) {
      log('captcha check failed', error);
      throw new HttpError(503, 'captcha_unavailable', "We couldn't run the security check right now. Please try again.");
    }
    if (!passed) throw new HttpError(403, 'captcha_failed', 'The security check failed. Please try again.');
  }

  async function limit(kind: AttemptKind, ipHash: string | null, email: string | null) {
    const result = await deps.store.attempt(kind, ipHash, email, {
      ...LIMITS[kind],
      globalPerDay: kind === 'code' ? deps.dailyCodeLimit : null,
    });
    if (result.allowed) return;
    const reason = result.reason ?? 'ip_hour';
    const message = RATE_MESSAGES[kind][reason] ?? RATE_FALLBACK[reason] ?? RATE_FALLBACK.ip_hour;
    throw new HttpError(429, 'rate_limited', message, { reason, retryAfter: result.retry_after ?? 60 });
  }

  // A browser that verified this same email recently keeps a token, so the
  // visitor isn't asked for a new code on every form.
  async function isTrusted(token: unknown, email: string): Promise<boolean> {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    return (await deps.store.trustedEmail(await sha256Hex(token))) === email;
  }

  async function maybePurge() {
    if (random() >= PURGE_CHANCE) return;
    try {
      await deps.store.purge();
    } catch (error) {
      log('purge failed', error);
    }
  }

  async function send(body: any, ip: string | null, ipHash: string | null) {
    const lead = parseLead(body?.lead);
    const form = LEAD_SOURCES[lead.source];
    if (!form.requiresOtp) throw new HttpError(400, 'bad_request', 'This form does not use email verification.');
    await requireCaptcha(body?.captchaToken, ip, 'lead_send');
    const now = new Date();

    if (await isTrusted(body?.trustToken, lead.email)) {
      await limit('submit', ipHash, lead.email);
      await deps.store.recordLead(lead, now.toISOString(), true);
      await maybePurge();
      return { status: 'verified' };
    }

    await limit('code', ipHash, lead.email);

    const requestId = crypto.randomUUID();
    const code = randomCode(OTP_LENGTH);
    // A new code replaces any earlier one for this email.
    await deps.store.cancelPendingCodes(lead.email);
    await deps.store.createCode({
      id: requestId,
      email: lead.email,
      code_hash: await codeHash(requestId, code),
      name: lead.name,
      mobile: lead.mobile,
      program: lead.program,
      source: lead.source,
      education_status: lead.education,
      consent_at: now.toISOString(),
      expires_at: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000).toISOString(),
    });

    let via: string;
    try {
      via = await deps.sendCode({ to: lead.email, name: lead.name, code, minutes: CODE_TTL_MINUTES, purpose: form.purpose, requestId });
    } catch (error) {
      log('could not send the code email', error);
      await deps.store.cancelPendingCodes(lead.email).catch((e) => log('could not cancel unsent code', e));
      throw new HttpError(503, 'email_failed', "We couldn't send the email right now. Please try again in a few minutes, or reach us on WhatsApp.");
    }
    await deps.store.markCodeSent(requestId, via).catch((e) => log('could not record the sending provider', e));
    await maybePurge();

    return {
      status: 'code_sent',
      requestId,
      email: lead.email,
      expiresIn: CODE_TTL_MINUTES * 60,
      resendAfter: RESEND_AFTER_SECONDS,
    };
  }

  async function verify(body: any, ipHash: string | null) {
    const requestId = typeof body?.requestId === 'string' && UUID_RE.test(body.requestId) ? body.requestId : null;
    if (!requestId) throw new HttpError(410, 'expired', 'This code has expired. Please request a new one.');
    const code = cleanOtp(body?.code);
    if (code.length !== OTP_LENGTH) {
      throw new HttpError(400, 'invalid_code', `Enter the ${OTP_LENGTH}-digit code from your email.`);
    }
    await limit('verify', ipHash, null);

    const trustToken = randomToken();
    const result = await deps.store.verifyCode(requestId, await codeHash(requestId, code), await sha256Hex(trustToken), TRUST_DAYS);

    switch (result.status) {
      case 'verified':
        return { status: 'verified', trustToken };
      case 'wrong_code': {
        const left = result.attempts_left;
        throw new HttpError(400, 'wrong_code', `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, {
          attemptsLeft: left,
        });
      }
      case 'locked':
        throw new HttpError(410, 'locked', 'Too many wrong tries. Please request a new code.');
      case 'used':
        throw new HttpError(410, 'used', 'This code has already been used. Please request a new one.');
      default:
        throw new HttpError(410, 'expired', 'This code has expired. Please request a new one.');
    }
  }

  async function submit(body: any, ip: string | null, ipHash: string | null) {
    const lead = parseLead(body?.lead);
    if (LEAD_SOURCES[lead.source].requiresOtp) {
      throw new HttpError(400, 'bad_request', 'This form needs email verification.');
    }
    await requireCaptcha(body?.captchaToken, ip, 'lead_submit');
    const verified = await isTrusted(body?.trustToken, lead.email);
    await limit('submit', ipHash, lead.email);
    await deps.store.recordLead(lead, new Date().toISOString(), verified);
    await maybePurge();
    return { status: 'submitted' };
  }

  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('Origin');
    const allowedOrigin = origin && deps.allowedOrigins.includes(origin) ? origin : null;
    const cors: Record<string, string> = {
      'Access-Control-Allow-Origin': allowedOrigin ?? deps.allowedOrigins[0] ?? '',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });

    // Browsers always send Origin on these requests; only our own site may call.
    if (origin && !allowedOrigin) return reply(403, { code: 'origin', error: 'Not allowed.' });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply(405, { code: 'method', error: 'Method not allowed.' });

    let body: any;
    try {
      const text = await req.text();
      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return reply(413, { code: 'too_large', error: 'Request too large.' });
      body = JSON.parse(text);
    } catch {
      return reply(400, { code: 'bad_request', error: 'Invalid request.' });
    }

    try {
      const ip = clientIp(req);
      const ipHash = ip ? await deps.hashIp(ip) : null;
      switch (body?.action) {
        case 'send':
          return reply(200, await send(body, ip, ipHash));
        case 'verify':
          return reply(200, await verify(body, ipHash));
        case 'submit':
          return reply(200, await submit(body, ip, ipHash));
        default:
          return reply(400, { code: 'bad_request', error: 'Invalid request.' });
      }
    } catch (error) {
      if (error instanceof HttpError) return reply(error.status, { code: error.code, error: error.message, ...error.extra });
      log('unexpected error', error);
      return reply(500, { code: 'server_error', error: 'Something went wrong on our side. Please try again in a minute.' });
    }
  };
}
