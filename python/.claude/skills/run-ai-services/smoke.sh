#!/usr/bin/env bash
# Driver for the Alfanumrik AI Services (Python/FastAPI) unit.
#
# Launches the service in the background, waits for it to be ready, drives
# a handful of real HTTP requests through the actual running app (not just
# unit tests), prints the results, then shuts the server down cleanly.
#
# Usage (from the `python/` directory):
#   bash .claude/skills/run-ai-services/smoke.sh
#
# Tested in a Windows / Git-Bash environment against python/.venv. On Linux,
# swap the PID-lookup block (see STOP section) for `lsof -ti:$PORT | xargs -r kill`.

set -uo pipefail

PORT="${PORT:-8080}"
HOST="127.0.0.1"
LOG_FILE="${TMPDIR:-/tmp}/ai-services-smoke.log"
BASE="http://${HOST}:${PORT}"

if [ ! -f "services/ai/api/main.py" ]; then
  echo "Run this from the python/ directory (services/ai/api/main.py not found here)." >&2
  exit 1
fi

PYTHON_BIN="./.venv/Scripts/python.exe"
if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN="./.venv/bin/python"   # Linux/macOS venv layout
fi

echo "== Launching uvicorn on ${BASE} (log: ${LOG_FILE}) =="
"$PYTHON_BIN" -m uvicorn services.ai.api.main:app --port "$PORT" --host "$HOST" > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

# ── Wait for readiness (poll /live, not a fixed sleep) ──────────────────────
ready=0
for _ in $(seq 1 30); do
  if curl -sf "${BASE}/live" > /dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.5
done

if [ "$ready" -ne 1 ]; then
  echo "Server never became ready. Log tail:" >&2
  tail -40 "$LOG_FILE" >&2
  exit 1
fi

fail=0
check() {
  # check <name> <expected_status> <curl args...>
  local name="$1" expected="$2"; shift 2
  local out status
  out=$(curl -s -o /dev/null -w "%{http_code}" "$@")
  status="$out"
  if [ "$status" = "$expected" ]; then
    echo "PASS  $name (HTTP $status)"
  else
    echo "FAIL  $name (expected $expected, got $status)"
    fail=1
  fi
}

echo
echo "== Smoke checks =="
check "GET /live"                          200 "${BASE}/live"
check "GET /readyz (degraded, unconfigured)" 503 "${BASE}/readyz"
check "GET /docs"                          200 "${BASE}/docs"
check "GET /openapi.json"                  200 "${BASE}/openapi.json"

check "POST /v1/math/verify, no auth -> 401" 401 -X POST "${BASE}/v1/math/verify" \
  -H "Content-Type: application/json" \
  -d '{"problem_expression":"1/2 + 3/4","claimed_answer":"5/4","kind":"evaluate"}'

check "POST /v1/math/verify, fake token, no Supabase -> 503" 503 -X POST "${BASE}/v1/math/verify" \
  -H "Content-Type: application/json" -H "Authorization: Bearer faketoken" \
  -d '{"problem_expression":"1/2 + 3/4","claimed_answer":"5/4","kind":"evaluate"}'

check "POST /v1/math/verify, malformed body -> 422" 422 -X POST "${BASE}/v1/math/verify" \
  -H "Content-Type: application/json" -H "Authorization: Bearer faketoken" \
  -d '{"kind":"not_a_real_kind"}'

echo
echo "Route count: $(curl -s "${BASE}/openapi.json" | "$PYTHON_BIN" -c 'import json,sys; print(len(json.load(sys.stdin)["paths"]))')"

# ── Stop the server ──────────────────────────────────────────────────────────
echo
echo "== Stopping server =="
if command -v lsof > /dev/null 2>&1; then
  lsof -ti:"$PORT" -sTCP:LISTEN | xargs -r kill
else
  # Windows/Git-Bash: $! above is the venv python.exe wrapper's shell PID,
  # which does not reliably match the PID actually bound to the port.
  # Resolve the real owner of the port via PowerShell and kill that instead.
  real_pid=$(powershell -c "Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess" 2>/dev/null | tr -d '\r')
  if [ -n "$real_pid" ]; then
    powershell -c "Stop-Process -Id $real_pid -Force" 2>/dev/null
  else
    kill "$SERVER_PID" 2>/dev/null
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "One or more checks FAILED. See ${LOG_FILE} for server logs."
  exit 1
fi

echo
echo "All checks passed."
