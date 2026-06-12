#!/usr/bin/env bash
# Dayleaf API smoke test. Spins nothing up itself — point it at a running
# server with a FRESH data dir (it runs first-time setup).
#   DATA_DIR=./smoke-data PORT=3210 node server/index.js &
#   bash scripts/smoke.sh http://localhost:3210
set -u
B="${1:-http://localhost:3210}"
J="$(mktemp /tmp/dayleaf-smoke.XXXXXX)"
PASS=0; FAIL=0

check() { # check <name> <expected-substring> <actual>
  if [[ "$3" == *"$2"* ]]; then PASS=$((PASS+1)); echo "ok   $1";
  else FAIL=$((FAIL+1)); echo "FAIL $1 — expected '$2' in: ${3:0:200}"; fi
}

check "fresh /api/me"   '"needsSetup":true' "$(curl -s $B/api/me)"
check "setup"           '"ok":true' "$(curl -s -c $J -H 'Content-Type: application/json' -d '{"username":"Smoke","password":"smokepass123"}' $B/api/setup)"
check "seeded tabs"     '"Work"' "$(curl -s -b $J $B/api/tabs)"
check "create tab"      '"Fitness"' "$(curl -s -b $J -H 'Content-Type: application/json' -d '{"name":"Fitness","emoji":"🏃"}' $B/api/tabs)"
check "create entry"    '"content":"hello smoke"' "$(curl -s -b $J -F tab_id=1 -F 'content=hello smoke' -F mood=🙂 $B/api/entries)"
PNG="$(mktemp /tmp/dayleaf-smoke-img.XXXXXX).png"
printf '\x89PNG\r\n\x1a\n' > "$PNG"
check "entry with photo" '"attachments":[{' "$(curl -s -b $J -F tab_id=1 -F 'content=photo entry' -F photos=@"$PNG;type=image/png" $B/api/entries)"
FNAME=$(curl -s -b $J $B/api/entries | sed -n 's/.*"filename":"\([^"]*\)".*/\1/p' | head -1)
check "photo serves"    "200" "$(curl -s -o /dev/null -w '%{http_code}' -b $J $B/api/files/$FNAME)"
check "search"          'hello smoke' "$(curl -s -b $J "$B/api/entries?q=hello")"
check "edit entry"      'hello edited' "$(curl -s -b $J -X PUT -F 'content=hello edited' $B/api/entries/1)"
check "unauthed 401"    "401" "$(curl -s -o /dev/null -w '%{http_code}' $B/api/entries)"
check "export"          '"exportedAt"' "$(curl -s -b $J $B/api/export)"
check "ask w/o key"     'No AI API key' "$(curl -s -b $J -H 'Content-Type: application/json' -d '{"question":"hi"}' $B/api/ask)"
check "totp setup"      'otpauth://totp' "$(curl -s -b $J -X POST $B/api/totp/setup)"
check "wrong password"  'Wrong password' "$(curl -s -H 'Content-Type: application/json' -d '{"password":"nope"}' $B/api/login)"
check "delete entry"    '"ok":true' "$(curl -s -b $J -X DELETE $B/api/entries/1)"
check "last-tab guard"  'Keep at least one tab' "$(curl -s -b $J -X DELETE $B/api/tabs/3; curl -s -b $J -X DELETE $B/api/tabs/2; curl -s -b $J -X DELETE $B/api/tabs/1)"

rm -f "$J" "$PNG"
echo "----------------------------------------"
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
