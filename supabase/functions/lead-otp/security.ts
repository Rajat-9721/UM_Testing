// Small crypto helpers for lead-otp. Web Crypto only, so they run the
// same in Supabase Edge Functions and in `deno test`.

const encoder = new TextEncoder();

const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

export async function hmacHex(key: string, text: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(text)));
}

// A uniformly random numeric code. Values from the top of the 32-bit
// range are re-drawn so every code is exactly as likely as any other.
export function randomCode(length: number): string {
  const max = 10 ** length;
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return String(buf[0] % max).padStart(length, '0');
}

// 256-bit random token, URL-safe base64.
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The code is stored only as a hash, salted with its own request id so
// identical codes in different requests don't share a hash.
export function codeHash(requestId: string, code: string): Promise<string> {
  return sha256Hex(`${requestId}:${code}`);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
