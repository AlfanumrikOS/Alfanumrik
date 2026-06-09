#!/usr/bin/env bash
# scripts/recovery/11_emergency_rollback.sh
# Date: 2026-06-14
#
# Emergency rollback helper for the 2026-06-14 repair migrations.
# Provides safety checks, shows what would change, and gives the exact
# CLI commands to revert schema_migrations entries.
#
# USAGE:
#   bash scripts/recovery/11_emergency_rollback.sh [--dry-run] [--confirm]
#
# FLAGS:
#   --dry-run    Show what would happen without making any changes (default)
#   --confirm    Actually execute the rollback steps (requires explicit flag)
#
# SAFETY: This script defaults to --dry-run. You must pass --confirm to
# execute any destructive operations. Even with --confirm, SQL against the
# database is NOT run by this script — it prints the commands you must
# run manually in the Supabase SQL editor.

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
REPAIR_VERSIONS=("20260614200000" "20260614200001" "20260614200002")
REPAIR_NAMES=(
  "repair_security_advisor_batch1"
  "repair_api_query_path_indexes"
  "bootstrap_idempotency_harness"
)
MIGRATION_DIR="supabase/migrations"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Argument parsing ────────────────────────────────────────────────────────────
DRY_RUN=true
for arg in "$@"; do
  case "$arg" in
    --confirm) DRY_RUN=false ;;
    --dry-run) DRY_RUN=true ;;
  esac
done

echo "============================================================"
echo "  Alfanumrik — Emergency Rollback: Repair Migrations"
echo "  Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Mode: $([ "$DRY_RUN" = true ] && echo 'DRY RUN (no changes)' || echo 'CONFIRM MODE')"
echo "============================================================"
echo ""

# ── Step 1: Verify migration files exist ──────────────────────────────────────
echo "[ Step 1 ] Checking repair migration files..."
ALL_PRESENT=true
for i in "${!REPAIR_VERSIONS[@]}"; do
  ver="${REPAIR_VERSIONS[$i]}"
  name="${REPAIR_NAMES[$i]}"
  filepath="$REPO_ROOT/$MIGRATION_DIR/${ver}_${name}.sql"
  if [ -f "$filepath" ]; then
    echo "  FOUND: $filepath"
  else
    echo "  MISSING: $filepath"
    ALL_PRESENT=false
  fi
done

if [ "$ALL_PRESENT" = false ]; then
  echo ""
  echo "WARNING: Some repair migration files are missing from disk."
  echo "If you have already deleted them, that is expected for a rollback."
  echo "If they should exist, check git status before proceeding."
fi

# ── Step 2: Check git status ───────────────────────────────────────────────────
echo ""
echo "[ Step 2 ] Git status (relevant files)..."
cd "$REPO_ROOT"
git status --short -- "$MIGRATION_DIR/20260614200000_repair_security_advisor_batch1.sql" \
                     "$MIGRATION_DIR/20260614200001_repair_api_query_path_indexes.sql" \
                     "$MIGRATION_DIR/20260614200002_bootstrap_idempotency_harness.sql" 2>/dev/null || true

echo ""
echo "[ Step 2b ] Recent commits touching repair migrations..."
git log --oneline --follow -- "$MIGRATION_DIR/20260614200*" 2>/dev/null | head -5 || echo "(no commits found)"

# ── Step 3: Print rollback SQL ─────────────────────────────────────────────────
echo ""
echo "[ Step 3 ] SQL to run in Supabase SQL editor (project shktyoxqhundlvkiwguu)"
echo "          PASTE CAREFULLY — only run sections for what you are reverting."
echo ""
echo "--- SECTION A: Reset search_path on pinned functions (20260614200000) ---"
cat << 'SECTION_A'
-- Paste in Supabase SQL editor. Uncomment only functions causing problems.
-- ALTER FUNCTION public.submit_mock_test_attempt(uuid, uuid, jsonb, integer, jsonb) RESET search_path;
-- ALTER FUNCTION public.tp_messages_bump_thread()                                   RESET search_path;
-- ALTER FUNCTION public.sync_admin_user_role()                                      RESET search_path;
-- ALTER FUNCTION public.sync_user_roles_on_insert()                                 RESET search_path;
-- (See 10_rollback_repair_migrations.sql for the full list)
SECTION_A

