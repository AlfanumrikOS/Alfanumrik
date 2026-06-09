#!/usr/bin/env bash
# =============================================================================
# deploy_database.sh — Alfanumrik Production Database Migration Deployer
# =============================================================================
# Applies pending Supabase migrations to the production project.
#
# Usage:
#   bash scripts/deploy/deploy_database.sh
#   DRY_RUN=1 bash scripts/deploy/deploy_database.sh
#
# Required environment variables:
#   SUPABASE_ACCESS_TOKEN   — Personal access token from app.supabase.com/account/tokens
#   SUPABASE_DB_PASSWORD    — Database password for the project
#   SUPABASE_PROJECT_REF    — Project ref (default: shktyoxqhundlvkiwguu)
#
# Optional:
#   DRY_RUN=1               — Preview migrations without applying them
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Color setup (only when stdout is a terminal)
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

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}${CYAN}=== $* ===${RESET}\n"; }

# ---------------------------------------------------------------------------
# Timing
# ---------------------------------------------------------------------------
START_TIME=$(date +%s)
START_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
LOG_FILE="$(dirname "$0")/.last_deploy.log"

# ---------------------------------------------------------------------------
# Step 1: Check Supabase CLI is installed
# ---------------------------------------------------------------------------
header "Pre-flight: Supabase CLI"

if ! command -v supabase &>/dev/null; then
  error "Supabase CLI not found. Install it with one of:"
  echo ""
  echo "  macOS/Linux (Homebrew):  brew install supabase/tap/supabase"
  echo "  Windows (Scoop):         scoop bucket add supabase https://github.com/supabase/scoop-bucket.git"
  echo "                           scoop install supabase"
  echo "  npm (any platform):      npm install -g supabase"
  echo "  Direct download:         https://github.com/supabase/cli/releases"
  echo ""
  exit 1
fi

SUPABASE_VERSION=$(supabase --version 2>/dev/null || echo "unknown")
success "Supabase CLI found: $SUPABASE_VERSION"

# ---------------------------------------------------------------------------
# Step 2: Validate required environment variables
# ---------------------------------------------------------------------------
header "Pre-flight: Environment Variables"

MISSING_VARS=0

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  error "SUPABASE_ACCESS_TOKEN is not set."
  echo "       Get it from: https://app.supabase.com/account/tokens"
  MISSING_VARS=1
fi

if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  error "SUPABASE_DB_PASSWORD is not set."
  echo "       Find it in: Supabase dashboard → Project Settings → Database → Password"
  MISSING_VARS=1
fi

PROJECT_REF="${SUPABASE_PROJECT_REF:-shktyoxqhundlvkiwguu}"

if [[ "$MISSING_VARS" -eq 1 ]]; then
  error "One or more required environment variables are missing. Aborting."
  exit 1
fi

success "SUPABASE_ACCESS_TOKEN: set (${#SUPABASE_ACCESS_TOKEN} chars)"
success "SUPABASE_DB_PASSWORD:  set (${#SUPABASE_DB_PASSWORD} chars)"
success "SUPABASE_PROJECT_REF:  $PROJECT_REF"

# ---------------------------------------------------------------------------
# Step 3: Confirmation prompt
# ---------------------------------------------------------------------------
header "Deployment Target"

echo -e "  ${BOLD}Project ref:${RESET}  $PROJECT_REF"
echo -e "  ${BOLD}Git SHA:${RESET}      $GIT_SHA"
echo -e "  ${BOLD}Dry run:${RESET}      ${DRY_RUN:-0}"
echo ""

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  warn "DRY_RUN=1 — No changes will be applied to the database."
  echo ""
