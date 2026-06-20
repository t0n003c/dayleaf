# Security

Dayleaf is a single-user, self-hosted app. The threat model assumes it may be
exposed to the internet (e.g. via a Cloudflare Tunnel + reverse proxy).

## Controls

- **Auth:** scrypt password hashing, DB-backed session cookies
  (`HttpOnly`, `Secure`, `SameSite=Lax`), optional TOTP 2FA, optional WebAuthn
  passkeys (biometric-first login).
- **Brute force:** persistent per-IP and global lockouts with cooldowns;
  passkey failures excluded (not guessable); login-activity log; optional
  push alert on lockout. Client IP is taken from the trusted proxy chain only —
  spoofed `X-Forwarded-For` from a direct caller can't bypass the lockout.
- **Bot challenge (optional):** when `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET`
  are set, the password login form requires a Cloudflare Turnstile token,
  verified server-side before credentials are checked. A failed/missing token is
  rejected but does NOT count toward the lockout (so a flaky captcha can't lock
  the owner out). Passkey login is unaffected.
- **Sessions:** rotated on login; **all other sessions are revoked on password
  change**; "sign out everywhere" available in Settings.
- **HTTP headers:** Content-Security-Policy (no inline scripts except two
  hashed bootstrap scripts), `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY` (anti-clickjacking), `Referrer-Policy: no-referrer`,
  `Permissions-Policy` locking down sensors.
- **CSRF:** `SameSite=Lax` plus a same-origin `Origin` check on all
  state-changing API requests.
- **Uploads:** raster image types only (SVG rejected — can carry script);
  every image re-encoded to WebP (strips embedded payloads); served with
  `nosniff` and `Content-Disposition: inline`; filenames are random hex and
  path-contained.
- **SSRF:** the user-set AI base URL is resolved and blocked if it points at a
  private / loopback / link-local / CGNAT address (DNS-rebinding-safe), unless
  `AI_ALLOW_PRIVATE=1` is set for a local provider (Ollama/LM Studio).
- **Injection:** all SQL uses parameterized queries; journal content is
  rendered as text by React (no `dangerouslySetInnerHTML`).
- **Container:** runs as the non-root `node` user; compose ships
  `no-new-privileges` and `cap_drop: [ALL]`.

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `TRUST_PROXY_HOPS` | `2` | Number of trusted proxy hops (Cloudflare + NPM = 2). |
| `COOKIE_INSECURE` | unset | Set to `1` ONLY for pure plain-HTTP LAN access, where a `Secure` cookie can't be stored. Weakens session protection. |
| `AI_ALLOW_PRIVATE` | unset | Set to `1` to allow the AI base URL to point at a private/LAN address (needed for local Ollama / LM Studio). |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | unset | Set BOTH to enable a Cloudflare Turnstile bot challenge on the password login. Site key is public; keep the secret private. |
| `MAX_LOGIN_ATTEMPTS` / `MAX_GLOBAL_ATTEMPTS` / `LOGIN_WINDOW_MINUTES` / `LOCKOUT_MINUTES` | `5` / `15` / `15` / `15` | Brute-force lockout tuning. |

## Accepted risks (documented, not bugs)

- **Secrets at rest** (AI key, TOTP secret, VAPID private key) are stored
  unencrypted in the SQLite DB. For a single-user self-hosted app the database
  *is* the trust boundary; encrypting it would require a key living on the same
  host. Keep `/data` permissions tight (`700`) and treat backups as sensitive.
- **First-run setup** (`POST /api/setup`) is unauthenticated by necessity —
  it creates the owner account. Complete setup immediately after first launch,
  before exposing the app publicly, so no one else can claim the account.

## Strongly recommended

Put **Cloudflare Access** (free tier, email OTP) in front of the tunnel. It
makes the app unreachable to unauthenticated internet traffic, which is the
single highest-leverage control for an exposed self-hosted app.

## Backups

The in-app **full backup** (`/api/backup`) is a single JSON file that includes your password hash, TOTP secret, and AI key so a restore is complete. Treat the backup file as sensitive — store it somewhere safe.

## Reporting

This is a personal project; open a GitHub issue for security concerns.
