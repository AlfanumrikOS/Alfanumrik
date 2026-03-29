#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Alfanumrik Bash Command Guard
#
# PreToolUse hook for Bash tool.
# Blocks subagents from using shell commands to bypass the
# Edit/Write file-path protections (sed, awk, echo >, tee, etc).
# Also blocks accidental secret exposure and destructive ops.
#
# Protocol:
#   stdin  → JSON with tool_name, tool_input.command, agent_type
#   stdout → JSON with permissionDecision
#   exit 0 always
# ─────────────────────────────────────────────────────────────

set -euo pipefail

INPUT=$(cat)

AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# No agent = user driving → allow
if [ -z "$AGENT_TYPE" ]; then
  exit 0
fi

# No command → allow
if [ -z "$COMMAND" ]; then
  exit 0
fi

DECISION="allow"
REASON=""
CONTEXT=""

# ── BLOCKING: file modification via Bash on protected paths ──

# Check if command writes to protected files via sed, awk, echo, tee, cat, cp, mv
if echo "$COMMAND" | grep -qE "(sed\s+-i|awk\s+.*>|echo\s+.*>|tee\s|cat\s+.*>|cp\s|mv\s)" ; then
  # Check if it targets protected paths
  if echo "$COMMAND" | grep -qE "supabase/migrations|src/lib/(rbac|admin-auth|xp-rules|exam-engine|cognitive-engine|feedback-engine|razorpay|middleware)"; then
    DECISION="deny"
    REASON="BLOCKED: $AGENT_TYPE attempted to modify a protected file via Bash. Use Edit/Write tools instead — they are subject to ownership checks."
  fi
  if echo "$COMMAND" | grep -qE "supabase/functions/(foxy-tutor|ncert-solver|quiz-generator|cme-engine)" && [ "$DECISION" = "allow" ]; then
    DECISION="deny"
    REASON="BLOCKED: $AGENT_TYPE attempted to modify a protected AI function via Bash. Use Edit/Write tools instead."
  fi
  if echo "$COMMAND" | grep -qE "\.claude/(agents|skills|CLAUDE)" && [ "$DECISION" = "allow" ]; then
    DECISION="deny"
    REASON="BLOCKED: $AGENT_TYPE attempted to modify agent system files via Bash. Use Edit/Write tools instead."
  fi
  if echo "$COMMAND" | grep -qE "vercel\.json|\.github/workflows|next\.config" && [ "$DECISION" = "allow" ]; then
    DECISION="deny"
    REASON="BLOCKED: $AGENT_TYPE attempted to modify deployment config via Bash. Use Edit/Write tools instead."
  fi
fi

# ── BLOCKING: destructive git operations ─────────────────────

if echo "$COMMAND" | grep -qE "git\s+(push\s+--force|push\s+-f|reset\s+--hard|clean\s+-f|checkout\s+\.\s|restore\s+\.)"; then
  DECISION="deny"
  REASON="BLOCKED: Destructive git operation. This requires explicit user approval."
fi

# ── BLOCKING: secret exposure ────────────────────────────────

if echo "$COMMAND" | grep -qE "(SUPABASE_SERVICE_ROLE|RAZORPAY_KEY_SECRET|SUPER_ADMIN_SECRET)" ; then
  if echo "$COMMAND" | grep -qE "(echo|printf|cat|export|>>|>)" ; then
    DECISION="deny"
    REASON="BLOCKED: Command may expose or write secrets. Review manually."
  fi
fi

# ── WARNING: npm publish, deployment commands ────────────────

if echo "$COMMAND" | grep -qE "(npm\s+publish|vercel\s+--prod|vercel\s+deploy)" && [ "$DECISION" = "allow" ]; then
  DECISION="warn"
  CONTEXT="WARNING: $AGENT_TYPE is running a deployment command. This should only happen through the CI/CD pipeline, not directly."
fi

# ── Emit decision ────────────────────────────────────────────

if [ "$DECISION" = "deny" ]; then
  jq -n --arg reason "$REASON" \
    '{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason } }'
elif [ "$DECISION" = "warn" ]; then
  jq -n --arg context "$CONTEXT" \
    '{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", additionalContext: $context } }'
fi

exit 0
