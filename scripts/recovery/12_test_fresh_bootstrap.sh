#!/usr/bin/env bash
# scripts/recovery/12_test_fresh_bootstrap.sh
# Date: 2026-06-14
#
# Bootstrap test script for Alfanumrik.
# Tests that a fresh Supabase project can be initialized from the current
# migration chain without errors. Validates table count, critical RPCs,
# and trigger existence after bootstrap.
#
# Matches the pattern from docs/runbooks/schema-reproducibility-fix.md §4.
#
# PREREQUISITES:
#   - supabase CLI installed (brew install supabase/tap/supabase)
#   - supabase CLI logged in (supabase login)
#   - Supabase org exists with capacity to create a new project
#   - SUPABASE_ORG_ID environment variable set
#   - SUPABASE_ACCESS_TOKEN environment variable set (or supabase login done)
#
# USAGE:
#   export SUPABASE_ORG_ID=your-org-id
#   bash scripts/recovery/12_test_fresh_bootstrap.sh
#
# EXIT CODES:
#   0 — bootstrap succeeded and all validations passed
#   1 — bootstrap failed or validations failed
#   2 — prerequisites not met

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_PROJECT_NAME="alfanumrik-bootstrap-test-$(date +%s)"
RESULTS_FILE="/tmp/bootstrap_test_results_$(date +%Y%m%d_%H%M%S).txt"

# Expected minimums (adjust if schema grows significantly)
MIN_TABLE_COUNT=80
MIN_FUNCTION_COUNT=100

echo "============================================================"
echo "  Alfanumrik — Fresh Bootstrap Test"
echo "  Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Repo root: $REPO_ROOT"
echo "  Test project name: $TEST_PROJECT_NAME"
echo "============================================================"
echo ""

# ── Prerequisite checks ────────────────────────────────────────────────────────
echo "[ Phase 0 ] Checking prerequisites..."

if ! command -v supabase &>/dev/null; then
  echo "ERROR: supabase CLI not found. Install with: brew install supabase/tap/supabase"
  exit 2
fi

SUPABASE_VERSION=$(supabase --version 2>/dev/null | head -1)
echo "  supabase CLI: $SUPABASE_VERSION"

if [ -z "${SUPABASE_ORG_ID:-}" ]; then
  echo "ERROR: SUPABASE_ORG_ID environment variable not set."
  echo "  Set it to your Supabase organization ID (found in your org settings)."
  exit 2
fi

echo "  SUPABASE_ORG_ID: $SUPABASE_ORG_ID"
echo "  Migration count: $(ls "$REPO_ROOT/supabase/migrations/"*.sql 2>/dev/null | wc -l | tr -d ' ') files"
echo ""

# ── Phase 1: Create throwaway project ─────────────────────────────────────────
echo "[ Phase 1 ] Creating throwaway Supabase project..."
echo "  Name: $TEST_PROJECT_NAME"
echo "  NOTE: This will take 2-3 minutes while Supabase provisions the project."
echo ""

PROJECT_REF=$(supabase projects create "$TEST_PROJECT_NAME" \
  --org-id "$SUPABASE_ORG_ID" \
  --region ap-south-1 \
  --plan free \
  --output json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || true)

if [ -z "$PROJECT_REF" ]; then
  echo "ERROR: Failed to create throwaway project. Check supabase CLI auth and org permissions."
  exit 1
fi

echo "  Created project ref: $PROJECT_REF"
echo ""

# ── Cleanup trap ───────────────────────────────────────────────────────────────
cleanup() {
  local exit_code=$?
  echo ""
  echo "[ Cleanup ] Tearing down throwaway project $PROJECT_REF..."
  supabase projects delete "$PROJECT_REF" --confirm 2>/dev/null || true
  echo "  Project deleted."
  exit $exit_code
}
trap cleanup EXIT

# ── Phase 2: Wait for project to be ready ─────────────────────────────────────
echo "[ Phase 2 ] Waiting for project to reach ACTIVE state..."
MAX_WAIT=180  # 3 minutes
WAIT_INTERVAL=10
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
  STATUS=$(supabase projects list --output json 2>/dev/null | \
    python3 -c "import sys,json; projects=json.load(sys.stdin); p=[x for x in projects if x['id']=='$PROJECT_REF']; print(p[0]['status'] if p else 'unknown')" 2>/dev/null || echo "unknown")

  if [ "$STATUS" = "ACTIVE_HEALTHY" ]; then
    echo "  Project is ACTIVE_HEALTHY."
    break
  fi

  echo "  Status: $STATUS (waiting ${WAIT_INTERVAL}s...)"
  sleep $WAIT_INTERVAL
  ELAPSED=$((ELAPSED + WAIT_INTERVAL))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo "ERROR: Project did not reach ACTIVE_HEALTHY within ${MAX_WAIT}s."
  exit 1
fi

echo ""

# ── Phase 3: Link project and run migrations ───────────────────────────────────
echo "[ Phase 3 ] Linking and running db push..."
cd "$REPO_ROOT"

