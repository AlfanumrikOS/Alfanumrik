# Scoring & Anti-Cheat Invariant Audit — BLOCKED

**Date:** 2026-08-12  
**Scheduled routine:** P1/P2/P3 Invariant Validator  
**Status:** ❌ COULD NOT RUN — infrastructure unreachable (3rd occurrence)

---

## ⚠️ RECURRING FAILURE — No data inspected since 2026-06-17

This is the **third time** this scheduled audit has failed to run with the same root cause.
Prior failure logs: `2026-06-17-scoring-audit-blocked.md`, `2026-06-26-payment-integrity-blocked.md`.

**The issue was documented in June and has NOT been fixed. This is NOT an all-clear.**

---

## What Was Supposed to Run

- **P1 — Score Accuracy**: Verify `score_percent = ROUND((correct / total) * 100)` for all sessions in last 24h
- **P2 — XP Economy**: Verify XP formula + 200 XP/day cap enforcement (200 XP/day cap per P2)
- **P3 — Anti-Cheat**: Speed violations (<3s/question avg), response count mismatches
- **Ghost sessions**: Completed sessions with 0 responses (7-day window)

## Why It Couldn't Run

| Dependency | Status |
|---|---|
| Supabase MCP tool `mcp__supabase__execute_sql` | ❌ Tool not available in this session |
| Slack MCP tool `mcp__slack__post_message` | ❌ Tool not available in this session |
| Push notification tool | ❌ Tool not available in this session |
| `SUPABASE_SERVICE_ROLE_KEY` env var | ❌ Not set in session environment |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` env var | ❌ Not set in session environment |
| Supabase CLI | ❌ Not installed in this environment |
| `gh` CLI | ❌ Not installed in this environment |

## Checks That Were Skipped

```
[ ] P1: score_percent = ROUND((correct/total)*100) — NOT CHECKED
[ ] P2: xp_earned formula (10/correct + 20 if ≥80% + 50 if 100%) — NOT CHECKED
[ ] P2: Daily XP cap (>200 XP/day per student) — NOT CHECKED
[ ] P3: Speed violations (<3s avg per question) — NOT CHECKED
[ ] P3: Response count ≠ total_questions — NOT CHECKED
[ ] Ghost sessions (0 responses on completed session, 7d) — NOT CHECKED
```

## Action Required (URGENT — same fix needed since June 17)

Choose ONE of the following to fix the scheduled session:

### Option A — Add MCP servers to the scheduled session (recommended)
In the Claude Code scheduled task settings, add to the session's MCP configuration:
- **Supabase MCP server** (provides `execute_sql`) — connect the same Supabase integration
- **Slack MCP server** (provides `post_message`) — connect your Slack workspace

### Option B — Set environment variables
In the scheduled session's environment configuration, add:
```
NEXT_PUBLIC_SUPABASE_URL=https://shktyoxqhundlvkiwguu.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
SLACK_WEBHOOK_URL=<your-slack-incoming-webhook-url>
```

### Option C — Manual fallback SQL
Until fixed, run these queries manually in Supabase Dashboard → SQL Editor:

```sql
-- P1: Score accuracy violations (last 24h)
SELECT id, student_id, score_percent, correct_answers, total_questions,
  ROUND((correct_answers::numeric / NULLIF(total_questions, 0)) * 100) as expected_score,
  created_at
FROM quiz_sessions
WHERE is_completed = true
  AND created_at > NOW() - INTERVAL '24 hours'
  AND total_questions > 0
  AND score_percent != ROUND((correct_answers::numeric / total_questions) * 100)
ORDER BY created_at DESC;

-- P2: XP violations (last 24h)
SELECT id, student_id, correct_answers, score_percent, xp_earned,
  (correct_answers * 10
    + CASE WHEN score_percent >= 80 THEN 20 ELSE 0 END
    + CASE WHEN score_percent = 100 THEN 50 ELSE 0 END
  ) as expected_xp,
  created_at
FROM quiz_sessions
WHERE is_completed = true
  AND created_at > NOW() - INTERVAL '24 hours'
  AND xp_earned != (
    correct_answers * 10
    + CASE WHEN score_percent >= 80 THEN 20 ELSE 0 END
    + CASE WHEN score_percent = 100 THEN 50 ELSE 0 END
  )
ORDER BY created_at DESC;

-- P2: Daily XP cap (>200 XP/day)
SELECT student_id, DATE(created_at) as quiz_date, SUM(xp_earned) as daily_xp
FROM quiz_sessions
WHERE is_completed = true
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY student_id, DATE(created_at)
HAVING SUM(xp_earned) > 200
ORDER BY daily_xp DESC;

-- P3: Speed violations
SELECT qs.id, qs.student_id, qs.total_questions, qs.time_spent_seconds,
  ROUND(qs.time_spent_seconds::numeric / NULLIF(qs.total_questions, 0), 1) as avg_seconds_per_q
FROM quiz_sessions qs
WHERE qs.is_completed = true
  AND qs.created_at > NOW() - INTERVAL '24 hours'
  AND qs.total_questions > 0
  AND qs.time_spent_seconds > 0
  AND (qs.time_spent_seconds::numeric / qs.total_questions) < 3
ORDER BY avg_seconds_per_q ASC;

-- P3: Response count mismatch
SELECT qs.id, qs.student_id, qs.total_questions, COUNT(qr.id) as response_count
FROM quiz_sessions qs
LEFT JOIN quiz_responses qr ON qr.session_id = qs.id
WHERE qs.is_completed = true
  AND qs.created_at > NOW() - INTERVAL '24 hours'
GROUP BY qs.id, qs.student_id, qs.total_questions
HAVING COUNT(qr.id) != qs.total_questions;

-- Ghost sessions (7d)
SELECT qs.id, qs.student_id, qs.subject, qs.created_at
FROM quiz_sessions qs
LEFT JOIN quiz_responses qr ON qr.session_id = qs.id
WHERE qs.is_completed = true
  AND qs.created_at > NOW() - INTERVAL '7 days'
GROUP BY qs.id, qs.student_id, qs.subject, qs.created_at
HAVING COUNT(qr.id) = 0
ORDER BY qs.created_at DESC;
```

## Reference

- Invariants: P1, P2, P3 in `.claude/CLAUDE.md`
- XP constants source: `packages/lib/src/xp-rules.ts`  
- Anti-cheat implementation: `apps/host/src/app/(student)/quiz/page.tsx`
- Regression catalog entries: REG-45 (P1/P2/P3 E2E), REG-48 (XP daily cap), REG-51 (score authority)
- Supabase project: `shktyoxqhundlvkiwguu`
- Previous failures: `2026-06-17-scoring-audit-blocked.md`
