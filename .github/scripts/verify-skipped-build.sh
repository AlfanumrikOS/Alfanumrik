#!/usr/bin/env bash
# .github/scripts/verify-skipped-build.sh
#
# Purpose
# -------
# Answers ONE question for the post-deploy health check:
#
#   Production is healthy but reporting an OLDER sha than the one we just
#   pushed. Is that because Vercel DELIBERATELY skipped the build for this
#   commit — or because a real deploy is missing?
#
# apps/host/vercel.json sets "ignoreCommand": "node scripts/ignore-build.cjs".
# When a commit touches only ignored prefixes (docs/, .claude/, .github/,
# mobile/, ...) Vercel correctly builds NOTHING and the production alias keeps
# pointing at the previous deployment. The health check's exact-SHA assertion
# is then unsatisfiable BY DESIGN: it polled for 10 minutes and failed. Commit
# b5bcd8277 (docs-only) failed `Deploy Production` for exactly this reason.
#
# This script does NOT re-implement the ignore rules. It INVOKES
# apps/host/scripts/ignore-build.cjs — the same file Vercel runs — so the
# prefix list has exactly one copy and cannot drift.
#
# Safety contract (do not weaken):
#   1. The sha production reports MUST resolve to a real commit object. An
#      unresolved/unknown sha is never accepted.
#   2. That commit MUST be a real git ancestor of (or equal to) the commit we
#      are releasing. A stale, unrelated or forward sha is never accepted.
#   3. The diff across the WHOLE range <deployed>..<target> — not just
#      HEAD^..HEAD — must contain zero deployable files. This is deliberately
#      stricter than the per-commit question Vercel asks: if any commit in the
#      gap carried application code, production is genuinely behind and this
#      reports false, keeping the caller's fail-closed behavior.
#
# What this does NOT relax: production liveness. The caller still requires a
# 200 + semantically healthy /api/v1/health before it ever consults this
# script. Only the exact-SHA assertion is answered here.
#
# Like verify-noop-deploy.sh this is a REPORTING script, not a gate: on any
# failure or ambiguity it prints "false <reason>" and exits 0, and the caller's
# pre-existing fail-closed path is untouched.
#
# Requires: full git history (checkout with fetch-depth: 0). Run from the
# repository root.
#
# Usage: verify-skipped-build.sh <deployed-short-sha> <target-full-sha>
# Output (single line, stdout):
#   "true <deployed-full-sha>"   — verified: no deployable change in the gap
#   "false <reason>"             — not verified; caller must not trust it

set -uo pipefail

DEPLOYED_SHORT_SHA="${1:-}"
TARGET_SHA="${2:-}"
IGNORE_BUILD_SCRIPT="apps/host/scripts/ignore-build.cjs"

fail() {
  echo "false $1"
  exit 0
}

if [ -z "$DEPLOYED_SHORT_SHA" ] || [ -z "$TARGET_SHA" ]; then
  fail "missing-args"
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "not-a-git-worktree"
fi

# The ignore rules must come from the file Vercel actually runs. If it is
# missing or was moved, report false rather than guessing at the prefix list.
if [ ! -f "$IGNORE_BUILD_SCRIPT" ]; then
  fail "missing-ignore-build-script:${IGNORE_BUILD_SCRIPT}"
fi

# (1) The reported sha must resolve to a real, known commit object.
DEPLOYED_FULL_SHA=$(git rev-parse --verify "${DEPLOYED_SHORT_SHA}^{commit}" 2>/dev/null)
if [ -z "$DEPLOYED_FULL_SHA" ]; then
  fail "unresolved-sha:${DEPLOYED_SHORT_SHA}"
fi

# (2) It must be a real ancestor of (or equal to) what we are releasing.
if ! git merge-base --is-ancestor "$DEPLOYED_FULL_SHA" "$TARGET_SHA" 2>/dev/null; then
  fail "not-ancestor:${DEPLOYED_FULL_SHA}"
fi

# (3) Delegate the "is anything here deployable?" question to Vercel's own
#     ignoreCommand, over the whole gap. Its contract is Vercel's:
#       exit 0 = SKIP the build (nothing deployable changed)
#       exit 1 = BUILD (a deployable file changed)
if node "$IGNORE_BUILD_SCRIPT" "$DEPLOYED_FULL_SHA" "$TARGET_SHA" >/dev/null 2>&1; then
  echo "true ${DEPLOYED_FULL_SHA}"
  exit 0
fi

fail "has-deployable-change:${DEPLOYED_FULL_SHA}..${TARGET_SHA}"
