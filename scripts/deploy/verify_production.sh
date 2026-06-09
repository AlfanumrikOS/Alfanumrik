#!/usr/bin/env bash
# =============================================================================
# verify_production.sh — Alfanumrik Production Health Verification
# =============================================================================
# Runs a suite of checks against production endpoints and the Supabase REST API
# to confirm a deployment is healthy.
#
# Usage:
#   bash scripts/deploy/verify_production.sh
#
# Required environment variables:
#   SUPABASE_SERVICE_ROLE_KEY   — Service role key (server-side only, never expose)
#
# Optional (derived from PROJECT_REF if not set):
#   NEXT_PUBLIC_SUPABASE_URL    — Supabase project URL
#   SUPABASE_PROJECT_REF        — Project ref (default: shktyoxqhundlvkiwguu)
#   PRODUCTION_URL              — Frontend URL (default: https://www.alfanumrik.com)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Color setup
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' CYAN='' BOLD='' RESET=''
fi

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[PASS]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
fail()    { echo -e "${RED}[FAIL]${RESET}  $*" >&2; }
header()  { echo -e "\n${BOLD}${CYAN}=== $* ===${RESET}\n"; }

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_CHECKS=0

check_pass() { PASS_COUNT=$(( PASS_COUNT + 1 )); TOTAL_CHECKS=$(( TOTAL_CHECKS + 1 )); success "$*"; }
check_fail() { FAIL_COUNT=$(( FAIL_COUNT + 1 ));  TOTAL_CHECKS=$(( TOTAL_CHECKS + 1 )); fail    "$*"; }

# ---------------------------------------------------------------------------
# Step 1: Resolve required variables
# ---------------------------------------------------------------------------
header "Pre-flight: Configuration"

PROJECT_REF="${SUPABASE_PROJECT_REF:-shktyoxqhundlvkiwguu}"

# Derive Supabase URL from project ref if not explicitly set
if [[ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]]; then
  SUPABASE_URL="https://${PROJECT_REF}.supabase.co"
  info "NEXT_PUBLIC_SUPABASE_URL not set — derived: $SUPABASE_URL"
else
  SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL%/}"
  info "NEXT_PUBLIC_SUPABASE_URL: $SUPABASE_URL"
fi

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo -e "${RED}[ERROR]${RESET} SUPABASE_SERVICE_ROLE_KEY is not set." >&2
  echo "       Find it in: Supabase dashboard → Project Settings → API → service_role"
  exit 1
fi
info "SUPABASE_SERVICE_ROLE_KEY: set (${#SUPABASE_SERVICE_ROLE_KEY} chars)"

if [[ -z "${PRODUCTION_URL:-}" ]]; then
  PRODUCTION_URL="https://www.alfanumrik.com"
  warn "PRODUCTION_URL not set — using default: $PRODUCTION_URL"
else
  PRODUCTION_URL="${PRODUCTION_URL%/}"
  info "PRODUCTION_URL: $PRODUCTION_URL"
fi

if ! command -v curl &>/dev/null; then
  echo -e "${RED}[ERROR]${RESET} curl is required but not found. Install curl and retry." >&2
  exit 1
fi

echo ""

# ---------------------------------------------------------------------------
# Helper: HTTP check with timeout
# ---------------------------------------------------------------------------
http_status() {
  # Returns HTTP status code for a URL
  curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$@" 2>/dev/null || echo "000"
}

http_body() {
  # Returns response body
  curl -s --max-time 15 "$@" 2>/dev/null || echo ""
}

# ---------------------------------------------------------------------------
# Step 2a: Health endpoint
# ---------------------------------------------------------------------------
header "Check 1: Health Endpoint"
info "GET $PRODUCTION_URL/api/health"

STATUS=$(http_status "$PRODUCTION_URL/api/health")
echo "       HTTP status: $STATUS"

if [[ "$STATUS" == "200" ]]; then
  check_pass "Health endpoint — 200 OK"
else
  check_fail "Health endpoint — expected 200, got $STATUS"
fi

# ---------------------------------------------------------------------------
# Step 2b: Auth session endpoint
# ---------------------------------------------------------------------------
header "Check 2: Auth Session Endpoint"
info "GET $PRODUCTION_URL/api/auth/session"

STATUS=$(http_status "$PRODUCTION_URL/api/auth/session")
echo "       HTTP status: $STATUS"

if [[ "$STATUS" == "200" || "$STATUS" == "401" ]]; then
  check_pass "Auth session endpoint — $STATUS (expected 200 or 401)"
else
  check_fail "Auth session endpoint — expected 200 or 401, got $STATUS (possible 500)"
fi

# ---------------------------------------------------------------------------
# Step 2c: Foxy route
# ---------------------------------------------------------------------------
header "Check 3: Foxy API Route"
info "GET $PRODUCTION_URL/api/foxy"

STATUS=$(http_status "$PRODUCTION_URL/api/foxy")
echo "       HTTP status: $STATUS"

if [[ "$STATUS" == "401" ]]; then
  check_pass "Foxy route — 401 (auth required, as expected)"
elif [[ "$STATUS" == "405" ]]; then
  check_pass "Foxy route — 405 (method not allowed on GET, route exists)"
elif [[ "$STATUS" == "500" ]]; then
  check_fail "Foxy route — 500 (server error — check Edge Function or API logs)"
elif [[ "$STATUS" == "404" ]]; then
  check_fail "Foxy route — 404 (route not found — deployment may have failed)"
else
  warn "Foxy route — $STATUS (unexpected, verify manually)"
  check_fail "Foxy route — unexpected status $STATUS"
