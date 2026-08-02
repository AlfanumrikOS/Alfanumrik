# Scoring Integrity Audit — Failed Run (2026-08-02)

**Status**: ❌ FAILED TO RUN  
**Date**: 2026-08-02 04:33 UTC  
**Reason**: MCP tool connections unavailable in scheduled session

## What Happened

The scheduled Scoring & Anti-Cheat Invariant Validator could not execute its P1/P2/P3 checks.

### Root Cause

All three MCP integrations (Supabase, Slack, GitHub) were configured in the session but returned "No such tool available" when called. Investigation revealed:

1. **Supabase MCP** (`mcp__Supabase__*`): All calls returned `No such tool available`. Direct HTTP to `shktyoxqhundlvkiwguu.supabase.co` is blocked by the network policy (proxy 403). The Supabase OAuth connection in Claude.ai may have expired.

2. **Slack MCP** (`mcp__Slack__*`): Same failure pattern. Direct `slack.com` access is also network-blocked.

3. **GitHub MCP** (`mcp__github__*`): Same failure pattern.

4. **PushNotification tool**: Returns "exists but is not enabled in this context" — unavailable in scheduled task sessions without explicit activation.

5. **WebFetch tool**: Also "exists but is not enabled in this context".

### What Was Not Checked

- ❌ P1: Score accuracy (score_percent vs formula mismatch in last 24h)
- ❌ P2: XP economy (XP mismatch + daily cap > 200 XP)
- ❌ P3: Anti-cheat (speed < 3s/q, response count mismatch)
- ❌ Ghost sessions (completed sessions with 0 responses, last 7 days)
- ❌ Slack notification of results

## Required Actions

1. **Re-authorize Supabase MCP** in Claude.ai settings at https://claude.ai/settings/integrations — reconnect the Supabase OAuth integration.
2. **Re-authorize Slack MCP** in Claude.ai settings — reconnect the Slack OAuth integration.
3. **Manually run the audit SQL** in the Supabase dashboard (SQL editor) for project `shktyoxqhundlvkiwguu`:

```sql
-- P1: Score Accuracy
SELECT id, student_id, score_percent, correct_answers, total_questions,
  ROUND((correct_answers::numeric / NULLIF(total_questions, 0)) * 100) as expected_score,
  created_at
FROM quiz_sessions
WHERE is_completed = true
  AND created_at > NOW() - INTERVAL '24 hours'
  AND total_questions > 0
  AND score_percent != ROUND((correct_answers::numeric / total_questions) * 100)
ORDER BY created_at DESC;

-- P2: XP Economy
SELECT id, student_id, correct_answers, score_percent, xp_earned,
  (correct_answers * 10
    + CASE WHEN score_percent >= 80 THEN 20 ELSE 0 END
    + CASE WHEN score_percent = 100 THEN 50 ELSE 0 END
  ) as expected_xp,
  created_at
FROM quiz_sessions
WHERE is_completed = true
  AND created_at > NOW() - INTERVAL '24 hours'
  AND total_questions > 0
  AND xp_earned != (
    correct_answers * 10
    + CASE WHEN score_percent >= 80 THEN 20 ELSE 0 END
    + CASE WHEN score_percent = 100 THEN 50 ELSE 0 END
  )
ORDER BY created_at DESC;

-- P2: Daily XP Cap (> 200 XP)
SELECT student_id, DATE(created_at) as quiz_date, SUM(xp_earned) as daily_xp
FROM quiz_sessions
WHERE is_completed = true
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY student_id, DATE(created_at)
HAVING SUM(xp_earned) > 200
ORDER BY daily_xp DESC;

-- P3: Speed violations (< 3s avg per question)
SELECT id as session_id, student_id, total_questions, time_spent_seconds,
  ROUND(time_spent_seconds::numeric / NULLIF(total_questions, 0), 1) as avg_seconds_per_q
FROM quiz_sessions
WHERE is_completed = true
  AND created_at > NOW() - INTERVAL '24 hours'
  AND total_questions > 0
  AND time_spent_seconds > 0
  AND (time_spent_seconds::numeric / total_questions) < 3
ORDER BY avg_seconds_per_q ASC;

-- P3: Response count mismatch
SELECT qs.id as session_id, qs.student_id, qs.total_questions,
  COUNT(qr.id) as response_count
FROM quiz_sessions qs
LEFT JOIN quiz_responses qr ON qr.session_id = qs.id
WHERE qs.is_completed = true
  AND qs.created_at > NOW() - INTERVAL '24 hours'
GROUP BY qs.id, qs.student_id, qs.total_questions
HAVING COUNT(qr.id) != qs.total_questions
ORDER BY qs.created_at DESC;

-- Ghost sessions (7 days)
SELECT qs.id, qs.student_id, qs.subject, qs.created_at
FROM quiz_sessions qs
LEFT JOIN quiz_responses qr ON qr.session_id = qs.id
WHERE qs.is_completed = true
  AND qs.created_at > NOW() - INTERVAL '7 days'
GROUP BY qs.id, qs.student_id, qs.subject, qs.created_at
HAVING COUNT(qr.id) = 0
ORDER BY qs.created_at DESC;

-- Summary stats
SELECT COUNT(*) as total_sessions_24h,
  AVG(score_percent) as avg_score,
  SUM(xp_earned) as total_xp_awarded
FROM quiz_sessions
WHERE is_completed = true
  AND created_at > NOW() - INTERVAL '24 hours';
```

4. **Fix the scheduled task**: Update the scheduled task configuration to include proper network policy or fix the MCP OAuth tokens.

## Next Scheduled Run

The task should run again on the next schedule cycle. Once MCP integrations are re-authorized, it will automatically query the database and post to Slack.
