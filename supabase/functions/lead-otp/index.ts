// Supabase Edge Function: lead-otp
//
// The website's enquiry forms post here instead of writing to the
// database from the browser. Brochure download and demo lecture request
// verify the visitor's email with a 6-digit code first; the next-batch
// alert form saves straight away. Every form is protected by a
// Cloudflare Turnstile check, server-side validation and rate limits.
//
//   POST { action: 'send', lead, captchaToken, trustToken? }
//     -> { status: 'code_sent', requestId, email, expiresIn, resendAfter }
//     -> { status: 'verified' }  (this browser already verified this email)
//   POST { action: 'verify', requestId, code }
//     -> { status: 'verified', trustToken }
//   POST { action: 'submit', lead, captchaToken, trustToken? }
//     -> { status: 'submitted' }
//   Errors: { code, error, fields?, retryAfter?, attemptsLeft? } with 4xx/5xx.
//
// lead = { name, email, mobile, program, source, education?, consent: true }
// (rules in ./rules.ts — shared with the website).
//
// Deploy (visitors aren't signed in, so no JWT check):
//   supabase functions deploy lead-otp --no-verify-jwt
// Secrets: see .env.example in this folder. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided automatically by Supabase.
// Database objects: phase11_lead_otp.sql.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { createHandler, type LeadStore } from './handler.ts';
import { createEmailSender } from './email.ts';
import { hmacHex } from './security.ts';

const env = (name: string) => Deno.env.get(name);
const log = (message: string, error?: unknown) =>
  console.error(`lead-otp: ${message}`, error instanceof Error ? error.message : error ?? '');

function serviceKey(): string {
  const direct = env('SUPABASE_SERVICE_ROLE_KEY') || env('LEADS_SECRET_KEY');
  if (direct) return direct;
  // Projects on Supabase's newer API keys expose them as JSON.
  try {
    const keys = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}');
    return keys.default || Object.values(keys)[0] || '';
  } catch {
    return '';
  }
}

const SERVICE_KEY = serviceKey();
const db = createClient(env('SUPABASE_URL')!, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function must<T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw error instanceof Error ? error : new Error(JSON.stringify(error));
  return data;
}

const store: LeadStore = {
  attempt: (kind, ipHash, email, limits) =>
    must(
      db.rpc('lead_attempt', {
        p_kind: kind,
        p_ip_hash: ipHash,
        p_email: email,
        p_ip_per_hour: limits.ipPerHour,
        p_email_per_hour: limits.emailPerHour,
        p_email_per_day: limits.emailPerDay,
        p_cooldown_seconds: limits.cooldownSeconds,
        p_global_per_day: limits.globalPerDay,
      }),
    ),

  recordLead: (lead, consentAt, verified) =>
    must(
      db.rpc('lead_record', {
        p_name: lead.name,
        p_email: lead.email,
        p_mobile: lead.mobile,
        p_program: lead.program,
        p_source: lead.source,
        p_education_status: lead.education,
        p_consent_at: consentAt,
        p_verified: verified,
      }),
    ),

  trustedEmail: async (trustTokenHash) => {
    const row = await must(
      db
        .from('lead_otp_requests')
        .select('email')
        .eq('trust_token_hash', trustTokenHash)
        .gt('trusted_until', new Date().toISOString())
        .maybeSingle(),
    );
    return (row as { email: string } | null)?.email ?? null;
  },

  createCode: async (row) => {
    await must(db.from('lead_otp_requests').insert(row));
  },

  markCodeSent: async (requestId, via) => {
    await must(db.from('lead_otp_requests').update({ sent_via: via }).eq('id', requestId));
  },

  cancelPendingCodes: async (email) => {
    const now = new Date().toISOString();
    await must(
      db.from('lead_otp_requests').update({ expires_at: now }).eq('email', email).is('verified_at', null).gt('expires_at', now),
    );
  },

  verifyCode: (requestId, codeHash, trustTokenHash, trustDays) =>
    must(
      db.rpc('lead_otp_verify', {
        p_request_id: requestId,
        p_code_hash: codeHash,
        p_trust_token_hash: trustTokenHash,
        p_trust_days: trustDays,
      }),
    ),

  purge: async () => {
    await must(db.rpc('lead_otp_purge'));
  },
};

// Cloudflare Turnstile ("I'm not a robot") server-side check.
async function verifyCaptcha(token: unknown, ip: string | null, action: string): Promise<boolean> {
  const secret = env('TURNSTILE_SECRET_KEY');
  if (!secret) throw new Error('TURNSTILE_SECRET_KEY is not set');
  if (typeof token !== 'string' || !token || token.length > 2048) return false;

  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Turnstile ${response.status}`);
  const result = await response.json();
  if (!result.success) return false;
  // Cloudflare's test keys report no action; real ones must match.
  return !result.action || result.action === action;
}

const allowedOrigins = (env('ALLOWED_ORIGINS') || 'https://utkarshminds.com,https://www.utkarshminds.com,http://localhost:4321')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

Deno.serve(
  createHandler({
    store,
    verifyCaptcha,
    sendCode: createEmailSender(env, log),
    hashIp: (ip) => hmacHex(SERVICE_KEY, ip),
    allowedOrigins,
    dailyCodeLimit: Number(env('OTP_DAILY_LIMIT')) || 300,
    log,
  }),
);
