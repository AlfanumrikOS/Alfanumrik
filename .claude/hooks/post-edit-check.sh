#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Alfanumrik Post-Edit Content Check
#
# PostToolUse hook for Edit and Write tools.
# After a successful write, checks the written content for
# common violations that should be caught immediately rather
# than waiting for quality review.
#
# This runs AFTER review-chain.sh (both fire on PostToolUse).
# It adds warnings to the conversation; it does not block.
# ─────────────────────────────────────────────────────────────

set -euo pipefail

INPUT=$(cat)

AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // empty')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# No agent or no file → skip
if [ -z "$AGENT_TYPE" ] || [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check files that exist
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

WARNINGS=""

# ── Check: secrets in source code ────────────────────────────
if grep -qE "(SUPABASE_SERVICE_ROLE|sk_live_|rzp_live_|eyJhbGciOi)" "$FILE_PATH" 2>/dev/null; then
  # Exclude .env.example and docs
  if ! echo "$FILE_PATH" | grep -qE "\.(example|md)$"; then
    WARNINGS="${WARNINGS}SECRET DETECTED: $FILE_PATH may contain a hardcoded secret (service role key, live API key, or JWT). Remove before commit. "
  fi
fi

# ── Check: NEXT_PUBLIC_ with service role ────────────────────
if grep -qE "NEXT_PUBLIC_.*SERVICE_ROLE|NEXT_PUBLIC_.*ADMIN_SECRET" "$FILE_PATH" 2>/dev/null; then
  WARNINGS="${WARNINGS}P8 VIOLATION: $FILE_PATH exposes a server secret via NEXT_PUBLIC_ prefix. This will be visible to browsers. "
fi

# ── Check: console.log in production code ────────────────────
if echo "$FILE_PATH" | grep -qE "\.(ts|tsx)$" && ! echo "$FILE_PATH" | grep -qE "__tests__|\.test\.|\.spec\."; then
  if grep -qE "console\.log\(" "$FILE_PATH" 2>/dev/null; then
    WARNINGS="${WARNINGS}LINT: $FILE_PATH contains console.log(). Use console.warn() or console.error() in production code. "
  fi
fi

# ── Check: hardcoded XP values in non-xp-rules files ────────
if ! echo "$FILE_PATH" | grep -qE "xp-rules\.ts$"; then
  # Look for suspicious XP arithmetic patterns
  if grep -qE "\*\s*10\s*[;+]|quiz_per_correct|===\s*100\s*\?\s*50|>=\s*80\s*\?\s*20" "$FILE_PATH" 2>/dev/null; then
    if echo "$FILE_PATH" | grep -qE "\.(ts|tsx|dart)$"; then
      WARNINGS="${WARNINGS}P2 WARNING: $FILE_PATH may contain hardcoded XP values. XP constants must come from XP_RULES in src/lib/xp-rules.ts. "
    fi
  fi
fi

# ── Check: integer grade in TypeScript ───────────────────────
if echo "$FILE_PATH" | grep -qE "\.(ts|tsx)$"; then
  if grep -qE "grade\s*[:=]\s*[0-9]+[^'\"]|grade\s*===?\s*[0-9]+[^'\"]" "$FILE_PATH" 2>/dev/null; then
    WARNINGS="${WARNINGS}P5 WARNING: $FILE_PATH may use integer grade values. Grades must be strings ('6' through '12'). "
  fi
fi

# ── Check: migration without RLS ─────────────────────────────
if echo "$FILE_PATH" | grep -qE "supabase/migrations/.*\.sql$"; then
  if grep -qiE "CREATE TABLE" "$FILE_PATH" 2>/dev/null; then
    if ! grep -qiE "ENABLE ROW LEVEL SECURITY" "$FILE_PATH" 2>/dev/null; then
      WARNINGS="${WARNINGS}P8 VIOLATION: $FILE_PATH creates a table without ENABLE ROW LEVEL SECURITY. Every new table must have RLS enabled in the same migration. "
    fi
  fi
fi

# ── Check: migration with DROP TABLE/COLUMN ──────────────────
if echo "$FILE_PATH" | grep -qE "supabase/migrations/.*\.sql$"; then
  if grep -qiE "DROP TABLE|DROP COLUMN" "$FILE_PATH" 2>/dev/null; then
    WARNINGS="${WARNINGS}DESTRUCTIVE MIGRATION: $FILE_PATH contains DROP TABLE or DROP COLUMN. This requires explicit user approval before commit. "
  fi
fi

# ── Emit warnings ────────────────────────────────────────────
if [ -n "$WARNINGS" ]; then
  jq -n --arg ctx "$WARNINGS" \
    '{ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: $ctx } }'
fi

exit 0
