---
name: smoke-test
description: Run Dayleaf's API smoke test suite against a fresh server. Use after any backend change, before pushing to main, or when asked to test/verify the app.
---

# Smoke-test Dayleaf

There is no unit test suite; this is the project's regression gate (~30 checks — don't trust a hardcoded count, the suite grows). It exercises setup, auth (incl. wrong-password and unauthed 401), tabs incl. reorder, entries, photo upload/serving, search, edit/delete, export, stats/streak, on-this-day, display name, the push-reminder endpoints (VAPID key, reminder get/set, test-send with no subscriptions), the no-API-key ask path, TOTP setup, the last-tab guard, the login-activity endpoint, and the brute-force lockout (passkey failures must NOT lock; password failures must). The lockout checks run LAST because they poison login for 15 minutes within that data dir.

## Steps

1. Type-check the frontend first: `npm --prefix web run check`
2. Start a server with a **fresh** data dir (the suite runs first-time setup):
   ```bash
   rm -rf ./smoke-data
   DATA_DIR=./smoke-data PORT=3210 npm start   # background
   ```
   (Port 3000 is occupied by Open WebUI on this machine — never use it.)
3. Run the suite:
   ```bash
   bash scripts/smoke.sh http://localhost:3210
   ```
   It prints `ok`/`FAIL` per check and exits non-zero on any failure.
4. Clean up: kill the server, `rm -rf ./smoke-data`.

## AI streaming check (when `server/ai.js` or `web/src/api.ts` changed)

The suite only covers the no-key error path. To test streaming, run a mock provider and point Dayleaf at it:

```bash
node -e '
const http=require("http");
http.createServer((q,s)=>{let b="";q.on("data",c=>b+=c);q.on("end",()=>{
  s.writeHead(200,{"Content-Type":"text/event-stream"});
  for(const w of ["mock ","answer"]) s.write(`data: ${JSON.stringify({choices:[{delta:{content:w}}]})}\n\n`);
  s.write("data: [DONE]\n\n");s.end();});}).listen(3211)' &
```

Then (with a logged-in cookie jar from the suite or a manual login):
`PUT /api/settings/ai` with `{"baseUrl":"http://localhost:3211/v1","apiKey":"mock","model":"mock"}`, and `POST /api/ask` with a question — expect the literal text `mock answer` streamed back.

## Reminder scheduler check (when `server/push.js` changed)

Real push delivery can't be tested headlessly, but the 30s scheduler can — register a
dummy subscription (send fails harmlessly), schedule one minute out, and verify the loop
claims the day:

1. `POST /api/push/subscribe` with endpoint `https://localhost:1/fake` and any valid-looking
   base64url `p256dh`/`auth` keys.
2. `PUT /api/settings/reminder` with `{"enabled":true,"tz":"UTC","time":"<HH:MM ~65s from now, UTC>"}`.
3. Sleep ~100s, then:
   `sqlite3 <data-dir>/dayleaf.db "SELECT value FROM settings WHERE key='reminder_last_sent'"`
   — expect today's UTC date. (The loop claims the slot before sending, so this proves the
   schedule fired even though the dummy send fails.)
