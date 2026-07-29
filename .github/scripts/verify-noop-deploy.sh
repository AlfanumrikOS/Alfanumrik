#!/usr/bin/env bash
# .github/scripts/verify-noop-deploy.sh
#
# Purpose
# -------
# Determines whether a commit currently reported as healthy in production
# (a short git SHA read from /api/v1/health) is CONTENT-IDENTICAL to the
# commit we are trying to release ($TARGET_SHA), even though the two SHAs
# differ literally.
#
# This exists for genuine no-op releases: e.g. GitHub auto-opening and
# auto-merging a second PR for a follow-up push to an already-merged
# branch, producing a brand-new merge commit whose tree is byte-identical
# to what is already live. Vercel's native GitHub App deploy either
# deduplicates that commit (no new deployment) or never repoints the
# production alias (nothing changed to build), so the health endpoint
# keeps reporting the OLD, still-accurate SHA forever — a literal-SHA
# poll never converges even though production is correct and healthy.
#
# Safety contract (do not weaken):
#   1. The reported short SHA MUST resolve to a real commit object. An
#      unresolved/unknown SHA is never treated as equivalent.
#   2. That commit MUST be an actual git ancestor of (or equal to) the
#      target SHA. This is the guard against a stale, wrong, or unrelated
#      SHA being silently accepted as "the same code".
#   3. The tree diff between that ancestor and the target MUST be
#      genuinely empty (git diff --quiet). "Close enough" is not good
#      enough — this only fires on zero code difference.
#
# If any check fails or is ambiguous for any reason, this prints
# "false <reason>" and exits 0. It is a REPORTING script, not a gate —
# the caller decides what to do with the answer, and the caller's
# pre-existing fail-closed behavior is unaffected when this reports
# "false".
#
# Requires: full git history in the working directory (checkout with
# fetch-depth: 0). Run from the repository root.
#
# Usage: verify-noop-deploy.sh <deployed-short-sha> <target-full-sha>
# Output (single line, stdout):
#   "true <deployed-full-sha>"   — verified genuine no-op
#   "false <reason>"             — not verified; caller must not trust it

set -uo pipefail

DEPLOYED_SHORT_SHA="${1:-}"
TARGET_SHA="${2:-}"

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

# (1) The reported SHA must resolve to a real, known commit object.
DEPLOYED_FULL_SHA=$(git rev-parse --verify "${DEPLOYED_SHORT_SHA}^{commit}" 2>/dev/null)
if [ -z "$DEPLOYED_FULL_SHA" ]; then
  fail "unresolved-sha:${DEPLOYED_SHORT_SHA}"
fi

# (2) The reported commit must be a real ancestor of (or equal to) the
#     commit we are releasing. Never trust an unrelated/wrong SHA.
if ! git merge-base --is-ancestor "$DEPLOYED_FULL_SHA" "$TARGET_SHA" 2>/dev/null; then
  fail "not-ancestor:${DEPLOYED_FULL_SHA}"
fi

# (3) The tree diff between the deployed ancestor and the target must be
#     genuinely empty — zero code changes, not merely "similar".
if ! git diff --quiet "$DEPLOYED_FULL_SHA" "$TARGET_SHA" -- 2>/dev/null; then
  fail "non-empty-diff:${DEPLOYED_FULL_SHA}..${TARGET_SHA}"
fi

echo "true ${DEPLOYED_FULL_SHA}"
