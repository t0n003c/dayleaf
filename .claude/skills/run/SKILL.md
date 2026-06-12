---
name: run
description: Launch Dayleaf locally for development or manual verification. Use when asked to run, start, demo, or screenshot the app, or to confirm a change works in the running app.
---

# Run Dayleaf locally

**Never use port 3000 — Open WebUI occupies it on this machine.** Use 3210+.

## Quick start (production-like: API + built SPA from one server)

```bash
npm --prefix web run build
rm -rf ./dev-data            # only if you want a fresh first-run setup screen
COOKIE_INSECURE=1 AI_ALLOW_PRIVATE=1 DATA_DIR=./dev-data PORT=3210 npm start
```

Open http://localhost:3210. First run shows the setup screen; pick any name and an 8+ char password. `dev-data/` and anything matching `data/` are gitignored.

Run the server in the background (`run_in_background: true`) and verify liveness with `curl -s http://localhost:3210/api/me` — expect `{"needsSetup":...}` JSON. If you get HTML mentioning "Open WebUI", you hit the wrong port.

## Hot-reload development

```bash
DATA_DIR=./dev-data PORT=3210 node --watch server/index.js   # API
npm --prefix web run dev                                     # Vite on :5173
```

The Vite proxy in `web/vite.config.ts` targets `http://localhost:3000` — point it at 3210 locally (don't commit that change).

## Docker (closest to the NAS)

```bash
docker build -t dayleaf:test .
docker run -d --rm --name dayleaf-test -p 3212:3000 dayleaf:test
curl -s http://localhost:3212/api/me
docker stop dayleaf-test
```

## UI screenshots / browser checks

No playwright in the repo. Install `playwright-core` into /tmp and drive installed Chrome:

```js
const { chromium } = require('/tmp/node_modules/playwright-core');
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
```

Log in by filling `input[type=password]` and clicking `button.primary`, then wait for `.sidebar` (the old `.tab-row` no longer exists). Mobile: viewport 390×844 with `isMobile: true`. Dark mode: set `document.documentElement.dataset.theme = 'dark'`.

## Cleanup

Kill background servers when done: `kill $(lsof -t -iTCP:3210 -sTCP:LISTEN)`.
