<p align="center">
  <img src="web/public/icons/icon-192.png" width="96" alt="Dayleaf" />
</p>

<h1 align="center">Dayleaf 🍃</h1>
<p align="center"><em>Your days, one leaf at a time.</em></p>

Dayleaf is a private, self-hosted daily journal designed for your NAS. Jot quick
notes about your day, snap photos from your phone, organize life into tabs
(Home, Work, or anything you create), and ask an AI assistant questions about
your own life — *"What did I do last week?"* — powered by whatever AI provider
you bring.

Everything lives in a single Docker container with one data folder. No cloud,
no accounts, no tracking.

| Desktop | Ask AI (dark) | Mobile |
|---|---|---|
| ![Desktop](docs/screenshot-desktop.png) | ![Ask AI](docs/screenshot-ask.png) | ![Mobile](docs/screenshot-mobile.png) |

## Features

- **Quick capture** — open the app, type, save. Plain text, no markdown clutter.
- **Tabs in a sidebar** — separate journals for Home, Work, and any custom
  tabs you create (each with its own icon, color, and entry count). Collapsible
  sidebar on desktop, edge-swipe drawer on mobile; drag to reorder, edit and
  delete inline.
- **Photos** — attach images or take one straight from your phone camera —
  every upload is automatically optimized (converted to WebP, resized, with
  fast-loading thumbnails generated for the grids). A
  dedicated **Photos view** shows everything you've ever uploaded in a
  month-grouped gallery with an immersive viewer — swipe to flip with your
  finger, pinch to zoom, double-tap, swipe down to close.
- **Moods** — optionally tag each entry with how you felt.
- **Streaks & stats** — a friendly greeting with an animated streak growth
  ring (the leaf matures as your streak grows) and one-time milestone
  celebrations at 3/7/14/30/60/100/180/365 days.
- **"On this day" memories** — entries from 1/3/6 months and years ago
  resurface at the top of your journal, with an optional **morning flashback
  notification** when today has history.
- **Daily prompts** — a rotating reflective prompt in the quick-jot bar.
- **Daily reminder notifications** — an optional push notification at your
  chosen time if you haven't journaled yet that day (toggle in Settings →
  Reminders). Needs HTTPS; on iPhone, install to the Home Screen first
  (iOS 16.4+).
- **Timeline & search** — entries grouped by day, full-text search across everything.
- **AI recall** — connect OpenAI, Claude, OpenRouter, Ollama, LM Studio, or any
  OpenAI-compatible API with your own key. Ask questions scoped to all tabs or
  specific ones, over the last week / month / quarter / all time. Answers stream in live.
- **Security** — password on first launch, optional **authenticator-app 2FA**
  (Google Authenticator etc.) and optional **biometric unlock** (Face ID /
  fingerprint via passkeys; when enrolled, login is biometric-first and the
  password form only appears as a fallback). Brute-force lockouts with
  cooldowns, a recent-login-activity log, sign-out-everywhere, and an optional
  push alert when someone trips the lockout.
- **One-handed mobile UX** — both the quick-jot bar and the Ask input dock at
  the bottom of the screen, and an install banner offers the app on first
  visit.
- **Make it yours** — set the name Dayleaf greets you with, reorder journals,
  pick per-tab icons and colors.
- **Installable app (PWA)** — add to your phone's home screen and it behaves
  like a native app, including **app shortcuts**: long-press the icon for
  *New entry* or *Ask AI*.
- **Your data is yours** — single SQLite database + photo folder in one volume;
  one-click JSON export.
- **Alive with motion** — falling leaves and seasonal WebGL dappled light on
  the welcome screen, leaf-burst save celebrations, a finger-following
  drawer and dismissible composer sheet, and instant flash-free opens.
- **Dark and light themes** with a time-of-day ambient glow.

## Quick start (NAS / docker compose)

Create a folder for the app, drop this `docker-compose.yml` in it:

