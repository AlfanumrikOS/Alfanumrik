#!/usr/bin/env bash
#
# Authoritative migration-history parity check.
#
# Compares the set of COMMITTED migration versions (top-level
# supabase/migrations/*.sql) against the set of versions GENUINELY PRESENT in
# the remote `supabase_migrations.schema_migrations` ledger, read with a direct
# SQL query. Fails loudly, listing the exact offending versions.
#
# ── WHY THIS EXISTS (2026-08-13, P0) ─────────────────────────────────────────
# The previous check parsed the rendered table from `supabase migration list
# --linked` with `awk -F'|' '{ v=$2 }'`. The Supabase CLI emits each row with a
# LEADING pipe (`|local|remote|time|`), so under `-F'|'` the fields are
# $1="" $2=Local $3=Remote $4=Time. Taking $2 read the LOCAL column back out of
# the CLI's own output and called it "remote" — the check compared the local
# migration set against itself and could never fail.
#
# That is not a hypothesis. Across four consecutive production deploys the step
# printed EXACTLY equal counts every time — 580/580, 585/585, 587/587, 588/588 —
# while production's real ledger max was, and remained, 20260814000011 and eight
# committed versions were absent from it. A tautology prints parity forever.
#
# This script never parses rendered CLI output. It SELECTs from the ledger table.
#
# Env:
#   EXPECTED_REF          required — project ref the CLI must be linked to
#   FORBIDDEN_REF         optional — ref that must NOT be targeted (fail-closed)
#   SUPABASE_DB_PASSWORD  required — injected into the URL, never logged
#   ENV_LABEL             optional — human label for messages (default: production)
#   MIGRATIONS_DIR        optional — default: supabase/migrations
#
# Preconditions: `supabase link` has already run in this job (this script reads
# supabase/.temp/project-ref and supabase/.temp/pooler-url), and `psql` is on PATH.
#
# Exit: 0 = parity verified | 1 = drift, unreadable ledger, or broken scan.

set -euo pipefail
export LC_ALL=C

ENV_LABEL="${ENV_LABEL:-production}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase/migrations}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  echo "::error::$*"
  exit 1
}

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    cat >> "$GITHUB_STEP_SUMMARY"
  else
    cat > /dev/null
  fi
}

redact() { printf '****%s' "${1: -4}"; }

[ -n "${EXPECTED_REF:-}" ] || fail "EXPECTED_REF is required. FAIL-CLOSED."
[ -n "${SUPABASE_DB_PASSWORD:-}" ] || fail "SUPABASE_DB_PASSWORD is required. FAIL-CLOSED."
command -v psql >/dev/null 2>&1 || fail "psql is not installed on this runner. FAIL-CLOSED."

# ── 1. Prove WHICH database we are about to interrogate ──────────────────────
# A parity check that does not pin its target can pass against the wrong project.
REF_FILE="supabase/.temp/project-ref"
[ -s "$REF_FILE" ] || fail "$REF_FILE missing/empty — 'supabase link' did not run before this check. FAIL-CLOSED."
LINKED_REF="$(cat "$REF_FILE")"
if [ "$LINKED_REF" != "$EXPECTED_REF" ]; then
  fail "Linked project ref ($(redact "$LINKED_REF")) != expected $ENV_LABEL ref ($(redact "$EXPECTED_REF")). FAIL-CLOSED."
fi
if [ -n "${FORBIDDEN_REF:-}" ] && [ "$LINKED_REF" = "$FORBIDDEN_REF" ]; then
  fail "Linked project ref is the FORBIDDEN ref ($(redact "$FORBIDDEN_REF")). FAIL-CLOSED."
fi
echo "Target: $ENV_LABEL Supabase project $(redact "$LINKED_REF")"

DB_URL="$(python3 "$SCRIPT_DIR/supabase-pooler-url.py")"

# ── 2. REMOTE: the real ledger, straight from the table ──────────────────────
if ! REMOTE_RAW="$(psql "$DB_URL" -X -q -A -t --set=ON_ERROR_STOP=1 \
      -c 'SELECT version FROM supabase_migrations.schema_migrations ORDER BY 1' 2>&1)"; then
  printf '%s\n' "$REMOTE_RAW"
  fail "Could not read supabase_migrations.schema_migrations on $ENV_LABEL — cannot prove database state for this release."
fi
REMOTE_VERSIONS="$(printf '%s\n' "$REMOTE_RAW" | grep -E '^[0-9]{14}$' | sort -u || true)"
REMOTE_ODD="$(printf '%s\n' "$REMOTE_RAW" | sed '/^$/d' | grep -vE '^[0-9]{14}$' | sort -u || true)"

