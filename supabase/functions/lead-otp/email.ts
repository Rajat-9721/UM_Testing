// Sends the verification-code email.
//
// Providers are tried in order (EMAIL_PROVIDERS, default "resend,smtp"),
// skipping any that aren't configured. If the first one fails for any
// reason — including Resend's free plan running out for the day — the
// next one is used automatically, so nobody has to watch the limits.
//
//   resend  Resend's HTTPS API (RESEND_API_KEY, RESEND_FROM)
//   smtp    any SMTP mailbox, e.g. the cPanel one
//           (SMTP_HOST, SMTP_PORT=465, SMTP_USER, SMTP_PASS, SMTP_FROM).
//           Supabase blocks outgoing ports 25 and 587, so use 465 (SSL).

import nodemailer from 'npm:nodemailer@10.0.15';
import type { OtpMessage } from './handler.ts';

type Env = (name: string) => string | undefined;

interface Rendered {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

// Only the first name, and at most 30 characters, ever goes into the
// email — limits what anyone could smuggle into a message sent from our
// domain via the name field.
const firstName = (name: string) => [...(name.split(' ')[0] ?? '')].slice(0, 30).join('');

export function renderOtpEmail(message: OtpMessage): Rendered {
  const greetingName = firstName(message.name);
  const subject = `${message.code} is your Utkarsh Minds verification code`;
  const text = [
    `Hi ${greetingName},`,
    '',
    `Your verification code is: ${message.code}`,
    '',
    `Enter it on the Utkarsh Minds website to ${message.purpose}. It expires in ${message.minutes} minutes.`,
    '',
    "If you didn't ask for this code, you can ignore this email.",
    '',
    'Utkarsh Minds',
    'https://utkarshminds.com',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#faf6ee;font-family:Arial,Helvetica,sans-serif;color:#211f1b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ee;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e2d9c4;border-radius:12px;">
            <tr>
              <td style="padding:28px 28px 8px;font-size:18px;font-weight:bold;color:#1b3d34;">Utkarsh Minds</td>
            </tr>
            <tr>
              <td style="padding:8px 28px 0;font-size:15px;line-height:1.6;">
                Hi ${escapeHtml(greetingName)},<br />
                Use this code to ${escapeHtml(message.purpose)}:
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 28px;">
                <div style="display:inline-block;padding:14px 22px;background:#f1ead9;border-radius:8px;font-family:'Courier New',Courier,monospace;font-size:30px;font-weight:bold;letter-spacing:8px;color:#1b3d34;">${message.code}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 24px;font-size:13px;line-height:1.6;color:#5b564c;">
                The code expires in ${message.minutes} minutes.<br />
                If you didn't ask for this code, you can ignore this email.
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;border-top:1px solid #e2d9c4;font-size:12px;color:#5b564c;">
                <a href="https://utkarshminds.com" style="color:#1b3d34;">utkarshminds.com</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

async function sendWithResend(env: Env, message: OtpMessage, email: Rendered): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
      // A retry of the same request never sends the email twice.
      'Idempotency-Key': message.requestId,
    },
    body: JSON.stringify({
      from: env('RESEND_FROM') || 'Utkarsh Minds <onboarding@resend.dev>',
      to: [message.to],
      reply_to: env('EMAIL_REPLY_TO') || undefined,
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // e.g. 429 daily_quota_exceeded, 403 unverified domain — logged, then
    // the next provider is tried.
    throw new Error(`Resend ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
}

async function sendWithSmtp(env: Env, message: OtpMessage, email: Rendered): Promise<void> {
  const port = Number(env('SMTP_PORT') || 465);
  const transporter = nodemailer.createTransport({
    host: env('SMTP_HOST'),
    port,
    secure: port === 465,
    auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    await transporter.sendMail({
      from: env('SMTP_FROM') || `Utkarsh Minds <${env('SMTP_USER')}>`,
      to: message.to,
      replyTo: env('EMAIL_REPLY_TO') || undefined,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  } finally {
    transporter.close();
  }
}

const PROVIDERS = {
  resend: { configured: (env: Env) => Boolean(env('RESEND_API_KEY')), send: sendWithResend },
  smtp: {
    configured: (env: Env) => Boolean(env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS')),
    send: sendWithSmtp,
  },
};
type ProviderName = keyof typeof PROVIDERS;

export function providerOrder(env: Env): ProviderName[] {
  const requested = (env('EMAIL_PROVIDERS') || 'resend,smtp').split(',').map((p) => p.trim().toLowerCase());
  return requested.filter((p): p is ProviderName => p in PROVIDERS && PROVIDERS[p as ProviderName].configured(env));
}

export function createEmailSender(env: Env, log: (message: string, error?: unknown) => void) {
  return async (message: OtpMessage): Promise<string> => {
    const order = providerOrder(env);
    if (!order.length) throw new Error('No email provider is configured (set RESEND_API_KEY and/or SMTP_* secrets).');
    const email = renderOtpEmail(message);
    let lastError: unknown;
    for (const name of order) {
      try {
        await PROVIDERS[name].send(env, message, email);
        return name;
      } catch (error) {
        lastError = error;
        log(`${name} could not send`, error);
      }
    }
    throw lastError;
  };
}
