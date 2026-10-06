// Cloudflare Turnstile — the free, privacy-friendly "are you human?"
// check. It stays invisible for almost everyone and only shows a small
// widget when Cloudflare isn't sure. The script is loaded the first time
// an enquiry form is opened, not on page load.
//
// PUBLIC_TURNSTILE_SITE_KEY (astro-site/.env) holds the real site key.
// Without it, Cloudflare's always-pass test key is used — fine for local
// testing, and harmless in production because the server-side secret
// decides whether a token is accepted.

declare global {
  interface Window {
    turnstile?: {
      render(container: HTMLElement, options: Record<string, unknown>): string;
      reset(widgetId: string): void;
    };
  }
}

const SITE_KEY = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TOKEN_WAIT_MS = 30_000;

let scriptPromise: Promise<NonNullable<Window['turnstile']>> | null = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile missing')));
    script.onerror = () => {
      scriptPromise = null;
      script.remove();
      reject(new Error('Turnstile failed to load'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export class CaptchaError extends Error {}

export function createCaptcha(container: HTMLElement, action: string) {
  let widgetId: string | null = null;
  let token: string | null = null;
  let waiters: ((token: string) => void)[] = [];

  async function prepare() {
    let turnstile: NonNullable<Window['turnstile']>;
    try {
      turnstile = await loadTurnstile();
    } catch {
      throw new CaptchaError(
        "The security check couldn't load. Please check your connection (or ad-blocker) and try again.",
      );
    }
    if (widgetId !== null) return;
    widgetId = turnstile.render(container, {
      sitekey: SITE_KEY,
      action,
      appearance: 'interaction-only',
      callback: (value: string) => {
        token = value;
        waiters.splice(0).forEach((resolve) => resolve(value));
      },
      'expired-callback': () => {
        token = null;
      },
      'error-callback': () => {
        token = null;
      },
    });
  }

  // A fresh token for one request. Waits while Cloudflare runs its check
  // (or the visitor ticks the box, in the rare case one is shown).
  async function getToken(): Promise<string> {
    await prepare();
    if (token) return token;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters = waiters.filter((w) => w !== done);
        reject(new CaptchaError('The security check is taking too long. Please try again.'));
      }, TOKEN_WAIT_MS);
      const done = (value: string) => {
        clearTimeout(timer);
        resolve(value);
      };
      waiters.push(done);
    });
  }

  // Each token can be used once; get the next one ready.
  function reset() {
    token = null;
    if (widgetId !== null) window.turnstile?.reset(widgetId);
  }

  return { prepare, getToken, reset };
}
