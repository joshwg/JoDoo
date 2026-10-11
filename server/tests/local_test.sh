#!/usr/bin/env bash
# Local smoke test: builds the server from the current source tree, runs it
# against a scratch data dir on a throwaway port, and exercises the REST API
# plus the WebSocket sync endpoint. Nothing here touches a real deployment.
#
# Usage:
#   ./local_test.sh                # build + run + test + tear down
#   PORT=9099 ./local_test.sh       # use a different local port
set -euo pipefail
cd "$(dirname "$0")/.."   # server/

PORT="${PORT:-8099}"
BASE_URL="http://localhost:$PORT"
SERVER_KEY="local-test-key-0123456789abcdef"
DATA_DIR="$(mktemp -d)"
BIN="$(mktemp)"
LOG="$(mktemp)"

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

SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$DATA_DIR" "$BIN" "$LOG"
}
trap cleanup EXIT

echo "== Building server =="
go build -o "$BIN" .

echo "== Starting server on :$PORT =="
JODOO_SERVER_KEY="$SERVER_KEY" DATA_DIR="$DATA_DIR" PORT="$PORT" "$BIN" >"$LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 20); do
  if curl -s -o /dev/null "$BASE_URL/healthz"; then
    break
  fi
  sleep 0.2
done

echo
echo "== Jodoo local server test =="
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
trap 'rm -f "$body"' RETURN 2>/dev/null || true
code=$(curl -s -o "$body" -w '%{http_code}' -X POST "$BASE_URL/api/lists" \
  -H "Authorization: Bearer $SERVER_KEY" -H 'Content-Type: application/json' \
  -d '{"kind":"todo","name":"local-test list","items":[{"uuid":"11111111-1111-1111-1111-111111111111","title":"ping","done":false}]}')
check "POST /api/lists with key" "201" "$code"

SHARE_KEY="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('key',''))" "$body" 2>/dev/null || true)"
rm -f "$body"

if [ -z "$SHARE_KEY" ]; then
  echo "Could not extract a share key from the create response; skipping remaining checks." >&2
  echo
  echo "== Result: $PASS passed, $((FAIL + 1)) failed =="
  exit 1
fi
echo "Created share key: $SHARE_KEY"

# 4. Fetch it back.
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/lists/$SHARE_KEY" -H "Authorization: Bearer $SERVER_KEY")
check "GET /api/lists/{key}" "200" "$code"

# 5. Unknown key is 404.
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/lists/notarealkey000000" -H "Authorization: Bearer $SERVER_KEY")
check "GET /api/lists/{unknown}" "404" "$code"

# 6. WebSocket round trip: confirm the initial snapshot push arrives.
if python3 ws_check.py "ws://localhost:$PORT/ws/$SHARE_KEY?serverKey=$SERVER_KEY"; then
  check "WebSocket /ws/{key} snapshot" "ok" "ok"
else
  check "WebSocket /ws/{key} snapshot" "ok" "fail"
fi

echo
echo "== Result: $PASS passed, $FAIL failed =="
echo "(server log: $LOG)"
[ "$FAIL" -eq 0 ]
