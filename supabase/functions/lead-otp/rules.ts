// Rules for the website's enquiry forms, shared by the browser
// (astro-site/src/lib/leads/) and the lead-otp Edge Function, so both
// always agree on what is valid. The server's verdict is the one that
// counts — the browser runs the same checks only to show errors early.
//
// Plain TypeScript with no imports and no Deno/browser APIs, so it can
// be loaded by both. Keep it that way.

export type LeadSource = 'ai_brochure' | 'demo_lecture_request' | 'next_batch_notify';

// Which forms exist, how they're labelled for assistants, and whether a
// visitor must verify their email with a code before the lead is saved.
export const LEAD_SOURCES: Record<LeadSource, { label: string; requiresOtp: boolean; purpose: string }> = {
  ai_brochure: { label: 'Brochure download', requiresOtp: true, purpose: 'download the program brochure' },
  demo_lecture_request: { label: 'Demo lecture request', requiresOtp: true, purpose: 'book your free demo lecture' },
  next_batch_notify: { label: 'Next batch alert', requiresOtp: false, purpose: 'get next batch updates' },
};

// Options of the "Current Education / Status" dropdown on the demo form.
export const EDUCATION_OPTIONS = [
  'Currently pursuing graduation',
  'Diploma holder',
  'Graduate',
  'Postgraduate / PGDM',
  'PhD scholar',
  'Working professional',
] as const;

export const OTP_LENGTH = 6;
export const NAME_MAX = 80;
export const EMAIL_MAX = 254;

export type LeadField = 'name' | 'email' | 'mobile' | 'program' | 'source' | 'education' | 'consent';
export type FieldErrors = Partial<Record<LeadField, string>>;

export interface CleanLead {
  name: string;
  email: string;
  mobile: string; // 10 digits, no +91
  program: string;
  source: LeadSource;
  education: string | null;
}

// Digits typed on Indian-language keyboards (e.g. Devanagari "९८७६")
// and full-width digits become plain 0–9.
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0xff10];
export function toAsciiDigits(value: string): string {
  return value.replace(/\p{Nd}/gu, (ch) => {
    const cp = ch.codePointAt(0)!;
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9);
    return zero === undefined ? ch : String(cp - zero);
  });
}

// Invisible characters that have no place in a name or email: control
// characters, zero-width spaces, BOM and the right-to-left override
// tricks used to disguise text. (ZWJ/ZWNJ are kept — Indic scripts use
// them inside names.)
const INVISIBLE = /[\p{Cc}​‎‏‪-‮⁠-⁤﻿]/gu;

function basicClean(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanName(raw: unknown): { value: string; error?: string } {
  const value = basicClean(raw);
  const letters = (value.match(/\p{L}/gu) ?? []).length;
  if (letters < 2) return { value, error: 'Please enter your full name.' };
  if ([...value].length > NAME_MAX) return { value, error: `Please keep your name under ${NAME_MAX} characters.` };
  // Letters from any language, spaces, and . ' ’ - (e.g. "D'Souza", "Ram-Prasad K.")
  if (!/^\p{L}[\p{L}\p{M}‌‍ .'’-]*$/u.test(value)) {
    return { value, error: 'Please use letters only — no numbers or symbols.' };
  }
  return { value };
}

const EMAIL_LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const EMAIL_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export function cleanEmail(raw: unknown): { value: string; error?: string } {
  const value = String(raw ?? '').normalize('NFC').replace(INVISIBLE, '').trim().toLowerCase();
  const invalid = { value, error: 'Please enter a valid email address.' };
  if (!value) return { value, error: 'Please enter your email address.' };
  if (value.length > EMAIL_MAX || /\s/.test(value)) return invalid;
  const at = value.lastIndexOf('@');
  if (at < 1 || value.indexOf('@') !== at) return invalid;
  const local = value.slice(0, at);
  const labels = value.slice(at + 1).split('.');
  if (local.length > 64 || !EMAIL_LOCAL.test(local)) return invalid;
  if (labels.length < 2 || !labels.every((l) => EMAIL_LABEL.test(l)) || !EMAIL_TLD.test(labels[labels.length - 1])) {
    return invalid;
  }
  return { value };
}

// Common misspellings of popular email domains. Only used to *suggest* a
// fix ("Did you mean …?") — never to change or block what was typed.
const DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com', 'gmail.in': 'gmail.com', 'gmail.co.in': 'gmail.com',
  'gmil.com': 'gmail.com', 'gmali.com': 'gmail.com',
  'yahoo.con': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.cm': 'yahoo.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outllok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outlook.con': 'outlook.com',
  'redifmail.com': 'rediffmail.com', 'rediffmail.co': 'rediffmail.com', 'rediffmail.con': 'rediffmail.com',
  'icloud.co': 'icloud.com', 'icloud.con': 'icloud.com',
};

export function suggestEmail(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const fix = DOMAIN_TYPOS[email.slice(at + 1).toLowerCase()];
  return fix ? `${email.slice(0, at)}@${fix}` : null;
}

// Indian mobile numbers. Accepts what people actually type —
// "+91 98765 43210", "098765-43210", "(98765) 43210" — and returns the
// plain 10 digits.
export function cleanMobile(raw: unknown): { value: string; error?: string } {
  let digits = toAsciiDigits(String(raw ?? '')).replace(/[\s\-().]/g, '');
  if (!digits) return { value: '', error: 'Please enter your mobile number.' };
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('+')) return { value: digits, error: 'Please enter an Indian mobile number (+91).' };
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9][0-9]{9}$/.test(digits)) return { value: digits, error: 'Please enter a valid 10-digit mobile number.' };
  if (/^(\d)\1{9}$/.test(digits)) return { value: digits, error: 'Please enter your real mobile number.' };
  return { value: digits };
}

export function cleanOtp(raw: unknown): string {
  return toAsciiDigits(String(raw ?? '')).replace(/\D/g, '');
}

export function isLeadSource(value: unknown): value is LeadSource {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LEAD_SOURCES, value);
}

// Validates and normalises a whole form. Returns every field error at
// once so the form can highlight all of them together.
export function validateLead(raw: any): { ok: true; lead: CleanLead } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};

  const name = cleanName(raw?.name);
  if (name.error) errors.name = name.error;

  const email = cleanEmail(raw?.email);
  if (email.error) errors.email = email.error;

  const mobile = cleanMobile(raw?.mobile);
  if (mobile.error) errors.mobile = mobile.error;

  const program = basicClean(raw?.program);
  if (program.length < 2 || program.length > 120) errors.program = 'Unknown program.';

  const source = raw?.source;
  if (!isLeadSource(source)) errors.source = 'Unknown form.';

  let education: string | null = null;
  if (source === 'demo_lecture_request') {
    const value = basicClean(raw?.education);
    if (value) {
      if ((EDUCATION_OPTIONS as readonly string[]).includes(value)) education = value;
      else errors.education = 'Please pick an option from the list.';
    }
  }

  if (raw?.consent !== true) errors.consent = 'Please tick this box so our team can contact you.';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    lead: {
      name: name.value,
      email: email.value,
      mobile: mobile.value,
      program,
      source: source as LeadSource,
      education,
    },
  };
}
