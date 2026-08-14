#!/usr/bin/env bash
#
# Post-deploy BEHAVIOURAL assertion against the live database.
#
# ── WHY THIS EXISTS (2026-08-13, P0) ─────────────────────────────────────────
# Every database gate in the deploy pipeline verified LEDGER METADATA — "does
# the migration row exist?" — and never once verified OBSERVABLE EFFECT. So when
# `supabase db push` printed "Applying migration …" / "Finished supabase db
# push." and exited 0 while the objects never appeared in production, the whole
# pipeline reported green and a P0 security fix was declared shipped while being
# entirely absent from production.
#
# This script asserts EFFECT, not paperwork. It is deliberately small and
# generic: a short list of invariants that must hold on the live database after
# a release, each of which fails the deploy loudly and specifically.
#
# ── INVARIANT 1: anon cannot EXECUTE the student-data SECURITY DEFINER RPCs ──
# These RPCs run with the definer's privileges and return student-identifiable
# rows. If `anon` (the role the public anon key maps to) holds EXECUTE — whether
# granted directly, via a role it is a member of, or via PUBLIC — anyone with the
# publishable anon key can call them. PostgreSQL evaluates exactly
# `has_function_privilege(role, oid, 'EXECUTE')` before invoking a function:
# false ⟹ the call is rejected with SQLSTATE 42501 (insufficient_privilege).
# Asserting the predicate is therefore equivalent to asserting the 42501, and —
# unlike actually invoking them — carries zero risk of side effects on live
# production data and needs no synthetic student to pass valid arguments.
#
# Non-vacuity: if a listed RPC is not present at all, that is a FAILURE, not a
# pass. A gate that silently asserts nothing about a function that vanished is
# the exact failure mode this file exists to end. Removing an RPC from
# production must be accompanied by a deliberate edit to the list below.
#
# Env:
#   EXPECTED_REF          required — project ref the CLI must be linked to
#   FORBIDDEN_REF         optional — ref that must NOT be targeted (fail-closed)
#   SUPABASE_DB_PASSWORD  required — injected into the URL, never logged
#   ENV_LABEL             optional — human label for messages (default: production)
#
# Preconditions: `supabase link` has already run in this job; `psql` is on PATH.
#
# Exit: 0 = all invariants hold | 1 = violation, or the assertion could not run.

set -euo pipefail
export LC_ALL=C

ENV_LABEL="${ENV_LABEL:-production}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Student-data SECURITY DEFINER RPCs. Keep in sync with the SECDEF-guard
# migrations; adding one here is cheap, removing one requires justification.
SECDEF_RPCS=(
  get_student_snapshot
  get_student_notifications
  get_review_cards
  get_guardian_dashboard
  get_dashboard_data
  get_study_plan
  get_knowledge_gaps
)

fail() {
  echo "::error::$*"
  exit 1
}

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat >> "$GITHUB_STEP_SUMMARY"; else cat > /dev/null; fi
}

redact() { printf '****%s' "${1: -4}"; }

[ -n "${EXPECTED_REF:-}" ] || fail "EXPECTED_REF is required. FAIL-CLOSED."
[ -n "${SUPABASE_DB_PASSWORD:-}" ] || fail "SUPABASE_DB_PASSWORD is required. FAIL-CLOSED."
command -v psql >/dev/null 2>&1 || fail "psql is not installed on this runner. FAIL-CLOSED."

REF_FILE="supabase/.temp/project-ref"
[ -s "$REF_FILE" ] || fail "$REF_FILE missing/empty — 'supabase link' did not run before this check. FAIL-CLOSED."
LINKED_REF="$(cat "$REF_FILE")"
[ "$LINKED_REF" = "$EXPECTED_REF" ] \
  || fail "Linked project ref ($(redact "$LINKED_REF")) != expected $ENV_LABEL ref ($(redact "$EXPECTED_REF")). FAIL-CLOSED."
if [ -n "${FORBIDDEN_REF:-}" ] && [ "$LINKED_REF" = "$FORBIDDEN_REF" ]; then
  fail "Linked project ref is the FORBIDDEN ref ($(redact "$FORBIDDEN_REF")). FAIL-CLOSED."
fi

