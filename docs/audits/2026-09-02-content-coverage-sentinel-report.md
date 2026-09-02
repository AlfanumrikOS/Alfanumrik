# Content Coverage & Quality Sentinel — 2026-09-02

**Type:** Automated scheduled routine (Content Coverage & Quality Sentinel).
**Status: BLOCKED — could not execute.** Required tools unavailable in this session.

---

## Why the audit could not run

This routine requires two external-service MCP integrations to function:

1. **Supabase MCP (`execute_sql`)** — to query `question_bank` for coverage and quality metrics.
   Status: Not connected. Direct HTTPS access to `shktyoxqhundlvkiwguu.supabase.co` is also blocked
   by the session proxy (HTTP 403 on CONNECT tunnel). No `SUPABASE_ACCESS_TOKEN` or service-role
   key is available in the environment.

2. **Slack MCP (`post_message`)** — to deliver the coverage report to `#general`.
   Status: Not connected.

The SQL queries defined in the routine are sound and would produce the correct results against
`question_bank` if run from a session with database access. They are preserved below for the
next successful execution.

**No code, DDL, migration, or grant was applied.** Docs-only output.

---

## What is known from prior audits (as of 2026-08-29)

The most recent live measurement of the question bank is the launch-readiness audit
(`docs/audit/launch-readiness/findings.json`, measured 2026-08-29):

- **Total active questions:** 12,826+ (figure is a lower bound from a live `question_bank` query)
- **Answer-key leak (P0/P1):** RLS policy `question_bank_authenticated_read USING(true)` grants any
  authenticated student full SELECT on `correct_answer_index` and related columns.
  Status: **UNRESOLVED** — fix migration `20260814000023_keyless_question_serving_and_server_side_p6.sql`
  exists on disk but is NOT applied to production (confirmed 2026-08-29).
- **verify-question-bank cron:** has never worked (P0 finding P0-01 in findings.json) — signing
  header mismatch causes 401 on every invocation.
- **RAG readiness:** All 18 math+science cells are CELL_BLIND (2026-08-13 audit). No chapter can
  reach `rag_status='ready'` because max `verified_question_count` is 19 against a bar of 40.

No subject-by-grade question count breakdown exists in the committed audit record. The coverage
matrix (the primary deliverable of this routine) requires a live `question_bank` query to produce.

---

## Queries to run when database access is restored

### Step 1: Content Coverage Matrix
```sql
WITH targets AS (
  SELECT * FROM (VALUES
    ('math', ARRAY['6','7','8','9','10','11','12'], 100),
    ('science', ARRAY['6','7','8','9','10'], 100),
    ('physics', ARRAY['11','12'], 50),
    ('chemistry', ARRAY['11','12'], 50),
    ('biology', ARRAY['11','12'], 50),
    ('english', ARRAY['6','7','8','9','10'], 30),
    ('hindi', ARRAY['6','7','8','9','10'], 30),
    ('social_studies', ARRAY['6','7','8','9','10'], 30),
    ('economics', ARRAY['11','12'], 30),
    ('accountancy', ARRAY['11','12'], 30),
    ('business_studies', ARRAY['11','12'], 30),
    ('political_science', ARRAY['11','12'], 20),
    ('computer_science', ARRAY['11','12'], 20)
  ) AS t(subject, grades, min_questions)
),
counts AS (
  SELECT subject, grade, COUNT(*) as q_count
  FROM question_bank
  WHERE is_active = true
  GROUP BY subject, grade
)
SELECT t.subject, g.grade, COALESCE(c.q_count, 0) as actual, t.min_questions as target,
  CASE WHEN COALESCE(c.q_count, 0) >= t.min_questions THEN 'PASS' ELSE 'GAP' END as status
FROM targets t
CROSS JOIN LATERAL unnest(t.grades) AS g(grade)
LEFT JOIN counts c ON c.subject = t.subject AND c.grade = g.grade
ORDER BY status DESC, t.subject, g.grade;
```

### Step 2: Question Quality Checks
```sql
SELECT
  COUNT(*) FILTER (WHERE array_length(options, 1) IS NULL OR array_length(options, 1) != 4) as bad_option_count,
  COUNT(*) FILTER (WHERE correct_answer_index NOT BETWEEN 0 AND 3) as bad_answer_index,
  COUNT(*) FILTER (WHERE explanation IS NULL OR explanation = '') as missing_explanation,
  COUNT(*) FILTER (WHERE question_text LIKE '%{{%' OR question_text LIKE '%[BLANK]%' OR question_text LIKE '%TODO%') as template_markers,
  COUNT(*) FILTER (WHERE question_text IS NULL OR question_text = '') as empty_questions,
  COUNT(*) as total_questions
FROM question_bank
WHERE is_active = true;
```

### Step 3: P5 Grade Format Compliance
```sql
SELECT grade, COUNT(*) as count
FROM question_bank
WHERE grade NOT IN ('6','7','8','9','10','11','12')
GROUP BY grade
ORDER BY count DESC;
```

### Step 4: Duplicate Detection
```sql
SELECT md5(question_text) as hash, subject, grade, COUNT(*) as dupes
FROM question_bank
WHERE is_active = true
GROUP BY md5(question_text), subject, grade
HAVING COUNT(*) > 1
ORDER BY dupes DESC
LIMIT 10;
```

---

## Infrastructure gap this reveals

This routine is the second scheduled task to fail due to missing MCP connections:

- `2026-08-20-scheduled-data-quality-routine-report.md` — same pattern (push notification
  channel unavailable, findings persisted to docs).
- This report (2026-09-02) — Supabase MCP + Slack MCP both disconnected.

**Recommendation:** for scheduled routines to execute reliably, the session environment needs:
1. Supabase MCP server connected (provides `execute_sql` with service-role access)
2. Slack MCP server connected (provides `post_message` for `#general`)
3. OR: a `SUPABASE_SERVICE_ROLE_KEY` environment variable + allowlisted egress to
   `shktyoxqhundlvkiwguu.supabase.co` in the session proxy policy.

This report was generated because the routine's normal delivery channel was unavailable.
It is a **persistence-only artifact** — the CEO needs to be made aware that this routine
has not produced a live coverage report.