# ── 3. LOCAL: committed, top-level *.sql only ────────────────────────────────
# -maxdepth 1 excludes `_legacy/`, matching both the Supabase CLI's own scope
# and scripts/lint-migrations.js.
LOCAL_VERSIONS="$(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' \
  | sed -nE 's#^([0-9]{14})_.*\.sql$#\1#p' | sort -u)"

LOCAL_COUNT="$(printf '%s\n' "$LOCAL_VERSIONS" | sed '/^$/d' | wc -l)"
REMOTE_COUNT="$(printf '%s\n' "$REMOTE_VERSIONS" | sed '/^$/d' | wc -l)"
echo "Committed migration versions: $LOCAL_COUNT"
echo "Remote ledger versions:       $REMOTE_COUNT"
if [ -n "$REMOTE_ODD" ]; then
  echo "::notice::Remote ledger also holds $(printf '%s\n' "$REMOTE_ODD" | wc -l) non-14-digit version row(s); they are outside the committed-file naming scheme and are not compared."
fi

# ── 4. Non-vacuity: an empty side means a broken scan, not agreement ─────────
[ "$LOCAL_COUNT" -gt 0 ] || fail "Found 0 committed migration versions under $MIGRATIONS_DIR/ — the parity scan is broken, not clean."
[ "$REMOTE_COUNT" -gt 0 ] || fail "Read 0 rows from supabase_migrations.schema_migrations on $ENV_LABEL — the ledger read is broken, not clean."

# ── 5. Compare the two SETS (not two counts: equal counts can hide swaps) ────
COMMITTED_NOT_REMOTE="$(comm -23 <(printf '%s\n' "$LOCAL_VERSIONS" | sed '/^$/d') <(printf '%s\n' "$REMOTE_VERSIONS" | sed '/^$/d'))"
REMOTE_NOT_COMMITTED="$(comm -13 <(printf '%s\n' "$LOCAL_VERSIONS" | sed '/^$/d') <(printf '%s\n' "$REMOTE_VERSIONS" | sed '/^$/d'))"

if [ -n "$COMMITTED_NOT_REMOTE" ] || [ -n "$REMOTE_NOT_COMMITTED" ]; then
  {
    echo ""
    echo "### Migration history parity: DRIFT"
    echo ""
    echo "Target environment: \`$ENV_LABEL\` (linked Supabase project \`$(redact "$LINKED_REF")\`)."
    echo ""
    echo "Source of truth: \`SELECT version FROM supabase_migrations.schema_migrations\`."
    echo ""
  } | summary
  if [ -n "$COMMITTED_NOT_REMOTE" ]; then
    echo "::error::Committed but NOT in the $ENV_LABEL ledger:"
    printf '  %s\n' $COMMITTED_NOT_REMOTE
    {
      echo "**Committed but NOT applied on remote** — this release would ship application code ahead of its schema:"
      echo '```'
      printf '%s\n' "$COMMITTED_NOT_REMOTE"
      echo '```'
      echo "Remediation: re-run this job after fixing whatever blocked the push, or apply the pending versions deliberately with \`supabase db push --linked --include-all\`. Do NOT \`migration repair --status applied\` them unless you have proven the objects exist."
      echo ""
    } | summary
  fi
  if [ -n "$REMOTE_NOT_COMMITTED" ]; then
    echo "::error::In the $ENV_LABEL ledger but NOT committed:"
    printf '  %s\n' $REMOTE_NOT_COMMITTED
    {
      echo "**Applied on remote but NOT committed** — out-of-band drift. This is exactly what aborts \`supabase db push --include-all\`, and surfacing it here is the point of this check:"
      echo '```'
      printf '%s\n' "$REMOTE_NOT_COMMITTED"
      echo '```'
      echo "Remediation: recover each version into a committed, idempotent migration file that reproduces what the operator applied — the same recovery performed for 20260808085345 / 20260808085349 / 20260808085419 (see \`docs/runbooks/production-release-gating.md\`). If a remote row is genuinely bogus, clear it deliberately with \`supabase migration repair --status reverted <version>\`; never hand-edit the ledger."
      echo ""
    } | summary
  fi
  fail "Migration history parity FAILED against $ENV_LABEL — committed migrations and the ledger disagree. See the job summary for the offending versions."
fi

echo "| Migration history parity | verified against $ENV_LABEL ledger ($LOCAL_COUNT committed == $REMOTE_COUNT applied) |" | summary
echo "Migration history parity verified against $ENV_LABEL (SELECTed from supabase_migrations.schema_migrations)."
