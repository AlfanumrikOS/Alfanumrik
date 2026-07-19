# Scoring & Anti-Cheat Audit — 2026-07-19 04:44 UTC

**Status: BLOCKED — Audit could not run**  
**Session:** cse_01VjWdcCQAfPwFPGhdCdvUVD  
**Auditor:** Scheduled invariant validator (automated)

---

## Why The Audit Failed

The scheduled Scoring & Anti-Cheat Invariant Validator could not execute any
database queries or send Slack notifications. Two root causes:

### 1. MCP Tools Blocked (Primary)

The Supabase and Slack MCP servers ARE connected and report `hasTools: true`
in the Claude Code session logs:

```
MCP server "Supabase": Connection established — supabase v0.8.1, hasTools: true
MCP server "Slack":    Connection established — Slack MCP v1.0.0, hasTools: true
MCP server "github":   Connection established — github-mcp-server, hasTools: true
```

However, all `mcp__Supabase__*`, `mcp__Slack__*`, and `mcp__github__*` tool calls
return `Error: No such tool available`. This indicates the `--allowed-tools` or
`--disallowed-tools` parameter in the Claude Code scheduled-task launcher does NOT
include these MCP tools.

**Fix required:** Add `mcp__Supabase__execute_sql`, `mcp__Slack__slack_post_message`,
and `mcp__Slack__slack_list_channels` to the `allowed-tools` list for this scheduled task.

### 2. Network Access Blocked (Secondary)

All outbound HTTP connections are blocked in this environment (curl returns `000`).
The Supabase REST API and Management API are unreachable directly. Only Anthropic
API traffic passes through the internal proxy (`http://127.0.0.1:39913`).

---

## SQL Query Errors Found (Static Analysis)

While investigating the failure, the schema was reviewed against the audit SQL queries.
**Two queries contain schema mismatches that would cause errors at runtime:**

### P2 XP Economy Check — BROKEN

The audit SQL queries Steps 2 and 3 reference `quiz_sessions.xp_earned`:
```sql
-- WRONG: xp_earned is NOT a column in quiz_sessions
SELECT ... xp_earned ... FROM quiz_sessions ...
```

**Actual schema:** `quiz_sessions` has NO `xp_earned` column (confirmed in
`00000000000000_baseline_from_prod.sql`). XP is tracked in `xp_transactions` with:
- `daily_category = 'quiz'`
- `reference_id = 'quiz_' || session_id::text` (for sessions with session_id)
- `source IN ('quiz', 'quiz_correct', 'quiz_high_score', 'quiz_perfect')`

**Corrected P2 query (XP mismatch per session):**
```sql
-- P2: XP Economy Check — corrected for actual schema
SELECT
  qs.id,
  qs.student_id,
  qs.correct_answers,
  qs.score_percent::int,
  COALESCE(xt.xp_awarded, 0) AS actual_xp,
  (qs.correct_answers * 10
    + CASE WHEN qs.score_percent >= 80 THEN 20 ELSE 0 END
    + CASE WHEN qs.score_percent = 100 THEN 50 ELSE 0 END
  ) AS expected_xp,
  qs.created_at
FROM quiz_sessions qs
LEFT JOIN xp_transactions xt
  ON xt.reference_id = 'quiz_' || qs.id::text
WHERE qs.is_completed = true
  AND qs.created_at > NOW() - INTERVAL '24 hours'
  AND qs.total_questions > 0
  AND COALESCE(xt.xp_awarded, 0) != (
    qs.correct_answers * 10
    + CASE WHEN qs.score_percent >= 80 THEN 20 ELSE 0 END
    + CASE WHEN qs.score_percent = 100 THEN 50 ELSE 0 END
  )
ORDER BY qs.created_at DESC;
```

**Note:** Sessions submitted via legacy (null session_id) callers won't have a
`reference_id` link, so `xp_awarded` will be NULL — those sessions are excluded
from this check by the LEFT JOIN behavior.