else
  warn "This will apply pending migrations to PRODUCTION (project: $PROJECT_REF)."
  echo ""
  read -rp "Type 'yes' to continue: " CONFIRM
  echo ""
  if [[ "$CONFIRM" != "yes" ]]; then
    info "Aborted by user."
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# Cleanup handler: write log on exit
# ---------------------------------------------------------------------------
EXIT_CODE=0
write_log() {
  EXIT_CODE=$?
  END_TIME=$(date +%s)
  END_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  DURATION=$(( END_TIME - START_TIME ))

  {
    echo "---"
    echo "start_time:   $START_ISO"
    echo "end_time:     $END_ISO"
    echo "duration_sec: $DURATION"
    echo "git_sha:      $GIT_SHA"
    echo "project_ref:  $PROJECT_REF"
    echo "dry_run:      ${DRY_RUN:-0}"
    echo "exit_code:    $EXIT_CODE"
  } >> "$LOG_FILE"
}
trap write_log EXIT

# ---------------------------------------------------------------------------
# Step 4: Link project
# ---------------------------------------------------------------------------
header "Linking to Supabase project"

info "Running: supabase link --project-ref $PROJECT_REF ..."
if ! supabase link --project-ref "$PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"; then
  error "Failed to link project. Check credentials and network access."
  exit 1
fi
success "Linked to project $PROJECT_REF"

# ---------------------------------------------------------------------------
# Step 5: Apply or dry-run migrations
# ---------------------------------------------------------------------------
header "Database Migrations"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  info "DRY RUN — Previewing pending migrations (no changes applied):"
  echo ""
  supabase db push --linked --include-all --dry-run
  echo ""
  success "Dry run complete. Review the output above, then run without DRY_RUN=1 to apply."
  exit 0
fi

info "Applying all pending migrations..."
echo ""

if ! supabase db push --linked --include-all; then
  echo ""
  error "Migration deployment FAILED."
  echo ""
  echo -e "${YELLOW}Common SQLSTATE error codes and what they mean:${RESET}"
  echo "  42883 — undefined_function: A function referenced in ALTER FUNCTION"
  echo "          does not exist yet. Check migration ordering or the dynamic"
  echo "          pg_proc loop in the migration. Run the migration guard query:"
  echo "          SELECT proname FROM pg_proc WHERE proname LIKE '%your_func%';"
  echo ""
  echo "  42P07 — duplicate_table: Table already exists. Migration not idempotent."
  echo "          Verify the migration uses CREATE TABLE IF NOT EXISTS."
  echo ""
  echo "  23505 — unique_violation: Duplicate key during data backfill."
  echo "          Add ON CONFLICT DO NOTHING to INSERT statements."
  echo ""
  echo "  42501 — insufficient_privilege: Role lacks permission."
  echo "          Verify GRANT statements in migration or run as service role."
  echo ""
  echo "  40001 — serialization_failure: Deadlock or serialization conflict."
  echo "          Retry the deployment; usually transient."
  echo ""
  echo -e "${YELLOW}Recovery options:${RESET}"
  echo "  1. Inspect supabase_migrations.schema_migrations for last success."
  echo "  2. Run scripts/recovery/02_drift_report.sql to identify missing objects."
  echo "  3. Apply individual migrations via scripts/recovery/03_repair_migrations.sql"
  echo "  4. For rollback: bash scripts/deploy/rollback.sh --all-pending"
  echo "     or run scripts/recovery/05_rollback.sql in the Supabase SQL editor."
  echo ""
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 6: Success
# ---------------------------------------------------------------------------
echo ""
success "All migrations applied successfully."
echo ""
echo -e "${BOLD}Next steps:${RESET}"
echo "  1. Validate the schema:"
echo "     Open Supabase SQL editor → run scripts/recovery/04_validation.sql"
echo "     Expected output: VALIDATION PASSED"
echo ""
echo "  2. Deploy Edge Functions:"
echo "     bash scripts/deploy/deploy_functions.sh"
echo "     (or with --all to redeploy all 46 functions)"
echo ""
echo -e "  ${GREEN}Deployment log written to: $LOG_FILE${RESET}"
