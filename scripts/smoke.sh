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
check "reorder tabs"    '"ok":true' "$(curl -s -b $J -X PUT -H 'Content-Type: application/json' -d '{"ids":[3,2,1]}' $B/api/tabs/reorder)"
check "order persisted" '"name":"Fitness"' "$(curl -s -b $J $B/api/tabs | head -c 80)"
check "create entry"    '"content":"hello smoke"' "$(curl -s -b $J -F tab_id=1 -F 'content=hello smoke' -F mood=🙂 $B/api/entries)"
PNG="$(mktemp /tmp/dayleaf-smoke-img.XXXXXX).png"
# a real 1x1 PNG so the WebP pipeline can convert it
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > "$PNG"
check "entry with photo" '"attachments":[{' "$(curl -s -b $J -F tab_id=1 -F 'content=photo entry' -F photos=@"$PNG;type=image/png" $B/api/entries)"
check "converted to webp" '"mime":"image/webp"' "$(curl -s -b $J "$B/api/entries?q=photo+entry")"
FNAME=$(curl -s -b $J $B/api/entries | sed -n 's/.*"filename":"\([^"]*\)".*/\1/p' | head -1)
check "photo serves"    "200" "$(curl -s -o /dev/null -w '%{http_code}' -b $J $B/api/files/$FNAME)"
check "thumb serves"    "image/webp" "$(curl -s -o /dev/null -w '%{content_type}' -b $J "$B/api/files/$FNAME?thumb=1")"
check "gallery list"    '"total":1' "$(curl -s -b $J $B/api/attachments)"
check "search"          'hello smoke' "$(curl -s -b $J "$B/api/entries?q=hello")"
check "edit entry"      'hello edited' "$(curl -s -b $J -X PUT -F 'content=hello edited' $B/api/entries/1)"
check "unauthed 401"    "401" "$(curl -s -o /dev/null -w '%{http_code}' $B/api/entries)"
check "security headers" 'X-Frame-Options: DENY' "$(curl -s -D - -o /dev/null $B/api/me)"
check "nosniff on files" 'nosniff' "$(curl -s -D - -o /dev/null -b $J "$B/api/files/$FNAME")"
check "cross-origin blocked" 'Cross-origin' "$(curl -s -b $J -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{}' $B/api/tabs)"
check "ssrf blocked"    'private address' "$(curl -s -b $J -X PUT -H 'Content-Type: application/json' -d '{"baseUrl":"http://169.254.169.254/v1","apiKey":"x","model":"m"}' $B/api/settings/ai > /dev/null; curl -s -b $J -X POST $B/api/ai/test)"
# reset AI config so later checks see the default (no key) state, not the SSRF test's
curl -s -b $J -X PUT -H 'Content-Type: application/json' -d '{"baseUrl":"https://api.openai.com/v1","apiKey":""}' $B/api/settings/ai > /dev/null
check "export"          '"exportedAt"' "$(curl -s -b $J $B/api/export)"
check "stats"           '"streak":1' "$(curl -s -b $J $B/api/stats)"
check "on this day"     '[' "$(curl -s -b $J $B/api/onthisday)"
check "set display name" '"name":"Sunny"' "$(curl -s -b $J -X PUT -H 'Content-Type: application/json' -d '{"name":"Sunny"}' $B/api/profile)"
check "greet uses name" '"username":"Sunny"' "$(curl -s -b $J $B/api/me)"
check "vapid key"       '"publicKey":"B' "$(curl -s -b $J $B/api/push/vapid-key)"
check "reminder get"    '"enabled":false' "$(curl -s -b $J $B/api/settings/reminder)"
check "reminder set"    '"enabled":true' "$(curl -s -b $J -X PUT -H 'Content-Type: application/json' -d '{"enabled":true,"time":"20:00","tz":"Asia/Ho_Chi_Minh"}' $B/api/settings/reminder)"
check "memories toggle" '"memories":true' "$(curl -s -b $J -X PUT -H 'Content-Type: application/json' -d '{"memories":true}' $B/api/settings/reminder)"
check "push test (no subs)" 'No active subscriptions' "$(curl -s -b $J -X POST $B/api/push/test)"
check "ask w/o key"     'No AI API key' "$(curl -s -b $J -H 'Content-Type: application/json' -d '{"question":"hi"}' $B/api/ask)"
check "recap w/o key"   'No AI API key' "$(curl -s -b $J -H 'Content-Type: application/json' -d '{"lens":"recap"}' $B/api/recap)"
check "totp setup"      'otpauth://totp' "$(curl -s -b $J -X POST $B/api/totp/setup)"
check "wrong password"  'Wrong password' "$(curl -s -H 'Content-Type: application/json' -d '{"password":"nope"}' $B/api/login)"
check "delete entry"    '"ok":true' "$(curl -s -b $J -X DELETE $B/api/entries/1)"
check "last-tab guard"  'Keep at least one tab' "$(curl -s -b $J -X DELETE $B/api/tabs/3; curl -s -b $J -X DELETE $B/api/tabs/2; curl -s -b $J -X DELETE $B/api/tabs/1)"
check "login activity"  '"attempts":[{' "$(curl -s -b $J $B/api/security/activity)"
# passkey failures must NOT count toward lockout (only password/2FA do)
for _ in 1 2 3 4 5; do curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -d '{"response":{"id":"garbage"}}' $B/api/webauthn/login-verify; done
check "passkey fails don't lock" 'Wrong password' "$(curl -s -H 'Content-Type: application/json' -d '{"password":"nope"}' $B/api/login)"
# brute-force lockout: rack up failures (two already recorded above), then verify the gate
for _ in 1 2 3 4; do curl -s -o /dev/null -H 'Content-Type: application/json' -d '{"password":"nope"}' $B/api/login; done
check "lockout engages"  'Too many failed attempts' "$(curl -s -H 'Content-Type: application/json' -d '{"password":"nope"}' $B/api/login)"
check "lockout blocks even correct password" 'Too many failed attempts' "$(curl -s -H 'Content-Type: application/json' -d '{"password":"smokepass123"}' $B/api/login)"

rm -f "$J" "$PNG"
echo "----------------------------------------"
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
