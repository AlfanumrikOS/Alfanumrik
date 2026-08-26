#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Alfanumrik Review Chain Reminder
#
# PostToolUse hook for Edit and Write tools.
# After a subagent successfully writes to a critical file,
# injects a reminder of which downstream agents MUST review
# before the task can be marked complete.
#
# This does NOT block — it adds context so the orchestrator
# and quality agent can enforce review chain completion.
#
# Protocol:
#   stdin  → JSON with tool_name, tool_input.file_path, agent_type
#   stdout → JSON with additionalContext (or empty for no reminder)
#   exit 0 always
# ─────────────────────────────────────────────────────────────

set -euo pipefail

INPUT=$(cat)

AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# No agent or no file → no reminder needed
if [ -z "$AGENT_TYPE" ] || [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Normalize path
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-/home/user/Alfanumrik}"
FILE_PATH="${FILE_PATH#"$PROJECT_DIR"/}"

REMINDER=""

# ── Review chain rules ───────────────────────────────────────
# Each rule: if file matches pattern, set reminder with required reviewers.
# Only the FIRST matching rule fires (early return via if/elif).

if echo "$FILE_PATH" | grep -qE "^(packages/lib/src|apps/host/src/lib)/xp-rules\\.ts$"; then
  REMINDER="REVIEW CHAIN REQUIRED: xp-rules.ts was modified. Before task completion, orchestrator must invoke: (1) testing — update XP calculation assertions, (2) ai-engineer — verify cme-engine mastery thresholds still match, (3) backend — verify atomic_quiz_profile_update RPC level formula matches, (4) frontend — verify scorecard display uses updated constants, (5) mobile — update hardcoded XP values in mobile/lib/data/repositories/quiz_repository.dart to match."

elif echo "$FILE_PATH" | grep -qE "^(packages/lib/src|apps/host/src/lib)/exam-engine\\.ts$"; then
  REMINDER="REVIEW CHAIN REQUIRED: exam-engine.ts was modified. Before task completion, orchestrator must invoke: (1) testing — update timing/preset tests, (2) frontend — verify QuizSetup.tsx uses updated presets, (3) ai-engineer — verify quiz-generator difficulty mapping matches."

elif echo "$FILE_PATH" | grep -qE "^(packages/lib/src|apps/host/src/lib)/cognitive-engine\\.ts$"; then
  REMINDER="REVIEW CHAIN REQUIRED: cognitive-engine.ts was modified. Before task completion, orchestrator must invoke: (1) ai-engineer — verify cme-engine implements updated rules, (2) frontend — verify progress page renders updated metrics, (3) testing — update cognitive threshold tests."

elif echo "$FILE_PATH" | grep -qE "^(packages/lib/src|apps/host/src/lib)/feedback-engine\\.ts$"; then
  REMINDER="REVIEW CHAIN REQUIRED: feedback-engine.ts was modified. Before task completion, orchestrator must invoke: (1) ai-engineer — verify foxy-tutor feedback alignment, (2) frontend — verify FeedbackOverlay renders correctly, (3) testing — update feedback tests."

elif echo "$FILE_PATH" | grep -qE "^apps/host/src/app/api/foxy/"; then
  REMINDER="REVIEW CHAIN REQUIRED: the Foxy AI route (apps/host/src/app/api/foxy/) was modified. This is the successor to the retired foxy-tutor Edge Function and carries the same P12 surface. Before task completion, orchestrator must invoke: (1) assessment — verify curriculum correctness and age-appropriateness, (2) testing — update AI regression tests, (3) mobile — verify mobile/lib/data/repositories/chat_repository.dart handles updated response shape (mobile POSTs to this route; FOXY_ENDPOINT defaults to 'api')."

elif echo "$FILE_PATH" | grep -qE "^supabase/functions/ncert-solver/"; then
  REMINDER="REVIEW CHAIN REQUIRED: ncert-solver was modified. Before task completion, orchestrator must invoke: (1) assessment — verify NCERT solution accuracy, (2) testing — update solver tests."

elif echo "$FILE_PATH" | grep -qE "^supabase/functions/quiz-generator/"; then
  REMINDER="REVIEW CHAIN REQUIRED: quiz-generator was modified. Before task completion, orchestrator must invoke: (1) assessment — verify difficulty/Bloom distribution matches exam presets, (2) testing — update question selection tests."

elif echo "$FILE_PATH" | grep -qE "^supabase/functions/cme-engine/"; then
  REMINDER="REVIEW CHAIN REQUIRED: cme-engine was modified. Before task completion, orchestrator must invoke: (1) assessment — verify BKT/IRT output matches cognitive model rules, (2) testing — update mastery computation tests."

elif echo "$FILE_PATH" | grep -qE "^supabase/functions/_shared/"; then
  REMINDER="REVIEW CHAIN REQUIRED: shared Edge Function utilities were modified. supabase/functions/_shared/ is imported far beyond the AI functions — verify with: grep -rl '_shared/' supabase/functions/ | cut -d/ -f3 | sort -u. Before task completion, orchestrator must invoke: (1) ai-engineer — verify the AI functions still work (ncert-solver, quiz-generator, cme-engine) and that the Foxy route at apps/host/src/app/api/foxy/ is unaffected, (2) testing — run the full Edge Function test suite."

