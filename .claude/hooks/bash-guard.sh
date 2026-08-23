#!/usr/bin/env bash
# -------------------------------------------------------------
# Alfanumrik Bash Command Guard
#
# PreToolUse hook for Bash tool.
# Blocks subagents from using shell commands to bypass the
# Edit/Write file-path protections (in-place sed, awk, redirects,
# tee, cp/mv). Also blocks secret exposure and destructive ops.
#
# Protocol:
#   stdin  -> JSON with tool_name, tool_input.command, agent_type
#   stdout -> JSON with permissionDecision
#   exit 0 always
#
# == 2026-07-28 REWRITE: positional matching =================
# The previous version asked two INDEPENDENT questions of the whole
# command string: "does it contain a write verb?" and "does it
# contain a protected path?". The two never had to refer to the
# same thing. That produced four false positives and one total
# bypass, all observed in a single session:
#
#   FP  a git commit whose MESSAGE quoted an in-place sed command
#       against a protected file, as prose describing a bug.
#       -> blocked. The words were documentation, not a command.
#   FP  a command listing files under the migrations directory,
#       where an earlier unrelated 2>&1 supplied the ">".
#       -> blocked. A file-descriptor duplication is not a write.
#   FP  copying FROM a protected path into /tmp.
#       -> blocked. A copy source is a READ; only the destination
#          operand can be a write.
#   FP  this file's own replacement, via the secret rule, because
#       a detector must CONTAIN the secret names it detects.
#   BYPASS  an interpreter heredoc (python3 - <<EOF ... EOF) that
#       wrote directly to an agent-system file.
#       -> ALLOWED. No shell write verb appeared, so the guard
#          never looked. This defeated every rule below.
#
# Net effect: the guard obstructed safe operations while permitting
# the unsafe one. This version extracts actual WRITE TARGETS and
# matches protected patterns only against those.
#
# Self-test: .claude/hooks/verify-hook-patterns.sh
# -------------------------------------------------------------

set -euo pipefail

INPUT=$(cat)

# This hook runs before every single Bash tool call, so a missing local
# dependency must degrade gracefully with one clear message instead of
# crashing every invocation under `set -e`. Fail open (exit 0, no stdout)
# rather than emit hand-built JSON, since jq itself is what's unavailable.
if ! command -v jq >/dev/null 2>&1; then
  echo "bash-guard.sh: jq not found, skipping checks — install it: winget install jqlang.jq | choco install jq | scoop install jq | brew install jq | apt install jq" >&2
  exit 0
fi

AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# No agent = user driving -> allow
if [ -z "$AGENT_TYPE" ]; then
  exit 0
fi

# No command -> allow
if [ -z "$COMMAND" ]; then
  exit 0
fi

DECISION="allow"
REASON=""
CONTEXT=""

# == Protected path patterns ==================================
#
# MONOREPO NOTE: both prefixes are covered deliberately. Before the
# 2026-07 repair these read src/lib/(...), which matched ONLY the
# auto-generated re-export stubs under the app dir and never the
# CANONICAL implementations in the lib package -- i.e. the file that
# actually matters was writable in place. The middleware entry was
# also dead: the file is now proxy.ts (Next.js 16).

PROT_CORE='supabase/migrations|(packages/lib/src|apps/host/src/lib)/(rbac|admin-auth|xp-rules|exam-engine|cognitive-engine|feedback-engine|razorpay|supabase-admin|supabase-server)|apps/host/src/proxy\.ts'
PROT_AI='supabase/functions/(ncert-solver|quiz-generator|cme-engine)|apps/host/src/app/api/foxy/'
PROT_AGENT='\.claude/(agents|skills|hooks|CLAUDE)'
PROT_DEPLOY='vercel\.json|\.github/workflows|next\.config'

SECRET_NAMES='SUPABASE_SERVICE_ROLE|RAZORPAY_KEY_SECRET|SUPER_ADMIN_SECRET'

