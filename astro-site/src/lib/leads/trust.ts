// "Remember this browser" after a visitor verifies their email, so the
// same person isn't asked for a new code on every form for 30 days. The
// server keeps only a hash of the token and checks it against the email,
// so a token is useless for any other email address.
//
// localStorage can be unavailable (private mode, blocked storage) — then
// the visitor simply gets asked for a code again.

const KEY = 'um_lead_trust';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function getTrustToken(email: string): string | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved?.email === email && typeof saved.token === 'string' && Date.now() - saved.savedAt < MAX_AGE_MS) {
      return saved.token;
    }
  } catch {
    // Ignore unreadable or blocked storage.
  }
  return undefined;
}

export function saveTrustToken(email: string, token: unknown) {
  if (typeof token !== 'string') return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ email, token, savedAt: Date.now() }));
  } catch {
    // Storage blocked: nothing to remember.
  }
}
