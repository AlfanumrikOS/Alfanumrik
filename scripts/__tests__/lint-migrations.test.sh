#!/usr/bin/env bash
# Self-test for scripts/lint-migrations.js (Phase E.2).
#
# Runs the linter against a fixture directory containing:
#   1. A clean migration (should pass)
#   2. A SELECT-1 placeholder WITHOUT the allow marker (should fail)
#   3. A SELECT-1 placeholder WITH the allow marker (should pass)
#   4. An empty/comments-only migration (should fail)
#
# Exits 0 if all assertions hold, 1 otherwise. Designed to run locally and
# in CI without any test framework.
#
# Usage:  bash scripts/__tests__/lint-migrations.test.sh

set -u

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
LINTER="$REPO_ROOT/scripts/lint-migrations.js"

if [ ! -f "$LINTER" ]; then
  echo "FAIL: linter not found at $LINTER"
  exit 1
fi

# Stage a temp repo-shape with our own supabase/migrations directory so the
# linter (which scans <repo>/supabase/migrations) operates on fixtures only.
TMP_ROOT="$(mktemp -d 2>/dev/null || mktemp -d -t 'lint-mig')"
trap 'rm -rf "$TMP_ROOT"' EXIT
mkdir -p "$TMP_ROOT/supabase/migrations"
mkdir -p "$TMP_ROOT/scripts"
cp "$LINTER" "$TMP_ROOT/scripts/lint-migrations.js"

FAIL_COUNT=0
pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

run_linter() {
  ( cd "$TMP_ROOT" && node scripts/lint-migrations.js > /tmp/lint-mig-out.txt 2>&1 )
  echo $?
}

# Case 1: a real DDL migration — should pass.
echo "Case 1: real DDL migration"
cat > "$TMP_ROOT/supabase/migrations/20990101000001_real_ddl.sql" <<'EOF'
-- A real migration with actual DDL.
CREATE TABLE IF NOT EXISTS test_e2_fixture (id uuid PRIMARY KEY);
ALTER TABLE test_e2_fixture ENABLE ROW LEVEL SECURITY;
EOF
EXIT_CODE=$(run_linter)
if [ "$EXIT_CODE" = "0" ]; then
  pass "clean migration exits 0"
else
  fail "expected exit 0, got $EXIT_CODE"
  cat /tmp/lint-mig-out.txt
fi
rm "$TMP_ROOT/supabase/migrations/20990101000001_real_ddl.sql"

# Case 2: unannotated SELECT-1 placeholder — should fail.
echo "Case 2: unannotated SELECT-1 placeholder"
cat > "$TMP_ROOT/supabase/migrations/20990101000002_bad_placeholder.sql" <<'EOF'
-- This migration sneaks in a no-op without acknowledging it.
SELECT 1;
EOF
EXIT_CODE=$(run_linter)
if [ "$EXIT_CODE" = "1" ]; then
  pass "unannotated placeholder exits 1"
else
  fail "expected exit 1, got $EXIT_CODE"
  cat /tmp/lint-mig-out.txt
fi
if grep -q "20990101000002_bad_placeholder.sql" /tmp/lint-mig-out.txt; then
  pass "offender filename in output"
else
  fail "offender filename missing from output"
  cat /tmp/lint-mig-out.txt
fi

# Case 3: SELECT-1 placeholder WITH allow marker — should pass.
echo "Case 3: SELECT-1 placeholder with -- lint:allow-placeholder"
cat > "$TMP_ROOT/supabase/migrations/20990101000003_good_placeholder.sql" <<'EOF'
-- lint:allow-placeholder
-- Intentional no-op for fixture test.
SELECT 1 WHERE false;
EOF
EXIT_CODE=$(run_linter)
if [ "$EXIT_CODE" = "1" ]; then
  pass "case 3 (still has case 2 in dir) still fails — good"
else
  fail "expected exit 1 (case 2 still present), got $EXIT_CODE"
fi
# Now remove the bad one and verify the allow marker pulls case 3 through.
rm "$TMP_ROOT/supabase/migrations/20990101000002_bad_placeholder.sql"
EXIT_CODE=$(run_linter)
if [ "$EXIT_CODE" = "0" ]; then
  pass "allow-marked placeholder exits 0 once bad file is gone"
else
  fail "expected exit 0, got $EXIT_CODE"
  cat /tmp/lint-mig-out.txt
fi

# Case 4: BEGIN...COMMIT wrapped SELECT-1 — should fail (matches pattern).
echo "Case 4: BEGIN/COMMIT wrapped SELECT-1"
cat > "$TMP_ROOT/supabase/migrations/20990101000004_begin_commit_select.sql" <<'EOF'
-- A wrapped placeholder still has no schema effect.
BEGIN;
SELECT 1 WHERE FALSE;
COMMIT;
EOF
EXIT_CODE=$(run_linter)
if [ "$EXIT_CODE" = "1" ]; then
  pass "BEGIN/COMMIT-wrapped SELECT-1 still fails"
else
  fail "expected exit 1, got $EXIT_CODE"
  cat /tmp/lint-mig-out.txt
fi
rm "$TMP_ROOT/supabase/migrations/20990101000004_begin_commit_select.sql"

# Case 5: empty / comments-only — should fail.
echo "Case 5: comments-only migration"
cat > "$TMP_ROOT/supabase/migrations/20990101000005_only_comments.sql" <<'EOF'
-- I forgot to write any SQL.
-- This should be caught too.
EOF
EXIT_CODE=$(run_linter)
if [ "$EXIT_CODE" = "1" ]; then
  pass "comments-only migration fails"
else
  fail "expected exit 1, got $EXIT_CODE"
  cat /tmp/lint-mig-out.txt
fi
rm "$TMP_ROOT/supabase/migrations/20990101000005_only_comments.sql"

# Case 6: SELECT 1 inside a real EXISTS() subquery — should pass (the body
# is not a placeholder; SELECT 1 is just a sentinel inside DDL).
echo "Case 6: SELECT 1 inside EXISTS subquery (legitimate idiom)"
cat > "$TMP_ROOT/supabase/migrations/20990101000006_real_ddl_with_exists.sql" <<'EOF'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fixture_enum') THEN
    CREATE TYPE fixture_enum AS ENUM ('a', 'b');
  END IF;
END $$;
EOF
EXIT_CODE=$(run_linter)
if [ "$EXIT_CODE" = "0" ]; then
  pass "EXISTS idiom not mis-classified as placeholder"
else
  fail "expected exit 0, got $EXIT_CODE"
  cat /tmp/lint-mig-out.txt
fi
rm "$TMP_ROOT/supabase/migrations/20990101000006_real_ddl_with_exists.sql"

echo ""
if [ "$FAIL_COUNT" = "0" ]; then
  echo "All assertions passed."
  exit 0
else
  echo "FAILED: $FAIL_COUNT assertion(s) failed."
  exit 1
fi