```yaml
services:
  dayleaf:
    image: ghcr.io/t0n003c/dayleaf:latest
    container_name: dayleaf
    ports:
      - "3010:3000"
    volumes:
      - ./dayleaf-data:/data
    restart: unless-stopped
```

Then:

```bash
docker compose up -d
```

Open `http://your-nas:3010`, pick a name and password, and start journaling.

> **Building from source instead:** clone this repo, change `image:` to
> `build: .` in the compose file, and run `docker compose up -d --build`.

### Updating

```bash
docker compose pull && docker compose up -d
```

Your journal lives in `./dayleaf-data` — back that folder up and you've backed
up everything.

## Install on your phone

1. Open Dayleaf in your phone browser (Safari on iOS, Chrome on Android) —
   a banner pops up offering to install it (a real install prompt on Android;
   step-by-step Share → *Add to Home Screen* hints on iPhone).
2. Or do it manually: **iOS:** Share → *Add to Home Screen*. **Android:** menu → *Install app*.
3. Long-press the icon for quick actions: **New entry** and **Ask AI** —
   the fastest way to jot a note or ask your journal a question.

> True home-screen *widgets* aren't possible for self-hosted web apps —
> app shortcuts above are the web's equivalent. A small native wrapper app
> (e.g. via Capacitor) could add real widgets later; it's on the roadmap.

## Set up AI recall

1. Go to **Settings → AI recall**.
2. Pick a preset (OpenAI, Claude, OpenRouter, Ollama, LM Studio) or enter any
   OpenAI-compatible base URL.
3. Paste your API key and hit **Save & test connection**.
4. Open the **Ask** tab and try *"What did I do last week?"* — choose which
   tabs the AI can see and how far back it looks.

Your key and your journal never leave your server except for the requests you
make to the AI provider you configured. With Ollama on your own hardware,
nothing leaves your network at all.

## Biometric unlock & 2FA

- **Authenticator app (TOTP):** Settings → Security → *Enable*, scan the QR
  with Google Authenticator (or Authy, 1Password…), confirm the code. Login
  then requires password + code.
- **Biometric (Face ID / fingerprint):** Settings → Security → *Add this
  device*. This uses passkeys (WebAuthn), which browsers only allow over
  **HTTPS with a hostname** (not a raw IP). The easy ways to get that on a NAS:
  - [Tailscale](https://tailscale.com) with HTTPS certificates (`tailscale cert`), or
  - a reverse proxy (Caddy, Traefik, Nginx Proxy Manager, or Synology's
    built-in one) with a Let's Encrypt certificate.

Dayleaf is built to sit behind a reverse proxy — it honors
`X-Forwarded-Proto`/`X-Forwarded-Host` and Cloudflare's `cf-visitor` header
automatically. If your proxy chain still reports the wrong scheme (passkey
setup will say *expected "http://…"*), set the `PUBLIC_ORIGIN` env var on the
container, e.g. `PUBLIC_ORIGIN=https://journal.example.com` — that wins over
all headers. (Heads-up for Nginx Proxy Manager users: `proxy_set_header`
lines in the Advanced tab are silently ignored unless wrapped in your own
`location` block, due to nginx inheritance rules.)

## Development

```bash
npm install                 # server deps
npm --prefix web install    # web deps
npm run dev                 # API on :3000 (data in ./data)
npm --prefix web run dev    # Vite dev server on :5173, proxies /api
```

## Tech notes

- **Server:** Node 22+ (uses the built-in `node:sqlite` — zero native deps), Express.
- **Web:** React + Vite + TypeScript PWA.
- **Storage:** one SQLite file + an uploads folder, both inside `/data`.
- **No `.env` file:** all settings are configured in the UI and stored in the
  database. The only env vars are `PORT` (default 3000) and `DATA_DIR`
  (default `/data`), and the compose file already handles both.
- **Images:** published to GHCR for `amd64` and `arm64` via GitHub Actions.

## Roadmap ideas

- Markdown-free rich touches (checklists, highlights)
- Native mobile wrapper with real home-screen widgets
- Multi-user support
- AI-generated weekly recap digests

## License

MIT
