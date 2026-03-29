#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Alfanumrik Agent Write Guard
#
# PreToolUse hook for Edit and Write tools.
# Enforces ownership boundaries: only the owning agent can
# write to critical files. Other agents get blocked or warned.
#
# Protocol:
#   stdin  → JSON with tool_name, tool_input.file_path, agent_type
#   stdout → JSON with permissionDecision: allow|deny
#   exit 0 always (decisions via JSON, not exit codes)
#
# When agent_type is empty, the user is driving directly —
# all writes are allowed. Enforcement only applies to subagents.
# ─────────────────────────────────────────────────────────────

set -euo pipefail

INPUT=$(cat)

AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# ── No agent type means user is driving directly → allow ─────
if [ -z "$AGENT_TYPE" ]; then
  exit 0
fi

# ── No file path means tool_input didn't have one → allow ────
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# ── Normalize path: strip project dir prefix if present ──────
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-/home/user/Alfanumrik}"
FILE_PATH="${FILE_PATH#"$PROJECT_DIR"/}"

# ── Rule engine ──────────────────────────────────────────────
# Each rule: pattern, allowed agents (comma-separated), warned agents, reason
# Format: check_rule "pattern" "allowed" "warned" "reason"

DECISION="allow"
REASON=""
CONTEXT=""

check_rule() {
  local pattern="$1"
  local allowed="$2"
  local warned="$3"
  local reason="$4"

  # Skip if a decision was already made by a previous rule
  if [ "$DECISION" != "allow" ]; then
    return
  fi

  # Skip if pattern doesn't match
  if ! echo "$FILE_PATH" | grep -qE "$pattern"; then
    return
  fi

  # Check if agent is in allowed list
  if echo ",$allowed," | grep -q ",$AGENT_TYPE,"; then
    return
  fi

  # Check if agent is in warned list
  if [ -n "$warned" ] && echo ",$warned," | grep -q ",$AGENT_TYPE,"; then
    DECISION="warn"
    CONTEXT="WARNING: $AGENT_TYPE is writing to $FILE_PATH which is owned by [$allowed]. $reason Proceed only if this is a coordinated handoff."
    return
  fi

  # Agent is not allowed or warned → block
  DECISION="deny"
  REASON="BLOCKED: $AGENT_TYPE cannot write to $FILE_PATH. Owner: [$allowed]. $reason"
}

# ── BLOCKING RULES (architecture-critical) ───────────────────

# Rule 1: Migrations — architect only
# Why: 160+ migration chain. Bad migration corrupts schema.
check_rule \
  "^supabase/migrations/" \
  "architect" \
  "" \
  "Only architect may write migrations (schema, RLS, RPCs)."

# Rule 2: RBAC and auth — architect only
# Why: Security boundary. Bug here exposes data to wrong roles.
check_rule \
  "^src/lib/(rbac|admin-auth)\.ts$" \
  "architect" \
  "" \
  "Auth/RBAC is a security boundary owned by architect."

# Rule 3: Middleware — architect only
# Why: 7-layer security middleware. Rate limiting, CORS, session refresh.
check_rule \
  "^src/middleware\.ts$" \
  "architect" \
  "" \
  "Middleware is the security perimeter owned by architect."

# Rule 4: Scoring and XP — assessment only
# Why: Product invariants P1-P4. Wrong values destroy learner trust.
check_rule \
  "^src/lib/(xp-rules|exam-engine|cognitive-engine|feedback-engine)\.ts$" \
  "assessment" \
  "" \
  "Scoring/XP/exam logic is owned by assessment (P1-P4)."

# Rule 5: AI Edge Functions — ai-engineer only
# Why: AI safety (P12). Unfiltered LLM output, prompt injection risk.
check_rule \
  "^supabase/functions/(foxy-tutor|ncert-solver|quiz-generator|cme-engine)/" \
  "ai-engineer" \
  "assessment" \
  "AI Edge Functions owned by ai-engineer. Assessment may review content rules."

# Rule 6: Payment — backend only
# Why: Money handling (P11). Webhook bugs can double-charge or grant free access.
check_rule \
  "^src/(lib/razorpay\.ts|app/api/payments/)" \
  "backend" \
  "" \
  "Payment code is owned by backend (P11)."

# Rule 7: Deployment config — architect only
# Why: Bad config breaks production for all users.
check_rule \
  "^(vercel\.json|\.github/workflows/|next\.config\.js)$" \
  "architect" \
  "ops" \
  "Deployment config owned by architect. Ops may update for operational docs."

# Rule 8: Agent system files — orchestrator only
# Why: Prevents agents from rewriting their own or others' rules.
check_rule \
  "^\.claude/(agents/|CLAUDE\.md|skills/)" \
  "orchestrator" \
  "" \
  "Agent system files can only be modified by orchestrator."

# ── WARNING RULES (domain-sensitive) ─────────────────────────

# Rule 9: Supabase server clients — architect primary, backend may need
# Why: Service role client bypasses RLS. Must be used carefully.
check_rule \
  "^src/lib/supabase-(admin|server)\.ts$" \
  "architect" \
  "backend" \
  "Supabase server clients bypass RLS. Architect owns, backend may coordinate."

# Rule 10: Super admin panel — ops primary
# Why: Elevated privilege code. Wrong logic exposes all user data.
check_rule \
  "^src/(app/super-admin/|app/api/super-admin/)" \
  "ops" \
  "frontend" \
  "Super admin code is owned by ops. Frontend may assist with UI."

# Rule 11: Client supabase helpers — frontend primary
# Why: Contains submitQuizResults() which touches scoring (P1-P4).
check_rule \
  "^src/lib/supabase\.ts$" \
  "frontend,assessment" \
  "backend" \
  "Client Supabase helpers contain quiz submission logic (P1-P4)."

# Rule 12: Sentry and monitoring config — ops primary
# Why: Wrong config can suppress error reporting in production.
check_rule \
  "^sentry\.(client|server|edge)\.config\.ts$" \
  "ops" \
  "architect" \
  "Monitoring config owned by ops. Architect may review infra settings."

# ── Emit decision ────────────────────────────────────────────

if [ "$DECISION" = "deny" ]; then
  jq -n \
    --arg reason "$REASON" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
elif [ "$DECISION" = "warn" ]; then
  jq -n \
    --arg context "$CONTEXT" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        additionalContext: $context
      }
    }'
fi

# If DECISION is still "allow" with no output, exit 0 silently → allow
exit 0