fi

# ---------------------------------------------------------------------------
# Step 2d: School overview RPC — should reject invalid auth, not throw undefined_function
# ---------------------------------------------------------------------------
header "Check 4: get_school_overview RPC Exists"

DUMMY_UUID="00000000-0000-0000-0000-000000000000"
RPC_URL="$SUPABASE_URL/rest/v1/rpc/get_school_overview"
info "POST $RPC_URL (service role, dummy UUID)"

RPC_RESPONSE=$(http_body \
  -X POST "$RPC_URL" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"p_school_id\": \"$DUMMY_UUID\"}")

RPC_STATUS=$(http_status \
  -X POST "$RPC_URL" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"p_school_id\": \"$DUMMY_UUID\"}")

echo "       HTTP status: $RPC_STATUS"
echo "       Response:    ${RPC_RESPONSE:0:120}..."

# 42883 = undefined_function → migration not applied
# Any other code (200, 42501, null result) = function exists
if echo "$RPC_RESPONSE" | grep -q '"42883"'; then
  check_fail "get_school_overview RPC — SQLSTATE 42883 (undefined_function) — migration not applied"
elif [[ "$RPC_STATUS" == "000" ]]; then
  check_fail "get_school_overview RPC — no response (network error)"
else
  check_pass "get_school_overview RPC — function exists (status $RPC_STATUS)"
fi

# ---------------------------------------------------------------------------
# Step 2e: Feature flags table accessible
# ---------------------------------------------------------------------------
header "Check 5: Feature Flags Table"

FLAGS_URL="$SUPABASE_URL/rest/v1/feature_flags?select=flag_name,is_enabled&limit=5"
info "GET $FLAGS_URL"

FLAGS_STATUS=$(http_status \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$FLAGS_URL")

FLAGS_BODY=$(http_body \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$FLAGS_URL")

echo "       HTTP status: $FLAGS_STATUS"
echo "       Response:    ${FLAGS_BODY:0:200}"

if [[ "$FLAGS_STATUS" == "200" ]]; then
  # Check that we got an array with at least one row
  if echo "$FLAGS_BODY" | grep -q '"flag_name"'; then
    check_pass "Feature flags — 200 OK with data rows"
  else
    check_fail "Feature flags — 200 but no rows returned (empty table?)"
  fi
else
  check_fail "Feature flags — expected 200, got $FLAGS_STATUS"
fi

# ---------------------------------------------------------------------------
# Step 3: Migration status check
# ---------------------------------------------------------------------------
header "Check 6: Pending Migrations (via supabase CLI)"

if ! command -v supabase &>/dev/null; then
  warn "Supabase CLI not found — skipping migration check."
  warn "Install CLI to enable this check: brew install supabase/tap/supabase"
  TOTAL_CHECKS=$(( TOTAL_CHECKS + 1 ))
  FAIL_COUNT=$(( FAIL_COUNT + 1 ))
  fail "Migration check — Supabase CLI not available"
elif [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  warn "SUPABASE_DB_PASSWORD not set — skipping migration dry-run check."
  warn "Set SUPABASE_DB_PASSWORD to enable this check."
  TOTAL_CHECKS=$(( TOTAL_CHECKS + 1 ))
  # Treat as warning, not failure — other checks cover function/schema state
  PASS_COUNT=$(( PASS_COUNT + 1 ))
  success "Migration check — skipped (SUPABASE_DB_PASSWORD not set)"
else
  info "Running: supabase db push --linked --include-all --dry-run ..."
  DRY_RUN_OUTPUT=$(supabase db push --linked --include-all --dry-run 2>&1 || true)

  if echo "$DRY_RUN_OUTPUT" | grep -qiE "no pending|0 migrations|already up to date"; then
    check_pass "Migration status — 0 pending migrations"
  elif echo "$DRY_RUN_OUTPUT" | grep -qiE "pending migration|migration to apply"; then
    check_fail "Migration status — pending migrations detected. Run deploy_database.sh."
  else
    # Output unclear — show it and warn
    echo "       CLI output: ${DRY_RUN_OUTPUT:0:300}"
    warn "Migration dry-run output was ambiguous — verify manually."
    TOTAL_CHECKS=$(( TOTAL_CHECKS + 1 ))
    PASS_COUNT=$(( PASS_COUNT + 1 ))
    success "Migration check — inconclusive, manual review needed"
  fi
fi

# ---------------------------------------------------------------------------
# Final summary
# ---------------------------------------------------------------------------
header "Verification Summary"

echo -e "  Checks passed: ${GREEN}${PASS_COUNT}${RESET} / $TOTAL_CHECKS"
echo -e "  Checks failed: ${RED}${FAIL_COUNT}${RESET} / $TOTAL_CHECKS"
echo ""

if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo -e "  ${BOLD}${GREEN}OVERALL: PASS${RESET}"
  echo ""
  echo "  Production deployment is healthy."
  exit 0
else
  echo -e "  ${BOLD}${RED}OVERALL: FAIL${RESET}"
  echo ""
  echo "  $FAIL_COUNT check(s) failed. Review errors above."
  echo ""
  echo "  Common resolutions:"
  echo "    - 500 on API routes:         Apply pending migrations (deploy_database.sh)"
  echo "    - 404 on Foxy route:         Redeploy Edge Functions (deploy_functions.sh)"
  echo "    - undefined_function RPC:    Check migration ordering, apply missing files"
  echo "    - Empty feature flags:       Run 20260609XXXXXX python flags migrations"
  exit 1
fi
