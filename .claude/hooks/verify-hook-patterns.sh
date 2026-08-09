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

# ── Byte-level CR detector ───────────────────────────────────
# DO NOT rewrite this as `grep -q $'\r'`. That is what it used to be, and it
# was VACUOUS on the platform this repo is developed on: under Git Bash on
# Windows, grep reads its input in TEXT mode and strips CR before matching,
# so `LC_ALL=C grep -c $'\r' guard.sh` returned 0 while `tr -dc '\r' < guard.sh
# | wc -c` returned 261. Check [1] therefore printed "ok guard.sh (executable,
# LF)" and the whole script self-reported "PASS - 95 checks" while all five
# hooks were CRLF-infected -- the exact condition this file exists to catch.
#
# `tr -dc` over a `<` redirect reads raw bytes and is not defeated by text-mode
# translation. Non-vacuity is proven on every run by the fixture self-test
# below (--self-test), which asserts this function returns >0 on a deliberately
# CRLF-infected fixture and 0 on a clean one.
cr_count_of() { LC_ALL=C tr -dc '\r' < "$1" | wc -c | tr -d '[:space:]'; }

FIXTURE_DIR="$HOOK_DIR/__fixtures__"

# The single-file CRLF gate. Check [1] and the `--check-file` entry point below
# both route through this one function, so the self-test cannot drift away from
# what the real check does.
#   returns 0 = clean (LF only)
#   returns 1 = CR bytes present
crlf_gate() {
  local target="$1" label n
  label="$(basename "$target")"
  n="$(cr_count_of "$target")"
  if [ "${n:-0}" -gt 0 ]; then
    printf '  \033[31mFAIL\033[0m: %s has CR characters (%s CR bytes). The shebang resolves to '\''bash\\r'\'' and the hook cannot execute AT ALL. Convert to LF.\n' "$label" "$n"
    return 1
  fi
  return 0
}

# Standalone single-file gate, so the detector's EXIT CODE can be asserted from
# outside. This is what makes the self-test evidence instead of a self-report:
#   --check-file <crlf file>  -> prints FAIL, exits 1
#   --check-file <lf file>    -> prints ok,   exits 0
if [ "${1:-}" = "--check-file" ]; then
  target="${2:-}"
  if [ -z "$target" ] || [ ! -f "$target" ]; then
    echo "usage: $SELF --check-file <path>" >&2
    exit 2
  fi
  if crlf_gate "$target"; then
    printf '  ok  %s (LF, 0 CR bytes)\n' "$(basename "$target")"
    exit 0
  fi
  exit 1
fi

# Drives the real gate against both fixtures AS SUBPROCESSES and asserts their
# exit codes. Returns non-zero if either direction is wrong, so a detector that
# can no longer fire fails loudly instead of quietly greenlighting a broken tree.
run_detector_selftest() {
  local rc=0 pos="$FIXTURE_DIR/crlf-positive.sh" neg="$FIXTURE_DIR/crlf-negative.sh"
  local out code

  if [ ! -f "$pos" ] || [ ! -f "$neg" ]; then
    printf '  \033[31mFAIL\033[0m: CR detector fixtures missing under %s\n' "$FIXTURE_DIR"
    return 1
  fi

  # POSITIVE: deliberately CRLF-infected -> gate MUST fail with exit 1.
  out="$(bash "$HOOK_DIR/$SELF" --check-file "$pos" 2>&1)"; code=$?
  if [ "$code" -ne 0 ]; then
    printf '  ok    POSITIVE fixture rejected (exit %s) -> detector fires\n' "$code"
    printf '        %s\n' "$out"
  else
    printf '  \033[31mFAIL\033[0m: POSITIVE fixture PASSED the gate (exit 0). The CR detector is VACUOUS.\n'
    printf '        If the fixture lost its CRLF, git normalization ate it: check\n'
    printf '        `git check-attr text -- %s` reports "text: unset".\n' "$pos"
    rc=1
  fi

  # NEGATIVE: clean LF-only -> gate MUST pass with exit 0.
  out="$(bash "$HOOK_DIR/$SELF" --check-file "$neg" 2>&1)"; code=$?
  if [ "$code" -eq 0 ]; then
    printf '  ok    NEGATIVE fixture accepted (exit %s) -> no false positive\n' "$code"
    printf '        %s\n' "$out"
  else
    printf '  \033[31mFAIL\033[0m: NEGATIVE fixture REJECTED (exit %s); it should be LF-only.\n' "$code"
    printf '        %s\n' "$out"
    rc=1
  fi

  return $rc
}