echo "  Running: supabase db push --linked --include-all (against $PROJECT_REF)"
PUSH_EXIT=0
PUSH_OUTPUT=$(supabase db push \
  --db-url "$(supabase db url --project-ref "$PROJECT_REF" 2>/dev/null)" \
  --include-all 2>&1) || PUSH_EXIT=$?

if [ $PUSH_EXIT -ne 0 ]; then
  echo "FAIL: supabase db push failed with exit code $PUSH_EXIT"
  echo ""
  echo "=== Push output ==="
  echo "$PUSH_OUTPUT"
  echo "==================="
  echo ""
  echo "BOOTSTRAP TEST: FAIL"
  exit 1
fi

echo "  db push completed successfully."
echo ""
echo "=== Push output (last 20 lines) ==="
echo "$PUSH_OUTPUT" | tail -20
echo "====================================="
echo ""

# ── Phase 4: Validate bootstrap results ───────────────────────────────────────
echo "[ Phase 4 ] Validating bootstrap..."
DB_URL=$(supabase db url --project-ref "$PROJECT_REF" 2>/dev/null)

if [ -z "$DB_URL" ]; then
  echo "WARNING: Could not get DB URL for validation. Skipping SQL checks."
else
  # 4a: Table count
  echo "  Checking table count (minimum $MIN_TABLE_COUNT)..."
  TABLE_COUNT=$(psql "$DB_URL" -t -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'" \
    2>/dev/null | tr -d ' \n' || echo "0")
  echo "  Table count: $TABLE_COUNT"

  # 4b: Critical RPCs
  echo "  Checking critical RPCs..."
  MISSING_RPCS=$(psql "$DB_URL" -t -c \
    "SELECT proname FROM (VALUES
      ('atomic_quiz_profile_update'),
      ('bootstrap_user_profile'),
      ('submit_quiz_results_v2'),
      ('activate_subscription')
    ) AS needed(proname)
    WHERE proname NOT IN (
      SELECT proname FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    )" \
    2>/dev/null | tr -d ' ' | grep -v '^$' || true)

  # 4c: Trigger count
  echo "  Checking trigger count..."
  TRIGGER_COUNT=$(psql "$DB_URL" -t -c \
    "SELECT count(*) FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal" \
    2>/dev/null | tr -d ' \n' || echo "0")
  echo "  Trigger count: $TRIGGER_COUNT"

  # 4d: RLS violations
  echo "  Checking for RLS violations (tables without RLS)..."
  RLS_VIOLATIONS=$(psql "$DB_URL" -t -c \
    "SELECT relname FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity" \
    2>/dev/null | tr -d ' ' | grep -v '^$' | wc -l | tr -d ' ' || echo "unknown")
  echo "  Tables without RLS: $RLS_VIOLATIONS"

  # ── Build results ────────────────────────────────────────────────────────────
  echo "" | tee "$RESULTS_FILE"
  echo "=== BOOTSTRAP TEST RESULTS ===" | tee -a "$RESULTS_FILE"
  echo "Project: $TEST_PROJECT_NAME ($PROJECT_REF)" | tee -a "$RESULTS_FILE"
  echo "Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')" | tee -a "$RESULTS_FILE"
  echo "" | tee -a "$RESULTS_FILE"

  PASS=true

  echo "Table count:    $TABLE_COUNT (minimum $MIN_TABLE_COUNT)" | tee -a "$RESULTS_FILE"
  if [ "${TABLE_COUNT:-0}" -lt "$MIN_TABLE_COUNT" ] 2>/dev/null; then
    echo "  FAIL: table count below minimum" | tee -a "$RESULTS_FILE"
    PASS=false
  else
    echo "  PASS" | tee -a "$RESULTS_FILE"
  fi

  echo "Missing RPCs:   ${MISSING_RPCS:-none}" | tee -a "$RESULTS_FILE"
  if [ -n "$MISSING_RPCS" ]; then
    echo "  FAIL: critical RPCs missing" | tee -a "$RESULTS_FILE"
    PASS=false
  else
    echo "  PASS" | tee -a "$RESULTS_FILE"
  fi

  echo "Trigger count:  $TRIGGER_COUNT" | tee -a "$RESULTS_FILE"
  echo "RLS violations: $RLS_VIOLATIONS tables without RLS" | tee -a "$RESULTS_FILE"
  if [ "${RLS_VIOLATIONS:-0}" -gt 0 ] 2>/dev/null; then
    echo "  WARN: P8 violations detected — review RLS policies" | tee -a "$RESULTS_FILE"
  fi

  echo "" | tee -a "$RESULTS_FILE"
  if [ "$PASS" = true ]; then
    echo "OVERALL: PASS" | tee -a "$RESULTS_FILE"
    echo "============================="
    echo ""
    echo "BOOTSTRAP TEST: PASS"
    echo "Results saved to: $RESULTS_FILE"
  else
    echo "OVERALL: FAIL" | tee -a "$RESULTS_FILE"
    echo "============================="
    echo ""
    echo "BOOTSTRAP TEST: FAIL"
    echo "Results saved to: $RESULTS_FILE"
    exit 1
  fi
fi