elif echo "$FILE_PATH" | grep -qE "^(packages/lib/src|apps/host/src/lib)/(rbac|admin-auth)\\.ts$|^apps/host/src/proxy\\.ts$"; then
  REMINDER="REVIEW CHAIN REQUIRED: auth/RBAC was modified. Before task completion, orchestrator must invoke: (1) backend — verify API routes use correct permission codes, (2) frontend — verify usePermissions UI gating matches, (3) ops — verify admin panel access unaffected, (4) testing — update RBAC regression tests."

elif echo "$FILE_PATH" | grep -qE "^supabase/migrations/.*(student|chapter|topic|question_bank|quiz|chat|subscription|daily_usage)"; then
  REMINDER="REVIEW CHAIN REQUIRED: migration modifying a mobile-dependent table was added. Before task completion, orchestrator must invoke: (1) mobile — verify mobile models and repositories match updated schema (tables: students, chapters, topics, question_bank, quiz_attempts, chat_sessions, foxy_chat_messages, student_daily_usage, student_subscriptions, student_topic_progress), (2) testing — update schema-dependent tests."

elif echo "$FILE_PATH" | grep -qE "^supabase/migrations/.*role|^supabase/migrations/.*rbac|^supabase/migrations/.*permission"; then
  REMINDER="REVIEW CHAIN REQUIRED: RBAC migration was added. Before task completion, orchestrator must invoke: (1) backend — verify API routes reference new permission codes, (2) frontend — verify client-side permission checks updated, (3) ops — verify admin panel reflects changes, (4) testing — update RBAC tests."

elif echo "$FILE_PATH" | grep -qE "^(packages/lib/src|apps/host/src/lib)/razorpay\\.ts$|^apps/host/src/app/api/payments/"; then
  REMINDER="REVIEW CHAIN REQUIRED: payment code was modified. Before task completion, orchestrator must invoke: (1) architect — verify webhook signature verification intact, (2) testing — update payment regression tests, (3) mobile — verify mobile/lib/data/repositories/subscription_repository.dart matches updated payment API contract."

elif echo "$FILE_PATH" | grep -qE "^(vercel\\.json|apps/host/next\\.config\\.js)$|^\\.github/workflows/"; then
  REMINDER="REVIEW CHAIN REQUIRED: deployment config was modified. Before task completion, orchestrator must invoke: (1) ops — update operational runbooks if procedures changed, (2) testing — verify CI pipeline still passes."

elif echo "$FILE_PATH" | grep -qE "^supabase/functions/daily-cron/"; then
  REMINDER="REVIEW CHAIN REQUIRED: daily-cron was modified. Before task completion, orchestrator must invoke: (1) frontend — verify notification UI handles any new types, (2) ops — verify monitoring covers updated cron behavior."

elif echo "$FILE_PATH" | grep -qE "^apps/host/src/app/api/super-admin/(analytics|stats|reports)/"; then
  REMINDER="REVIEW CHAIN REQUIRED: super-admin reporting API was modified. Before task completion, orchestrator must invoke: (1) frontend — verify admin dashboard renders updated data shape, (2) ops — verify metric definitions still match requirements. If learner metrics changed: (3) assessment — validate metric definition."

elif echo "$FILE_PATH" | grep -qE "^apps/host/src/app/api/super-admin/cms/"; then
  REMINDER="REVIEW CHAIN REQUIRED: CMS API was modified. Before task completion, orchestrator must invoke: (1) assessment — verify content workflow doesn't break educational content QA, (2) frontend — verify CMS page handles workflow changes, (3) testing — update CMS workflow tests."

elif echo "$FILE_PATH" | grep -qE "^apps/host/src/app/api/super-admin/(users|roles)/"; then
  REMINDER="REVIEW CHAIN REQUIRED: admin user/role API was modified. Before task completion, orchestrator must invoke: (1) architect — verify RBAC permission model intact, (2) frontend — verify admin panel user management UI matches, (3) testing — update admin RBAC tests."

elif echo "$FILE_PATH" | grep -qE "^apps/host/src/app/api/super-admin/feature-flags/"; then
  REMINDER="REVIEW CHAIN REQUIRED: feature flag API was modified. Before task completion, orchestrator must invoke: (1) ops — verify flag evaluation logic matches admin UI expectations, (2) testing — update feature flag tests."

elif echo "$FILE_PATH" | grep -qE "^apps/host/src/app/super-admin/.*page\\.tsx$"; then
  REMINDER="REVIEW CHAIN REQUIRED: super-admin page was modified. Before task completion, orchestrator must invoke: (1) ops — verify page still shows correct metrics and business logic, (2) testing — verify page renders."

fi

# ── Emit reminder if one was generated ───────────────────────
if [ -n "$REMINDER" ]; then
  jq -n --arg ctx "$REMINDER" \
    '{ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: $ctx } }'
fi

exit 0
