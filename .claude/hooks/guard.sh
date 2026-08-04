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
#
# ── MONOREPO PATH IDIOM — read before editing any pattern ────
# This repo has NO `src/` at the repo root. Anchoring a pattern to
# `^src/` makes it structurally unmatchable (this happened: 17 of 34
# hook patterns were dead after the monorepo migration). Real layout:
#
#   packages/lib/src/<x>.ts     ← CANONICAL implementation
#   apps/host/src/lib/<x>.ts    ← 2-line auto-generated re-export stub
#   apps/host/src/app/...       ← Next.js routes and pages
#   apps/host/src/proxy.ts      ← middleware (renamed for Next.js 16)
#   apps/host/next.config.js    ← NOT at repo root
#   supabase/{migrations,functions}/  ← still at repo ROOT (did not move)
#
# Shared-lib rules use the idiom `^(packages/lib/src|apps/host/src/lib)/<name>\.ts$`
# so they fire on the canonical file AND on the stub. Editing a stub is
# itself suspicious (it is generated), so covering it is intentional.
#
# Every pattern here is verified non-empty by `.claude/hooks/verify-hook-patterns.sh`.
# Run that script after ANY pattern edit. It fails if a pattern matches zero files.

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
  "^(packages/lib/src|apps/host/src/lib)/(rbac|admin-auth)\.ts$" \
  "architect" \
  "" \
  "Auth/RBAC is a security boundary owned by architect."

# Rule 3: Middleware — architect only
# Why: 7-layer security middleware. Rate limiting, CORS, session refresh.
#      Named proxy.ts (renamed from middleware.ts for Next.js 16).
check_rule \
  "^apps/host/src/proxy\.ts$" \
  "architect" \
  "" \
  "Middleware (apps/host/src/proxy.ts) is the security perimeter owned by architect."

# Rule 4: Scoring and XP — assessment only
# Why: Product invariants P1-P4. Wrong values destroy learner trust.
check_rule \
  "^(packages/lib/src|apps/host/src/lib)/(xp-rules|exam-engine|cognitive-engine|feedback-engine)\.ts$" \
  "assessment" \
  "" \
  "Scoring/XP/exam logic is owned by assessment (P1-P4)."

# Rule 5: AI Edge Functions — ai-engineer only
# Why: AI safety (P12). Unfiltered LLM output, prompt injection risk.
# Note: foxy-tutor was removed from this list because the Edge Function was
#       retired 2026-07-01 and no longer exists on disk (that alternative was
#       dead). Its successor is covered by Rule 5a below.
check_rule \
  "^supabase/functions/(ncert-solver|quiz-generator|cme-engine)/" \
  "ai-engineer" \
  "assessment" \
  "AI Edge Functions owned by ai-engineer. Assessment may review content rules."

# Rule 5a: Foxy AI route — ai-engineer primary
# Why: Successor to the retired foxy-tutor Edge Function. Same P12 surface.
#      Warned (not blocked) for backend because it is a Next.js API route and
#      backend legitimately touches route plumbing.
check_rule \
  "^apps/host/src/app/api/foxy/" \
  "ai-engineer" \
  "assessment,backend" \
  "The Foxy route is the AI tutor surface owned by ai-engineer (P12)."

# Rule 6: Payment — backend only
# Why: Money handling (P11). Webhook bugs can double-charge or grant free access.
check_rule \
  "^(packages/lib/src|apps/host/src/lib)/razorpay\.ts$|^apps/host/src/app/api/payments/" \
  "backend" \
  "" \
  "Payment code is owned by backend (P11)."

# Rule 7: Deployment config — architect only
# Why: Bad config breaks production for all users.
# Note: next.config.js lives at apps/host/, not the repo root. The workflows
#       alternative previously carried a trailing `$`, so it could only match
#       the literal directory string and never a file inside it.
check_rule \
  "^(vercel\.json|apps/host/next\.config\.js)$|^\.github/workflows/" \
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

# Rule 9: Mobile app — mobile agent only
# Why: Flutter/Dart codebase. Web agents don't write Dart. XP sync is critical.
check_rule \
  "^mobile/" \
  "mobile" \
  "" \
  "Mobile app is owned by mobile agent. Web agents do not write Dart."

# ── WARNING RULES (domain-sensitive) ─────────────────────────

# Rule 10: Supabase server clients (renumbered) — architect primary, backend may need
# Why: Service role client bypasses RLS. Must be used carefully.
check_rule \
  "^(packages/lib/src|apps/host/src/lib)/supabase-(admin|server)\.ts$" \
  "architect" \
  "backend" \
  "Supabase server clients bypass RLS. Architect owns, backend may coordinate."

# Rule 10a: Super admin pages — frontend implements, ops reviews
# Why: Frontend owns page.tsx implementation. Ops owns business logic requirements.
check_rule \
  "^apps/host/src/app/super-admin/.*page\.tsx$" \
  "frontend" \
  "ops" \
  "Super admin pages: frontend implements, ops reviews metric/business logic."

# Rule 10b: Super admin APIs — backend implements, ops reviews
# Why: Backend owns query implementation. Ops owns reporting requirements.
check_rule \
  "^apps/host/src/app/api/super-admin/" \
  "backend" \
  "ops" \
  "Super admin APIs: backend implements queries, ops reviews requirements."

# Rule 11: Client supabase helpers — frontend primary
# Why: Contains submitQuizResults() which touches scoring (P1-P4).
check_rule \
  "^(packages/lib/src|apps/host/src/lib)/supabase\.ts$" \
  "frontend,assessment" \
  "backend" \
  "Client Supabase helpers contain quiz submission logic (P1-P4)."

# Rule 12: Sentry and monitoring config — ops primary
# Why: Wrong config can suppress error reporting in production.
# Note: these live at apps/host/ ROOT (not repo root), and the client file
#       was renamed sentry-client-init.ts (not sentry.client.config.ts) —
#       repointed 2026-08-04 after the monorepo migration left this pattern
#       anchored to pre-migration filenames that no longer exist on disk.
check_rule \
  "^apps/host/sentry(-client-init|\.(server|edge)\.config)\.ts$" \
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
