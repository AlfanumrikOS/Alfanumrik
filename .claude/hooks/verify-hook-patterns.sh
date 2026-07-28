#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Alfanumrik Hook Pattern Self-Test
#
# WHY THIS EXISTS
# The monorepo migration moved `src/` to `apps/host/src/` and
# `packages/{lib,ui}/src/`. Nothing re-pointed the enforcement hooks, so
# 17 of 34 ownership / review-chain path patterns silently became
# structurally unmatchable — they still LOOKED authoritative but could
# never fire. P14 (review chain completeness) was unenforced for XP /
# scoring constants, payment code, RBAC/auth, the RLS-bypassing admin
# client, and the entire super-admin surface.
#
# Separately, all four hooks carried CRLF line endings, so every one of
# them died with `/usr/bin/env: 'bash\r': No such file or directory`
# before evaluating a single rule. Real enforcement was 0 of 34.
#
# Both failures were silent: a hook that matches nothing is
# indistinguishable from a hook that has nothing to match yet.
#
# WHAT THIS DOES
#   [1] Asserts every hook is executable and LF-terminated.
#   [2] Extracts every path pattern from the hook sources and asserts
#       each matches >= 1 real tracked file.
#   [3] Replays representative real file paths through the LIVE hooks
#       and asserts the expected decision. A pattern can match a file
#       and still be wired wrong; only a replay proves it fires.
#
# USAGE
#   .claude/hooks/verify-hook-patterns.sh
#   exit 0 = all patterns live, exit 1 = at least one is dead
#
# Run after ANY hook pattern edit, and after any directory move.
# ─────────────────────────────────────────────────────────────

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SELF="$(basename "${BASH_SOURCE[0]}")"
cd "$REPO_ROOT" || exit 1

FAILURES=0
CHECKS=0
VERBOSE="${VERBOSE:-0}"

fail() { printf '  \033[31mFAIL\033[0m: %s\n' "$*"; FAILURES=$((FAILURES + 1)); }
pass() { CHECKS=$((CHECKS + 1)); }
note() { [ "$VERBOSE" = "1" ] && printf '%s\n' "$*"; return 0; }

# Authoritative file universe: tracked files only. Untracked build output
# must never be what keeps a pattern alive.
FILE_LIST="$(mktemp)"
trap 'rm -f "$FILE_LIST"' EXIT
git ls-files > "$FILE_LIST"

echo "=== Alfanumrik hook pattern self-test ==="
echo "Repo root:     $REPO_ROOT"
echo "Tracked files: $(wc -l < "$FILE_LIST" | tr -d ' ')"
echo