echo ""
echo "--- SECTION B: Drop repair indexes (20260614200001) ---"
cat << 'SECTION_B'
-- Paste in Supabase SQL editor. Uncomment all or specific indexes to drop.
-- DROP INDEX IF EXISTS public.idx_tp_threads_student_id;
-- DROP INDEX IF EXISTS public.idx_tp_messages_sender;
-- DROP INDEX IF EXISTS public.idx_parental_consent_version;
-- DROP INDEX IF EXISTS public.idx_data_erasure_requests_student;
-- DROP INDEX IF EXISTS public.idx_data_erasure_requests_status_created;
-- DROP INDEX IF EXISTS public.idx_synthetic_monitor_results_name_checked;
-- DROP INDEX IF EXISTS public.idx_synthetic_monitor_results_status;
-- DROP INDEX IF EXISTS public.idx_school_slo_log_school_evaluated;
-- DROP INDEX IF EXISTS public.idx_grounding_circuit_state_name;
-- DROP INDEX IF EXISTS public.idx_admin_login_attempts_user_attempted;
-- DROP INDEX IF EXISTS public.idx_parent_cheers_notification_id;
-- DROP INDEX IF EXISTS public.idx_teacher_remediation_teacher_id;
-- DROP INDEX IF EXISTS public.idx_teacher_remediation_student_id;
-- DROP INDEX IF EXISTS public.idx_teacher_remediation_status_assigned;
-- DROP INDEX IF EXISTS public.idx_at_risk_alerts_school_status;
SECTION_B

echo ""
echo "--- SECTION D (LAST RESORT): Remove schema_migrations entries ---"
cat << 'SECTION_D'
-- Run ONLY after:
--   (a) You have completed all SQL rollbacks above
--   (b) You have deleted the .sql files from the repo AND committed
-- Removing the version records without deleting the files will cause
-- re-application on the next deploy.
--
-- DELETE FROM supabase_migrations.schema_migrations
-- WHERE version IN ('20260614200000', '20260614200001', '20260614200002');
SECTION_D

# ── Step 4: Git revert commands ────────────────────────────────────────────────
echo ""
echo "[ Step 4 ] Git commands to remove repair migration files"
echo ""
echo "  To revert the file additions:"
echo "    git rm $MIGRATION_DIR/20260614200000_repair_security_advisor_batch1.sql"
echo "    git rm $MIGRATION_DIR/20260614200001_repair_api_query_path_indexes.sql"
echo "    git rm $MIGRATION_DIR/20260614200002_bootstrap_idempotency_harness.sql"
echo "    git commit -m 'revert(migrations): remove 2026-06-14 repair migrations'"
echo ""
echo "  Or use git revert to create a revert commit:"
REPAIR_COMMIT=$(git log --oneline --all -- "$MIGRATION_DIR/20260614200000_repair_security_advisor_batch1.sql" 2>/dev/null | head -1 | awk '{print $1}' || echo "<commit-hash>")
echo "    git revert $REPAIR_COMMIT --no-commit"
echo "    git commit -m 'revert(migrations): remove 2026-06-14 repair migrations'"

# ── Step 5: Post-rollback validation reminder ──────────────────────────────────
echo ""
echo "[ Step 5 ] After completing SQL rollbacks, run these validation scripts:"
echo "    psql \$DATABASE_URL -f scripts/recovery/04_validate_indexes.sql"
echo "    psql \$DATABASE_URL -f scripts/recovery/09_validate_edge_function_rpcs.sql"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "============================================================"
  echo "  DRY RUN COMPLETE — no changes made."
  echo "  Re-run with --confirm to execute (git operations only;"
  echo "  SQL must be pasted manually in Supabase SQL editor)."
  echo "============================================================"
else
  echo "============================================================"
  echo "  CONFIRM MODE — this script does not execute SQL directly."
  echo "  Follow the SQL sections above in the Supabase SQL editor."
  echo "  Follow the git commands above in your terminal."
  echo "============================================================"
fi
