#!/usr/bin/env bash
set -euo pipefail
cd /home/josh/projects/Jodoo/server

export JODOO_SERVER_KEY="thisisatestserverkey1234567890"
export PORT=8099
export DATA_DIR=/tmp/jodoo-smoke-data
rm -rf "$DATA_DIR"

go build -o /tmp/jodoo-server-smoke .
/tmp/jodoo-server-smoke &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
sleep 1

echo "--- health ---"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8099/healthz

echo "--- unauthorized create ---"
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8099/api/lists \
  -H 'Content-Type: application/json' -d '{"kind":"todo","name":"x","items":[]}'

echo "--- create share ---"
RESP=$(curl -s -X POST http://localhost:8099/api/lists \
  -H "Authorization: Bearer $JODOO_SERVER_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"todo","name":"Groceries List","items":[{"title":"Milk"}]}')
echo "$RESP"
KEY=$(echo "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["key"])')
echo "key=$KEY"

echo "--- get share ---"
curl -s -H "Authorization: Bearer $JODOO_SERVER_KEY" http://localhost:8099/api/lists/$KEY
echo

echo "--- get nonexistent share ---"
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $JODOO_SERVER_KEY" http://localhost:8099/api/lists/doesnotexist00000000

kill $PID 2>/dev/null || true
trap - EXIT
echo DONE