**Corrected P2 Daily Cap Query (Step 3):**
```sql
-- P2: Daily XP Cap — corrected for actual schema (uses xp_transactions)
SELECT
  student_id,
  DATE(created_at AT TIME ZONE 'Asia/Kolkata') AS quiz_date_ist,
  SUM(amount) AS daily_xp
FROM xp_transactions
WHERE daily_category = 'quiz'
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY student_id, DATE(created_at AT TIME ZONE 'Asia/Kolkata')
HAVING SUM(amount) > 200
ORDER BY daily_xp DESC;
```

### P3 Response Count Check — BROKEN

The audit SQL (Step 4, Check 2 and Step 5 Ghost Sessions) uses:
```sql
LEFT JOIN quiz_responses qr ON qr.session_id = qs.id
```

**Actual schema:** The FK column in `quiz_responses` is `quiz_session_id`, NOT `session_id`.

**Corrected P3 Response Count Query:**
```sql
SELECT
  qs.id AS session_id,
  qs.student_id,
  qs.total_questions,
  COUNT(qr.id) AS response_count
FROM quiz_sessions qs
LEFT JOIN quiz_responses qr ON qr.quiz_session_id = qs.id  -- FIXED: quiz_session_id
WHERE qs.is_completed = true
  AND qs.created_at > NOW() - INTERVAL '24 hours'
GROUP BY qs.id, qs.student_id, qs.total_questions
HAVING COUNT(qr.id) != qs.total_questions
ORDER BY qs.created_at DESC;
```

**Corrected Ghost Sessions Query (Step 5):**
```sql
SELECT qs.id, qs.student_id, qs.subject, qs.created_at
FROM quiz_sessions qs
LEFT JOIN quiz_responses qr ON qr.quiz_session_id = qs.id  -- FIXED: quiz_session_id
WHERE qs.is_completed = true
  AND qs.created_at > NOW() - INTERVAL '7 days'
GROUP BY qs.id, qs.student_id, qs.subject, qs.created_at
HAVING COUNT(qr.id) = 0
ORDER BY qs.created_at DESC;
```

### Queries That Are Correct

- **P1 Score Accuracy (Step 1):** ✅ Column names correct (`score_percent`,
  `correct_answers`, `total_questions` all exist in `quiz_sessions`)
- **P3 Time Check (Step 4, Check 1):** ✅ Column names correct (`time_spent_seconds`
  exists in `quiz_sessions`)
- **Step 6 Summary Stats:** ❌ References `SUM(xp_earned)` — fix to use xp_transactions

---

## Corrected Step 6 Summary Stats

```sql
SELECT
  COUNT(DISTINCT qs.id) AS total_sessions_24h,
  ROUND(AVG(qs.score_percent)::numeric, 1) AS avg_score,
  COALESCE(SUM(xt.amount), 0) AS total_xp_awarded
FROM quiz_sessions qs
LEFT JOIN xp_transactions xt
  ON xt.reference_id = 'quiz_' || qs.id::text
WHERE qs.is_completed = true
  AND qs.created_at > NOW() - INTERVAL '24 hours';
```

---

## Action Items for CEO / Engineering

1. **[URGENT] Fix scheduled task tool permissions** — Add `mcp__Supabase__execute_sql`
   to the `allowed-tools` list for the Scoring & Anti-Cheat scheduled task so it can
   actually query the DB.

2. **[URGENT] Fix Slack notification** — Add `mcp__Slack__slack_post_message` and
   `mcp__Slack__slack_list_channels` to the `allowed-tools` list for this task.

3. **[HIGH] Fix P2 SQL queries** — Update Steps 2, 3, and 6 in the audit task to
   use `xp_transactions` instead of `quiz_sessions.xp_earned` (column doesn't exist).

4. **[HIGH] Fix P3 SQL queries** — Update Steps 4 (Check 2) and 5 to use
   `qr.quiz_session_id` instead of `qr.session_id`.

5. **[MEDIUM] Verify audit actually ran before today** — Since the scheduled task
   has broken SQL (P2 and P3 queries), previous runs may have been silently failing
   or producing wrong counts. Check Slack history for the last successful audit report.

---

*This report was generated by the automated Scoring & Anti-Cheat Invariant Validator.*  
*Run at 2026-07-19 04:44 UTC. Session: cse_01VjWdcCQAfPwFPGhdCdvUVD.*  
*No database queries were executed. No data was modified.*