DB_URL="$(python3 "$SCRIPT_DIR/supabase-pooler-url.py")"

# SQL list literals, built from the fixed array above (no external input, so no
# injection surface): RPC_LIST for `IN (...)`, RPC_VALUES for `VALUES ...`.
RPC_LIST=""
RPC_VALUES=""
for fn in "${SECDEF_RPCS[@]}"; do
  RPC_LIST="${RPC_LIST:+$RPC_LIST, }'$fn'"
  RPC_VALUES="${RPC_VALUES:+$RPC_VALUES, }('$fn')"
done

run_sql() {
  psql "$DB_URL" -X -q -A -t --set=ON_ERROR_STOP=1 -c "$1"
}

echo "Asserting live-database security invariants on $ENV_LABEL ($(redact "$LINKED_REF"))…"

# 0. The 'anon' role must exist, otherwise has_function_privilege() below would
#    error out and we would learn nothing.
if ! ANON_PRESENT="$(run_sql "SELECT count(*) FROM pg_roles WHERE rolname = 'anon'" 2>&1)"; then
  printf '%s\n' "$ANON_PRESENT"
  fail "Could not query pg_roles on $ENV_LABEL — the security-invariant assertion could not run. FAIL-CLOSED."
fi
[ "$ANON_PRESENT" = "1" ] \
  || fail "Role 'anon' not found on $ENV_LABEL — cannot assert anon privileges. FAIL-CLOSED."

# 1a. Every listed RPC must exist (non-vacuity).
if ! MISSING="$(run_sql "
  SELECT t.fname
  FROM (VALUES $RPC_VALUES) AS t(fname)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = t.fname
  )
  ORDER BY 1" 2>&1)"; then
  printf '%s\n' "$MISSING"
  fail "Could not enumerate SECURITY DEFINER RPCs on $ENV_LABEL. FAIL-CLOSED."
fi
if [ -n "$MISSING" ]; then
  echo "::error::Listed student-data RPC(s) absent from $ENV_LABEL — this assertion would have been vacuous:"
  printf '  %s\n' $MISSING
  fail "Security-invariant list is out of sync with $ENV_LABEL. Either the release failed to apply, or the RPC was removed deliberately (then update SECDEF_RPCS in $(basename "${BASH_SOURCE[0]}"))."
fi

# 1b. None of their overloads may be EXECUTE-able by anon.
if ! VIOLATIONS="$(run_sql "
  SELECT p.oid::regprocedure::text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ($RPC_LIST)
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ORDER BY 1" 2>&1)"; then
  printf '%s\n' "$VIOLATIONS"
  fail "Could not evaluate anon EXECUTE privileges on $ENV_LABEL. FAIL-CLOSED."
fi

CHECKED="$(run_sql "
  SELECT count(*)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ($RPC_LIST)")"

if [ -n "$VIOLATIONS" ]; then
  echo "::error::anon CAN execute student-data SECURITY DEFINER RPC(s) on $ENV_LABEL — anyone holding the public anon key can read student data:"
  printf '  %s\n' $VIOLATIONS
  {
    echo ""
    echo "### Live-database security invariant: VIOLATED"
    echo ""
    echo "Target environment: \`$ENV_LABEL\` (project \`$(redact "$LINKED_REF")\`)."
    echo ""
    echo "\`anon\` holds EXECUTE on these student-data SECURITY DEFINER functions, so they do NOT return SQLSTATE 42501 to the public anon key:"
    echo '```'
    printf '%s\n' "$VIOLATIONS"
    echo '```'
    echo "Remediation: ship an idempotent migration that runs \`REVOKE EXECUTE ON FUNCTION <sig> FROM anon, PUBLIC;\` for each signature, then re-run this deploy. Do not disable this check."
    echo ""
  } | summary
  fail "Live-database security invariant VIOLATED on $ENV_LABEL."
fi

echo "anon has no EXECUTE on any of the $CHECKED overload(s) of ${#SECDEF_RPCS[@]} student-data SECDEF RPC(s) — each returns SQLSTATE 42501 to the anon key."
echo "| Live DB security invariant | verified on $ENV_LABEL (anon EXECUTE denied on $CHECKED SECDEF overload(s)) |" | summary