# ── [1] Executability and line endings ───────────────────────
echo "--- [1] Hook executability and line endings ---"
for hook in "$HOOK_DIR"/*.sh; do
  name="$(basename "$hook")"
  [ "$name" = "$SELF" ] && continue

  if [ ! -x "$hook" ]; then fail "$name is not executable (chmod +x)"; else pass; fi

  if LC_ALL=C grep -q $'\r' "$hook"; then
    fail "$name has CR characters. The shebang resolves to 'bash\\r' and the hook cannot execute AT ALL. Convert to LF."
  else
    pass
    printf '  ok  %s (executable, LF)\n' "$name"
  fi
done
echo

# ── [2] Pattern liveness ─────────────────────────────────────
# Patterns are extracted mechanically from the hook sources, so a newly
# added rule is covered automatically without editing this file.
echo "--- [2] Path pattern liveness (each must match >= 1 tracked file) ---"

extract_patterns() {
  # guard.sh: check_rule \  <newline>  "<pattern>" \
  awk '
    /check_rule[[:space:]]*\\[[:space:]]*$/ { want=1; next }
    want==1 { if (match($0, /"[^"]+"/)) { print substr($0, RSTART+1, RLENGTH-2) } want=0 }
  ' "$HOOK_DIR/guard.sh"

  # review-chain.sh: grep -qE "<pattern>"
  grep -oE 'grep -qE "\^[^"]+"' "$HOOK_DIR/review-chain.sh" \
    | sed -E 's/^grep -qE "//; s/"$//'
}

PATTERN_COUNT=0
DEAD_COUNT=0
while IFS= read -r pat; do
  [ -z "$pat" ] && continue
  PATTERN_COUNT=$((PATTERN_COUNT + 1))
  # Hook sources embed patterns in double quotes: `\\.` in source is `\.` at runtime.
  runtime_pat="${pat//\\\\./\\.}"
  n=$(grep -cE "$runtime_pat" "$FILE_LIST" 2>/dev/null || true)
  n="${n:-0}"
  if [ "$n" -eq 0 ]; then
    fail "DEAD PATTERN — matches 0 tracked files: $runtime_pat"
    DEAD_COUNT=$((DEAD_COUNT + 1))
  else
    example=$(grep -E "$runtime_pat" "$FILE_LIST" 2>/dev/null | head -1)
    printf '  ok  %-7s %s\n' "($n)" "$runtime_pat"
    printf '              e.g. %s\n' "$example"
    pass
  fi
done < <(extract_patterns)
printf '  patterns extracted: %s | dead: %s\n' "$PATTERN_COUNT" "$DEAD_COUNT"
echo

# ── [3] Behavioural replay through the live hooks ────────────
echo "--- [3] Behavioural replay (real paths through live hooks) ---"

replay_guard() {
  local agent="$1" path="$2" expect="$3" label="$4" out got
  if [ ! -e "$path" ]; then fail "$label — fixture path does not exist: $path"; return; fi
  out=$(printf '{"agent_type":"%s","tool_input":{"file_path":"%s"}}' "$agent" "$path" \
        | "$HOOK_DIR/guard.sh" 2>&1)
  got="allow"
  echo "$out" | grep -q 'additionalContext'            && got="warn"
  echo "$out" | grep -q '"permissionDecision": "deny"' && got="deny"
  if [ "$got" != "$expect" ]; then
    fail "$label — guard.sh gave '$got', expected '$expect' ($agent -> $path)"
  else
    printf '  ok  guard  %-11s %-6s %s\n' "$agent" "$expect" "$path"; pass
  fi
}

replay_chain() {
  local agent="$1" path="$2" label="$3" out
  if [ ! -e "$path" ]; then fail "$label — fixture path does not exist: $path"; return; fi
  out=$(printf '{"agent_type":"%s","tool_input":{"file_path":"%s"}}' "$agent" "$path" \
        | "$HOOK_DIR/review-chain.sh" 2>&1)
  if ! echo "$out" | grep -q "REVIEW CHAIN REQUIRED"; then
    fail "$label — review-chain.sh emitted NO reminder for $path (P14 unenforced)"
  else
    printf '  ok  chain  %-11s %s\n' "$agent" "$path"; pass
  fi
}

replay_bash() {
  local agent="$1" cmd="$2" expect="$3" label="$4" out got="allow"
  out=$(printf '{"agent_type":"%s","tool_input":{"command":"%s"}}' "$agent" "$cmd" \
        | "$HOOK_DIR/bash-guard.sh" 2>&1)
  echo "$out" | grep -q '"permissionDecision": "deny"' && got="deny"
  if [ "$got" != "$expect" ]; then
    fail "$label — bash-guard.sh gave '$got', expected '$expect' for: $cmd"
  else
    printf '  ok  bash   %-11s %-6s %s\n' "$agent" "$expect" "$cmd"; pass
  fi
}

# Canonical implementations under packages/ — the files that actually matter.
replay_guard frontend   packages/lib/src/xp-rules.ts       deny  "P2 canonical XP"
replay_guard frontend   packages/lib/src/rbac.ts           deny  "P9 canonical RBAC"
replay_guard frontend   packages/lib/src/admin-auth.ts     deny  "P9 canonical admin-auth"
replay_guard frontend   packages/lib/src/razorpay.ts       deny  "P11 canonical payments"
replay_guard frontend   packages/lib/src/cognitive-engine.ts deny "P1-P4 canonical cognitive engine"
replay_guard backend    packages/lib/src/supabase-admin.ts warn  "P8 canonical admin client (backend warned)"
replay_guard assessment packages/lib/src/xp-rules.ts       allow "P2 owner may write"

# Generated stubs under apps/host/src/lib — editing one is itself suspicious.
replay_guard frontend   apps/host/src/lib/xp-rules.ts      deny  "P2 stub XP"
replay_guard frontend   apps/host/src/lib/rbac.ts          deny  "P9 stub RBAC"

# App surfaces.
replay_guard frontend   apps/host/src/proxy.ts             deny  "middleware perimeter"
replay_guard backend    apps/host/src/app/api/payments/webhook/route.ts allow "payments owner"
replay_guard frontend   apps/host/src/app/api/payments/webhook/route.ts deny  "payments non-owner"
replay_guard ops        apps/host/src/app/api/super-admin/stats/route.ts warn "super-admin API ops review"
replay_guard ops        apps/host/src/app/super-admin/page.tsx warn "super-admin page ops review"
replay_guard frontend   .github/workflows/ci.yml           deny  "CI workflow"
replay_guard frontend   apps/host/next.config.js           deny  "next.config lives at apps/host"

# Review-chain reminders must fire on the canonical files (P14).
replay_chain assessment  packages/lib/src/xp-rules.ts        "P14 XP chain"
replay_chain assessment  packages/lib/src/exam-engine.ts     "P14 exam chain"
replay_chain assessment  packages/lib/src/cognitive-engine.ts "P14 cognitive chain"
replay_chain assessment  packages/lib/src/feedback-engine.ts "P14 feedback chain"
replay_chain architect   packages/lib/src/rbac.ts            "P14 RBAC chain"
replay_chain architect   apps/host/src/proxy.ts              "P14 middleware chain"
replay_chain backend     packages/lib/src/razorpay.ts        "P14 payment chain"
replay_chain backend     apps/host/src/app/api/payments/webhook/route.ts "P14 payment route chain"
replay_chain backend     apps/host/src/app/api/super-admin/stats/route.ts "P14 reporting chain"
replay_chain backend     apps/host/src/app/api/super-admin/cms/route.ts   "P14 CMS chain"
replay_chain backend     apps/host/src/app/api/super-admin/users/route.ts "P14 admin user chain"
replay_chain ops         apps/host/src/app/api/super-admin/feature-flags/route.ts "P14 flag chain"
replay_chain frontend    apps/host/src/app/super-admin/page.tsx "P14 super-admin page chain"
replay_chain ai-engineer apps/host/src/app/api/foxy/route.ts "P14 Foxy chain"
replay_chain architect   .github/workflows/ci.yml            "P14 deploy config chain"

# Bash bypass must be blocked on the CANONICAL path, not just the stub.
replay_bash frontend "sed -i s/10/99/ packages/lib/src/xp-rules.ts" deny  "bash bypass canonical XP"
replay_bash frontend "sed -i s/x/y/ packages/lib/src/rbac.ts"       deny  "bash bypass canonical RBAC"
replay_bash frontend "sed -i s/x/y/ apps/host/src/lib/xp-rules.ts"  deny  "bash bypass stub XP"
replay_bash frontend "sed -i s/x/y/ apps/host/src/proxy.ts"         deny  "bash bypass middleware"
replay_bash frontend "cat README.md"                                allow "benign command not blocked"
echo

# ── Summary ──────────────────────────────────────────────────
echo "=== Summary ==="
if [ "$FAILURES" -eq 0 ]; then
  printf '\033[32mPASS\033[0m — %s checks, 0 dead patterns.\n' "$CHECKS"
  exit 0
fi
printf '\033[31mFAIL\033[0m — %s failure(s) across %s checks.\n' "$FAILURES" "$((CHECKS + FAILURES))"
echo
echo "A dead pattern means the rule LOOKS enforced but can never fire."
echo "Repair it against the real tree, then re-run this script."
exit 1
