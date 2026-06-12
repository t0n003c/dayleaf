# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Dayleaf — a self-hosted, single-user journaling PWA deployed to the owner's NAS via Docker. Source of truth for deployment is `ghcr.io/t0n003c/dayleaf`, built automatically by `.github/workflows/docker.yml` on every push to `main` (multi-arch amd64+arm64). Pushing to main IS the release process.

## Commands

```bash
npm install && npm --prefix web install   # both dependency trees
PORT=3210 npm run dev                     # API server with --watch, data in ./data
npm --prefix web run dev                  # Vite dev server :5173, proxies /api -> :3000 (see note)
npm --prefix web run check                # TypeScript type-check (no test suite exists)
npm --prefix web run build                # production bundle -> web/dist
docker build -t dayleaf:test .            # what CI runs; verifies the full stack
```

**Port gotcha:** on this machine port 3000 is occupied by Open WebUI. Run the API on 3210+ and, if using the Vite dev server, adjust the proxy target in `web/vite.config.ts` accordingly. Stray requests to :3000 will get Open WebUI's HTML and look like bizarre API failures.

There is no unit test suite — `bash scripts/smoke.sh http://localhost:3210` is the regression gate (22 curl checks against a server started with a **fresh** data dir; it runs first-time setup itself). AI streaming can be tested against a local mock of `POST /chat/completions` returning SSE. See the `smoke-test` and `release` skills for the full flows.

## Architecture

One Express server (`server/`) serves both the JSON API under `/api/*` and the built SPA from `web/dist` (everything non-`/api` falls through to `index.html`). One container, one volume.

- **Zero native dependencies is a design constraint.** The DB is the Node built-in `node:sqlite` (`server/db.js`), not better-sqlite3; password hashing is `node:crypto` scrypt. This keeps the Docker build a plain `npm install` on alpine for both architectures. Don't introduce native modules.
- **All state lives under `DATA_DIR`** (default `/data`, always resolved to an absolute path — `res.sendFile` requires it): the SQLite file, WAL files, and `uploads/` for photos. App settings (AI base URL/key/model) are rows in the `settings` table, not env vars; there is no `.env`.
- **Auth is single-user** (`server/auth.js`): scrypt password + DB-backed session cookie, optional TOTP (otplib), optional WebAuthn passkeys (`server/webauthn.js`). Both `@simplewebauthn/server` and `@simplewebauthn/browser` are pinned to **v9** — the v10+ API is incompatible (userID type, option shapes); upgrade both sides together or not at all. The WebAuthn RP ID/origin are derived per-request from `Host`/`X-Forwarded-*` headers (`trust proxy` is on) so the same image works behind any hostname or reverse proxy.
- **AI recall** (`server/ai.js`) proxies to any OpenAI-compatible `/chat/completions` with the user's own key. The server parses the provider's SSE stream and forwards **plain text chunks** (not SSE) to the client, which reads them via `fetch` + `ReadableStream` (`web/src/api.ts` `ask()`). Journal context is assembled server-side: entries filtered by tab IDs/date range, newest first, capped by char budget, with today's date in the system prompt.
- **Frontend** (`web/src/`) is React+Vite with no router: `App.tsx` switches between three views (Journal/Ask/Settings) and gates on `/api/me` (`needsSetup` → Setup, unauthed → Login). Tabs are user-defined journals; entries are intentionally **plain text only — never render markdown** (explicit product decision). PWA manifest shortcuts deep-link via `/?action=new|ask`, handled in `App.tsx`. The Journal composer is collapsed by default (a "quick-jot" pill with rotating daily prompts) and expands on tap or via the `?action=new` shortcut; the greeting header shows streak/days pills from `/api/stats`, and `/api/onthisday` feeds the "On this day" memories card. Endpoints taking dates accept `?today=YYYY-MM-DD` from the client because entry dates are user-local while the server may run in UTC.
- **Daily reminders** (`server/push.js`): Web Push via the `web-push` package (pure JS). VAPID keys are generated once and persisted in the `settings` table — never regenerate them, existing subscriptions would break. A 30s `setInterval` loop compares the user's local time (client-supplied IANA `tz`, formatted with `Intl`) against the configured reminder time, claims the day via `reminder_last_sent` *before* sending, and skips days that already have an entry. Push handlers live in `web/public/sw.js` — bump its `CACHE` version whenever the service worker changes.
- **PWA bits** live in `web/public/`: hand-rolled `sw.js` (network-first navigations, cache-first assets, never caches `/api`), `manifest.webmanifest`, icons generated from `icons/icon.svg`.

## Conventions

- Dates: `entry_date` is a local-time `YYYY-MM-DD` string; the frontend produces it with `toLocaleDateString('sv')`. Timestamps in the DB are UTC `datetime('now')`.
- API errors are always `{ error: string }` with an appropriate status; the client surfaces `err.message` directly to the user.
- Photo files get random hex names in `uploads/`; the DB row in `attachments` is the source of truth, and deletion paths (entry, tab, attachment) must unlink files too.
