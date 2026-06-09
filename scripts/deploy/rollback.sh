#!/usr/bin/env bash
# =============================================================================
# rollback.sh — Alfanumrik Emergency Schema Rollback
# =============================================================================
# EMERGENCY ROLLBACK — This removes schema objects. Confirm with CEO before
# proceeding.
#
# Usage:
#   bash scripts/deploy/rollback.sh
#                         Interactive: show last 5 migrations, pick one to roll back
#   bash scripts/deploy/rollback.sh --migration 20260614200001
#                         Roll back a specific migration version
#   bash scripts/deploy/rollback.sh --all-pending
#                         Roll back all 13 pending migrations via 05_rollback.sql
#
# Required environment variables (one of):
#   SUPABASE_DB_URL       — Full Postgres connection string (preferred)
#   DATABASE_URL          — Alternative connection string name
#
# If neither is set and psql is unavailable, the script prints manual
# instructions for the Supabase SQL editor.
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
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}${CYAN}=== $* ===${RESET}\n"; }

START_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
LOG_FILE="$(dirname "$0")/.rollback.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$SCRIPT_DIR/../..")"

# ---------------------------------------------------------------------------
# WARNING BANNER
# ---------------------------------------------------------------------------
echo ""
echo -e "${RED}${BOLD}╔══════════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${RED}${BOLD}║           EMERGENCY ROLLBACK — READ BEFORE PROCEEDING           ║${RESET}"
echo -e "${RED}${BOLD}╚══════════════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}This script removes schema objects from the PRODUCTION database.${RESET}"
echo -e "  ${BOLD}Student data and existing rows are preserved, but tables/columns${RESET}"
echo -e "  ${BOLD}added by rolled-back migrations will be DROPPED.${RESET}"
echo ""
echo -e "  ${YELLOW}You MUST confirm with Pradeep (CEO) before running this script${RESET}"
echo -e "  ${YELLOW}unless you are in the middle of an active incident.${RESET}"
echo ""

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
MODE="interactive"
TARGET_VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --migration)
      MODE="specific"
      TARGET_VERSION="${2:-}"
      if [[ -z "$TARGET_VERSION" ]]; then
        error "--migration requires a version argument (e.g. 20260614200001)"
        exit 1
      fi
      shift 2
      ;;
    --all-pending)
      MODE="all-pending"
      shift
      ;;
    --help|-h)
      echo "Usage:"
      echo "  bash scripts/deploy/rollback.sh                           # interactive"
      echo "  bash scripts/deploy/rollback.sh --migration VERSION       # specific version"
      echo "  bash scripts/deploy/rollback.sh --all-pending             # roll back all 13 pending"
      exit 0
      ;;
    *)
      error "Unknown argument: $1"
      echo "Usage: $0 [--migration VERSION | --all-pending]"
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Resolve DB connection
# ---------------------------------------------------------------------------
header "Database Connection"

DB_URL="${SUPABASE_DB_URL:-${DATABASE_URL:-}}"
PSQL_AVAILABLE=0

if command -v psql &>/dev/null; then
  PSQL_AVAILABLE=1
  info "psql found: $(psql --version | head -1)"
else
  warn "psql not found."
fi

if [[ -z "$DB_URL" ]]; then
  warn "SUPABASE_DB_URL and DATABASE_URL are not set."
  warn "Will print manual SQL editor instructions instead of executing directly."
fi

if [[ -z "$DB_URL" || "$PSQL_AVAILABLE" -eq 0 ]]; then
  EXEC_MODE="manual"
  warn "Execution mode: MANUAL — you will need to run SQL in the Supabase SQL editor."
else
  EXEC_MODE="psql"
  info "Execution mode: psql"
fi

echo ""

# ---------------------------------------------------------------------------
# Helper: execute SQL or print instructions
# ---------------------------------------------------------------------------
run_sql_file() {
  local sql_file="$1"
  local description="$2"

  if [[ ! -f "$sql_file" ]]; then
    error "SQL file not found: $sql_file"
    exit 1
  fi

  if [[ "$EXEC_MODE" == "psql" ]]; then
    info "Executing: $sql_file"
    psql "$DB_URL" -f "$sql_file"
  else
    echo ""
    echo -e "${YELLOW}Manual execution required:${RESET}"
    echo "  1. Open the Supabase SQL editor:"
    echo "     https://app.supabase.com/project/shktyoxqhundlvkiwguu/sql/new"
    echo ""
    echo "  2. Paste the contents of:"
    echo "     $sql_file"
    echo ""
    echo "  3. Review the SQL carefully, then click Run."
    echo ""
  fi
}

