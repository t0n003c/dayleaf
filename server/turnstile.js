// Cloudflare Turnstile — a bot challenge on the password login form. Enabled
// only when BOTH env vars are present, so with neither set the app (and the
// smoke suite, which sets neither) behaves exactly as before.
//
//   TURNSTILE_SITE_KEY  — public widget key, sent to the browser
//   TURNSTILE_SECRET    — server-side secret, never leaves the container
//
// The site key is intentionally public (it ships in the page); only the secret
// must stay private. These are env vars rather than DB settings so the gate is
// active from first boot and a wrong secret can be fixed by editing the
// container env — not by reaching a Settings UI that lives behind the very
// login it would be blocking.

const SITE_KEY = process.env.TURNSTILE_SITE_KEY || '';
const SECRET = process.env.TURNSTILE_SECRET || '';
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function turnstileEnabled() {
  return !!(SITE_KEY && SECRET);
}

export function turnstileSiteKey() {
  return SITE_KEY;
}

/**
 * Verify a widget token with Cloudflare. Returns true on success. Fails CLOSED
 * (returns false) on a missing token or any network/parse error, so the gate
 * can't be bypassed by knocking out the verify endpoint. A no-op (returns true)
 * when Turnstile isn't configured.
 */
export async function verifyTurnstile(token, remoteip) {
  if (!turnstileEnabled()) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret: SECRET, response: String(token) });
  if (remoteip) body.set('remoteip', remoteip);
  try {
    const r = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await r.json();
    return data.success === true;
  } catch {
    return false;
  }
}