# == Write-target extraction ==================================
# Emits one candidate write target per line. Over-emitting is safe
# (a non-protected target simply never matches a PROT_ pattern);
# under-emitting is not, so ambiguous tokens are emitted, not
# dropped.

extract_write_targets() {
  printf '%s\n' "$1" | awk '
    # Pass 1: strip heredoc BODIES, keeping the command prefix that
    # introduced them. A heredoc body is data, not a command line.
    BEGIN { inhd = 0; term = "" }
    {
      line = $0
      if (inhd) {
        s = line; sub(/^[ \t]*/, "", s); sub(/[ \t]*$/, "", s)
        if (s == term) inhd = 0
        next
      }
      if (match(line, /<<-?[ \t]*("[^"]+"|\047[^\047]+\047|[A-Za-z_][A-Za-z0-9_]*)/)) {
        t = substr(line, RSTART, RLENGTH)
        sub(/^<<-?[ \t]*/, "", t)
        gsub(/["\047]/, "", t)
        term = t; inhd = 1
        line = substr(line, 1, RSTART - 1)
      }
      print line
    }
  ' | awk '
    # Pass 2: normalise redirections.
    {
      l = $0
      gsub(/[0-9]*>&[0-9-]+/, " ",     l)   # 2>&1 1>&2 >&-  : fd dup, NOT a file write
      gsub(/&>>?/,            " @R@ ", l)   # &> &>>         : does write a file
      gsub(/[0-9]*>>?/,       " @R@ ", l)   # > >> 2> 2>>    : does write a file
      print l
    }
  ' | awk '
    # Pass 3: per segment, emit write targets only.
    {
      n = split($0, seg, /[;&|]+/)
      for (i = 1; i <= n; i++) {
        m = split(seg[i], tok, /[ \t]+/)
        cw = ""
        for (j = 1; j <= m; j++) if (tok[j] != "") { cw = tok[j]; break }
        sub(/^.*\//, "", cw)

        inplace = 0
        if (cw ~ /^(tee|truncate|dd|shred)$/) inplace = 1
        if (cw ~ /^(sed|perl)$/ && seg[i] ~ /(^|[ \t])-[a-zA-Z]*i/) inplace = 1

        # cp/mv/install/rsync/ln: ONLY the final operand is written.
        if (cw ~ /^(cp|mv|install|rsync|ln)$/) {
          for (j = m; j >= 1; j--)
            if (tok[j] != "" && tok[j] !~ /^-/) { print tok[j]; break }
        }

        for (j = 1; j <= m; j++) {
          if (tok[j] == "@R@") {
            k = j + 1
            while (k <= m && tok[k] == "") k++
            if (k <= m && tok[k] != "@R@") print tok[k]
          } else if (inplace && tok[j] != "" && tok[j] !~ /^-/ && tok[j] != cw && tok[j] != "@R@") {
            print tok[j]
          }
        }
      }
    }
  '
}

TARGETS=$(extract_write_targets "$COMMAND" || true)

# Heredoc-stripped command, for rules that must scan the whole line
# but must not read heredoc BODIES as if they were commands. A
# commit message describing a destructive command is documentation.
STRIPPED=$(printf %s\\n "$COMMAND" | awk '
  BEGIN { inhd = 0; term = "" }
  {
    line = $0
    if (inhd) {
      s = line; sub(/^[ \t]*/, "", s); sub(/[ \t]*$/, "", s)
      if (s == term) inhd = 0
      next
    }
    if (match(line, /<<-?[ \t]*("[^"]+"|\047[^\047]+\047|[A-Za-z_][A-Za-z0-9_]*)/)) {
      t = substr(line, RSTART, RLENGTH)
      sub(/^<<-?[ \t]*/, "", t); gsub(/["\047]/, "", t)
      term = t; inhd = 1
      line = substr(line, 1, RSTART - 1)
    }
    print line
  }' || true)

# == Interpreter heredocs: conservative whole-command scan ====
# An interpreter heredoc can write anywhere, and its body is not
# shell, so it cannot be parsed for targets. Until 2026-07-28 this
# was a complete bypass of every rule above. Treat a protected path
# appearing ANYWHERE in such a command as a write.
INTERP=""
if echo "$COMMAND" | grep -qE '(^|[ \t;&|])(python3?|node|perl|ruby|deno|bun)([ \t]|$)' \
   && echo "$COMMAND" | grep -q '<<'; then
  INTERP="$COMMAND"
fi

matches() {  # $1 = pattern; true if any write target (or interpreter body) matches
  if [ -n "$TARGETS" ] && printf '%s\n' "$TARGETS" | grep -qE "$1"; then return 0; fi
  if [ -n "$INTERP" ] && printf '%s\n' "$INTERP" | grep -qE "$1"; then return 0; fi
  return 1
}

# == BLOCKING: file modification via Bash on protected paths ==

if matches "$PROT_CORE"; then
  DECISION="deny"
  REASON="BLOCKED: $AGENT_TYPE attempted to modify a protected file via Bash. Use Edit/Write tools instead - they are subject to ownership checks."
fi

if [ "$DECISION" = "allow" ] && matches "$PROT_AI"; then
  DECISION="deny"
  REASON="BLOCKED: $AGENT_TYPE attempted to modify a protected AI surface via Bash. Use Edit/Write tools instead."
fi

# Agent-system files are orchestrator-owned (guard.sh Rule 8). The
# orchestrator has only Bash - no Edit/Write tool - so denying it
# here as well would leave these files editable by nobody at all.
# Mirror guard.sh's ownership rather than being stricter than it.
if [ "$DECISION" = "allow" ] && [ "$AGENT_TYPE" != "orchestrator" ] && matches "$PROT_AGENT"; then
  DECISION="deny"
  REASON="BLOCKED: $AGENT_TYPE attempted to modify agent system files via Bash. These are orchestrator-owned."
fi

if [ "$DECISION" = "allow" ] && matches "$PROT_DEPLOY"; then
  DECISION="deny"
  REASON="BLOCKED: $AGENT_TYPE attempted to modify deployment config via Bash. Use Edit/Write tools instead."
fi

# == BLOCKING: destructive git operations =====================

if echo "$STRIPPED" | grep -qE "git\s+(push\s+--force|push\s+-f|reset\s+--hard|clean\s+-f|checkout\s+\.\s|restore\s+\.)"; then
  DECISION="deny"
  REASON="BLOCKED: Destructive git operation. This requires explicit user approval."
fi

# == BLOCKING: secret exposure ================================
# Value-aware, not name-aware. The old rule fired whenever a secret
# NAME and any of (echo|printf|cat|export|>>|>) both appeared, which
# blocked existence checks, greps, and this very file. What matters
# is dereferencing the variable into output or into a file.

if echo "$COMMAND" | grep -qE "(echo|printf|cat)[^;&|]*\\\$\{?($SECRET_NAMES)"; then
  DECISION="deny"
  REASON="BLOCKED: Command may print a secret VALUE. Use an existence check instead."
fi

if echo "$COMMAND" | grep -qE "\\\$\{?($SECRET_NAMES)" \
   && [ -n "$TARGETS" ] \
   && printf '%s\n' "$TARGETS" | grep -qvE '^/dev/(null|stderr|stdout)$'; then
  DECISION="deny"
  REASON="BLOCKED: Command may write a secret VALUE to a file. Review manually."
fi

# == WARNING: npm publish, deployment commands ================

if echo "$COMMAND" | grep -qE "(npm\s+publish|vercel\s+--prod|vercel\s+deploy)" && [ "$DECISION" = "allow" ]; then
  DECISION="warn"
  CONTEXT="WARNING: $AGENT_TYPE is running a deployment command. This should only happen through the CI/CD pipeline, not directly."
fi

# == Emit decision ============================================

if [ "$DECISION" = "deny" ]; then
  jq -n --arg reason "$REASON" \
    '{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason } }'
elif [ "$DECISION" = "warn" ]; then
  jq -n --arg context "$CONTEXT" \
    '{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", additionalContext: $context } }'
fi

exit 0
