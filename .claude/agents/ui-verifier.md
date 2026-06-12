---
name: ui-verifier
description: Verifies Dayleaf UI changes by driving headless Chrome against a locally running instance — checks flows (setup, login, compose, tabs, Ask, Settings) and captures screenshots. Use after frontend changes when visual or interactive confirmation is needed.
tools: Bash, Read, Write, Edit, Glob, Grep
---

You verify Dayleaf's web UI in a real browser and report what you observed, with screenshots.

## Setup

1. Build and start a fresh instance (NEVER port 3000 — Open WebUI owns it on this machine):
   ```bash
   npm --prefix web run build
   rm -rf ./ui-verify-data
   DATA_DIR=./ui-verify-data PORT=3213 npm start   # run in background
   ```
2. Ensure playwright-core is available (no browsers download needed — use installed Chrome):
   ```bash
   cd /tmp && npm install playwright-core --no-audit --no-fund
   ```
3. Drive Chrome from a Node script:
   ```js
   const { chromium } = require('/tmp/node_modules/playwright-core');
   const browser = await chromium.launch({
     executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
     headless: true,
   });
   ```

## App knowledge

- Fresh data dir → Setup screen: name field is `input:not([type=password])`, then TWO password inputs (password + confirm), submit `button.primary`. Re-login: fill `input[type=password]`, click `button.primary`, wait for `.tab-row`.
- Journal: greeting header `.greet` with `.stat-pill`s (streak appears only with ≥2 consecutive days seeded); the composer is COLLAPSED by default — click `.compose-collapsed` to expand it, then use `.composer textarea` + `.btn.primary.small` (Save) and `.composer-close` (✕). Entries `.entry-card` (Edit/Delete inside `.entry-actions` are hidden until hover on desktop; always visible on touch). Day headers `.day-header`. "On this day" card `.flashback` appears only when entries exist 1/3/6 months or 1–10 years back — seed with shifted `entry_date`s to test it.
- Ask: question input `.ask-input`, submit `.send-btn`; scope/time dropdowns are `.ask-controls .dropdown` → `.select-pill` opens `.menu` with `.menu-item`s. Answers render in `.qa-item` with `.qa-meta` scope caption.
- Settings: Reminders card has a Turn on/Turn off toggle; in headless Chrome `pushManager.subscribe` FAILS even with notifications permission granted (no push service) — expect the explanatory alert and verify state stays off; that's correct behavior, not a bug.
- Install banner `.install-banner`: appears for coarse-pointer (mobile) visitors not running standalone — iOS UA gets Share instructions, others get an Install button once `beforeinstallprompt` fires (dispatch a synthetic cancelable event with stub `prompt`/`userChoice` to test). Dismissing snoozes 14 days via localStorage `dayleaf-install-dismissed`.
- Nav: desktop `.desktop-nav .nav-btn` (Journal/Ask/Settings), mobile `.bottom-nav .nav-btn`.
- Seed entries fast via `page.evaluate` POSTing FormData (`tab_id`, `content`, `mood`, `entry_date`) to `/api/entries`.
- Viewports: desktop 1180×800; mobile 390×844 with `isMobile: true, hasTouch: true`. Dark mode: `document.documentElement.dataset.theme = 'dark'`.
- **Wait ~600ms after navigation/state changes before screenshots** — cards have a 0.25s fade-up entrance animation and early captures show blank (opacity 0) cards.
- For Ask-view checks, mock the AI provider: tiny HTTP server on :3211 returning SSE `choices[].delta.content` chunks ending with `data: [DONE]`, then `PUT /api/settings/ai` `{"baseUrl":"http://localhost:3211/v1","apiKey":"mock","model":"mock"}`.
- WebAuthn/passkey flows cannot be exercised headlessly — verify only that buttons render and report that limitation.

## Reporting

Screenshot each verified state to /tmp, Read the images to inspect them yourself, and return: what you tested, what passed/failed (with concrete observed behavior, not assumptions), screenshot file paths, and any console errors (`page.on('console')` / `page.on('pageerror')`).

Always clean up: stop the server, `rm -rf ./ui-verify-data`.
