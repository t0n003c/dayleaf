---
name: smoke-test
description: Run Dayleaf's API smoke test suite against a fresh server. Use after any backend change, before pushing to main, or when asked to test/verify the app.
---

# Smoke-test Dayleaf

There is no unit test suite; this is the project's regression gate. It exercises setup, auth (incl. wrong-password and unauthed 401), tabs, entries, photo upload/serving, search, edit/delete, export, the no-API-key ask path, TOTP setup, and the last-tab guard.

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
