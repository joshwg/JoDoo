#!/usr/bin/env bash
# Live smoke test against a *running* Jodoo sync server (e.g. production
# https://jodoo.joshco.com). Exercises the REST API end-to-end and, if
# possible, the WebSocket sync endpoint - using the real server key, over
# real TLS. Safe to re-run: it only creates a throwaway share each time.
#
# Usage:
#   ./live_test.sh                                  # prompts for the key
#   JODOO_SERVER_KEY=xxxxxxxxxxxxxxxxxxxx ./live_test.sh   # uses env var
#   BASE_URL=https://other-host ./live_test.sh
set -euo pipefail
cd "$(dirname "$0")"

BASE_URL="${BASE_URL:-https://jodoo.joshco.com}"

if [ -n "${JODOO_SERVER_KEY:-}" ]; then
  echo "Using JODOO_SERVER_KEY from environment."
else
  read -r -s -p "Server key for $BASE_URL: " JODOO_SERVER_KEY
  echo
fi

if [ -z "$JODOO_SERVER_KEY" ]; then
  echo "No server key provided; aborting." >&2
  exit 1
fi

AUTH_HEADER="Authorization: Bearer $JODOO_SERVER_KEY"
PASS=0
FAIL=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $desc ($actual)"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc (expected $expected, got $actual)"
    FAIL=$((FAIL + 1))
  fi
}

echo "== Jodoo live server test =="
echo "Target: $BASE_URL"
echo

# 1. Health check (no auth required).
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/healthz")
check "GET /healthz" "200" "$code"

# 2. Unauthorized create must be rejected.
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/lists" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"todo","name":"unauth-test","items":[]}')
check "POST /api/lists without key" "401" "$code"

# 3. Authorized create.
body="$(mktemp)"
trap 'rm -f "$body"' EXIT
code=$(curl -s -o "$body" -w '%{http_code}' -X POST "$BASE_URL/api/lists" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"kind":"todo","name":"live-test list","items":[{"uuid":"11111111-1111-1111-1111-111111111111","title":"ping","done":false}]}')
check "POST /api/lists with key" "201" "$code"

SHARE_KEY="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('key',''))" "$body" 2>/dev/null || true)"

if [ -z "$SHARE_KEY" ]; then
  echo "Could not extract a share key from the create response; skipping remaining checks." >&2
  echo
  echo "== Result: $PASS passed, $((FAIL + 1)) failed =="
  exit 1
fi
echo "Created share key: $SHARE_KEY"

# 4. Fetch it back.
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/lists/$SHARE_KEY" -H "$AUTH_HEADER")
check "GET /api/lists/{key}" "200" "$code"

# 5. Unknown key is 404.
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/lists/notarealkey000000" -H "$AUTH_HEADER")
check "GET /api/lists/{unknown}" "404" "$code"

# 6. WebSocket round trip: confirm the initial snapshot push actually
# arrives over the real TLS + reverse-proxy path.
WS_URL="$(printf '%s' "$BASE_URL" | sed -e 's#^https:#wss:#' -e 's#^http:#ws:#')"
if python3 ../ws_check.py "$WS_URL/ws/$SHARE_KEY?serverKey=$JODOO_SERVER_KEY"; then
  check "WebSocket /ws/{key} snapshot" "ok" "ok"
else
  check "WebSocket /ws/{key} snapshot" "ok" "fail"
fi

echo
echo "== Result: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