run_sql_inline() {
  local sql="$1"
  local description="$2"

  if [[ "$EXEC_MODE" == "psql" ]]; then
    info "Executing: $description"
    psql "$DB_URL" -c "$sql"
  else
    echo ""
    echo -e "${YELLOW}Manual SQL for $description:${RESET}"
    echo "  Run in Supabase SQL editor:"
    echo "  https://app.supabase.com/project/shktyoxqhundlvkiwguu/sql/new"
    echo ""
    echo "  $sql"
    echo ""
  fi
}

# ---------------------------------------------------------------------------
# Mode: all-pending
# ---------------------------------------------------------------------------
if [[ "$MODE" == "all-pending" ]]; then
  header "Rollback: All 13 Pending Migrations"

  echo -e "  ${BOLD}This will roll back all 13 migrations that are pending as of 2026-06-09:${RESET}"
  echo ""
  echo "    20260604100000_classroom_integration_and_teacher_planner"
  echo "    20260605000000_fix_board_subject_chapter_gaps"
  echo "    20260606000000_phase5_phase6_python_flags"
  echo "    20260607000000_micro_telemetry_and_cognitive_gaps"
  echo "    20260608000000_streak_freeze_and_curriculum"
  echo "    20260609000000_lesson_flow_and_parameters"
  echo "    20260609100000_python_monthly_synthesis_builder_flag"
  echo "    20260609110000_python_nep_compliance_flag"
  echo "    20260609120000_python_parent_report_generator_flag"
  echo "    20260609130000_python_grade_experiment_conclusion_flag"
  echo "    20260609140000_python_verify_question_bank_flag"
  echo "    20260609150000_python_extract_ncert_questions_flag"
  echo "    20260609160000_python_bulk_non_mcq_gen_flag"
  echo ""

  read -rp "$(echo -e "${RED}Type ROLLBACK to confirm you have CEO authorization:${RESET} ")" CONFIRM
  echo ""
  if [[ "$CONFIRM" != "ROLLBACK" ]]; then
    info "Aborted. No changes made."
    exit 0
  fi

  ROLLBACK_SQL="$REPO_ROOT/scripts/recovery/05_rollback.sql"

  if [[ ! -f "$ROLLBACK_SQL" ]]; then
    error "Rollback SQL not found at: $ROLLBACK_SQL"
    echo "       Expected location: scripts/recovery/05_rollback.sql"
    exit 1
  fi

  run_sql_file "$ROLLBACK_SQL" "Roll back all 13 pending migrations"

  # Remove from supabase_migrations tracking
  info "Removing rolled-back versions from supabase_migrations.schema_migrations..."
  VERSIONS=(
    "20260604100000"
    "20260605000000"
    "20260606000000"
    "20260607000000"
    "20260608000000"
    "20260609000000"
    "20260609100000"
    "20260609110000"
    "20260609120000"
    "20260609130000"
    "20260609140000"
    "20260609150000"
    "20260609160000"
  )
  for v in "${VERSIONS[@]}"; do
    run_sql_inline \
      "DELETE FROM supabase_migrations.schema_migrations WHERE version = '$v';" \
      "Remove version $v from migration history"
  done

  success "Rollback complete. Migration tracking updated."
  echo ""
  echo -e "${BOLD}After rollback:${RESET}"
  echo "  1. Verify schema: run scripts/recovery/04_validation.sql"
  echo "  2. Verify no pending: run bash scripts/deploy/verify_production.sh"
  echo "  3. Fix the failing migration(s) before re-deploying."
  echo ""

  {
    echo "---"
    echo "timestamp:    $START_ISO"
    echo "git_sha:      $GIT_SHA"
    echo "mode:         all-pending"
    echo "exec_mode:    $EXEC_MODE"
  } >> "$LOG_FILE"

  exit 0