# Standalone entry point: `verify-hook-patterns.sh --self-test`
# Proves the detector both ways without the (slow) full tree scan.
if [ "${1:-}" = "--self-test" ]; then
  echo "=== CR detector self-test (fixtures) ==="
  if run_detector_selftest; then
    printf '\033[32mPASS\033[0m - CR detector fires on CRLF, stays silent on LF.\n'
    exit 0
  fi
  printf '\033[31mFAIL\033[0m - CR detector is not trustworthy; fix before relying on check [1].\n'
  exit 1
fi

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

# Prove the CR detector can still fire BEFORE trusting a single "LF" verdict
# below. A silent detector is worse than no detector: it manufactures
# confidence. If this block fails, every "ok ... (executable, LF)" line that
# follows is worthless.
if ! run_detector_selftest; then
  fail "CR detector failed its own fixture self-test - the LF verdicts below cannot be trusted."
else
  pass
fi

for hook in "$HOOK_DIR"/*.sh; do
  name="$(basename "$hook")"

  if [ ! -x "$hook" ]; then fail "$name is not executable (chmod +x)"; else pass; fi

  # Byte-level, not `grep $'\r'` -- see cr_count_of() for why that was vacuous.
  # Routed through crlf_gate() so this and the fixture self-test are literally
  # the same code path and cannot drift apart.
  if crlf_gate "$hook"; then
    pass
    printf '  ok  %s (executable, LF)\n' "$name"
  else
    FAILURES=$((FAILURES + 1))
  fi
done

# The Python hooks are launched via an explicit interpreter ("python <path>"),
# so CRLF is not immediately fatal for them the way it is for a shebang-execed
# .sh hook. Both are nonetheless mode 100755 with a `#!/usr/bin/env python3`
# shebang, i.e. one invocation-style change away from the same failure. Report,
# do not fail, so this stays an early warning rather than a new gate.
for pyhook in "$HOOK_DIR"/*.py; do
  [ -e "$pyhook" ] || continue
  pyname="$(basename "$pyhook")"
  pycr="$(cr_count_of "$pyhook")"
  if [ "${pycr:-0}" -gt 0 ]; then
    printf '  \033[33mWARN\033[0m: %s has %s CR bytes (not fatal today - invoked as "python <path>" - but it carries a python3 shebang and mode 755).\n' "$pyname" "$pycr"
  else
    printf '  ok  %s (LF)\n' "$pyname"
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
# (P2-3 Phase 2: source re-export stubs deleted; repointed to canonical —
# guard.sh's OR-pattern ^(packages/lib/src|apps/host/src/lib)/(xp-rules|rbac)\.ts$
# still matches the canonical half, so the deny-behavior assertion still holds.)
replay_guard frontend   packages/lib/src/xp-rules.ts      deny  "P2 stub XP"
replay_guard frontend   packages/lib/src/rbac.ts          deny  "P9 stub RBAC"

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
replay_bash frontend "sed -i s/x/y/ packages/lib/src/xp-rules.ts"   deny  "bash bypass stub XP"
replay_bash frontend "sed -i s/x/y/ apps/host/src/proxy.ts"         deny  "bash bypass middleware"
replay_bash frontend "cat README.md"                                allow "benign command not blocked"
echo

# ── bash-guard positional-matching suite ────────────────
# The checks above prove patterns can FIRE. This suite proves the
# bash guard fires on the right thing: that it distinguishes a write
# TARGET from a path merely mentioned in the command (a commit
# message, a copy source, an fd-duplication), and that an interpreter
# heredoc can no longer bypass it entirely.
echo "=== bash-guard positional matching ==="
if command -v python3 >/dev/null 2>&1; then
  if python3 "$(dirname "$0")/verify-bash-guard.py"; then
    CHECKS=$((CHECKS + 16))
  else
    FAILURES=$((FAILURES + 1))
  fi
else
  echo "  SKIP - python3 unavailable"
fi
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