fi

# ---------------------------------------------------------------------------
# Mode: specific migration
# ---------------------------------------------------------------------------
if [[ "$MODE" == "specific" ]]; then
  header "Rollback: Migration $TARGET_VERSION"

  echo -e "  ${BOLD}Target version:${RESET} $TARGET_VERSION"
  echo ""

  # Look for a rollback SQL file named after this version
  CANDIDATE_SQL="$REPO_ROOT/scripts/recovery/rollback_${TARGET_VERSION}.sql"
  if [[ -f "$CANDIDATE_SQL" ]]; then
    info "Found rollback file: $CANDIDATE_SQL"
  else
    warn "No dedicated rollback file found at: $CANDIDATE_SQL"
    warn "You will need to write and review the compensating SQL manually."
    echo ""
    echo "General guidance for rolling back $TARGET_VERSION:"
    echo "  - Find the migration file: supabase/migrations/${TARGET_VERSION}_*.sql"
    echo "  - For each CREATE TABLE → write DROP TABLE IF EXISTS"
    echo "  - For each ALTER TABLE ADD COLUMN → write ALTER TABLE DROP COLUMN IF EXISTS"
    echo "  - For each CREATE INDEX → write DROP INDEX IF EXISTS"
    echo "  - For each INSERT (feature flags) → write DELETE WHERE version = '${TARGET_VERSION}'"
    echo "  - NEVER drop tables or columns containing student data without CEO approval"
    echo ""
  fi

  read -rp "$(echo -e "${RED}Type ROLLBACK to confirm you have CEO authorization:${RESET} ")" CONFIRM
  echo ""
  if [[ "$CONFIRM" != "ROLLBACK" ]]; then
    info "Aborted. No changes made."
    exit 0
  fi

  if [[ -f "$CANDIDATE_SQL" ]]; then
    run_sql_file "$CANDIDATE_SQL" "Roll back migration $TARGET_VERSION"
  else
    echo -e "${YELLOW}Manual rollback required — no automated SQL available.${RESET}"
    echo "Write compensating SQL and run it in:"
    echo "  https://app.supabase.com/project/shktyoxqhundlvkiwguu/sql/new"
  fi

  # Remove from supabase migration history
  run_sql_inline \
    "DELETE FROM supabase_migrations.schema_migrations WHERE version = '$TARGET_VERSION';" \
    "Remove version $TARGET_VERSION from migration history"

  success "Rolled back migration $TARGET_VERSION."

  {
    echo "---"
    echo "timestamp:    $START_ISO"
    echo "git_sha:      $GIT_SHA"
    echo "mode:         specific"
    echo "version:      $TARGET_VERSION"
    echo "exec_mode:    $EXEC_MODE"
  } >> "$LOG_FILE"

  exit 0
fi

# ---------------------------------------------------------------------------
# Mode: interactive — show last 5 applied migrations, pick one
# ---------------------------------------------------------------------------
header "Interactive Rollback: Last Applied Migrations"

HISTORY_SQL="SELECT version, checksum FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;"

if [[ "$EXEC_MODE" == "psql" ]]; then
  info "Querying migration history..."
  echo ""
  psql "$DB_URL" -c "$HISTORY_SQL"
  echo ""
  read -rp "Enter the VERSION to roll back (e.g. 20260609160000), or press Enter to abort: " PICKED_VERSION
  echo ""

  if [[ -z "$PICKED_VERSION" ]]; then
    info "Aborted. No changes made."
    exit 0
  fi

  # Re-run as --migration mode
  exec "$0" --migration "$PICKED_VERSION"
else
  warn "psql not available — cannot query migration history interactively."
  echo ""
  echo "To view the last 5 applied migrations, run this in the Supabase SQL editor:"
  echo "  https://app.supabase.com/project/shktyoxqhundlvkiwguu/sql/new"
  echo ""
  echo "  $HISTORY_SQL"
  echo ""
  echo "Then re-run this script with the version you want to roll back:"
  echo "  bash scripts/deploy/rollback.sh --migration VERSION"
  echo ""
  echo "Or to roll back all 13 pending migrations:"
  echo "  bash scripts/deploy/rollback.sh --all-pending"
  echo ""
  exit 0
fi
