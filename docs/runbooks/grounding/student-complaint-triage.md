# Student Complaint Triage Runbook

**Severity:** low-to-medium per ticket (aggregate is high — this is the learner-trust signal)
**Typical trigger:** Student submits an AI issue report via the Foxy "Report issue" button. Creates an `ai_issue_reports` row with `admin_resolution IS NULL`.
**Owner:** ops (triage) → ai-engineer / assessment / architect (fix, depending on root cause)

## Symptoms

- `/super-admin/grounding/ai-issues?status=pending` shows one or more rows awaiting admin review
- Daily complaint rate exceeds the spec §11.6 target (> 1 per 1000 Foxy turns — see dashboard)
- A specific pattern emerges (e.g., multiple reports for the same chapter with `reason_category='wrong_answer'`)

## Detection queries

Pending queue size:
```sql
SELECT count(*) AS pending,
       count(*) FILTER (WHERE created_at < now() - interval '24 hours') AS pending_over_24h
  FROM ai_issue_reports
 WHERE admin_resolution IS NULL OR admin_resolution = 'pending';
```

Pattern analysis — are reports clustering around a chapter or chunk?
```sql
SELECT grade, subject_code, chapter_number, count(*) AS report_count
  FROM ai_issue_reports r
  LEFT JOIN grounded_ai_traces t ON t.id = r.trace_id
 WHERE r.created_at > now() - interval '7 days'
   AND r.admin_resolution IS NULL
 GROUP BY 1,2,3
 ORDER BY report_count DESC
 LIMIT 20;
```

Complaint rate relative to Foxy traffic:
```sql
WITH foxy_turns AS (
  SELECT count(*) AS total FROM grounded_ai_traces
   WHERE caller = 'foxy' AND created_at > now() - interval '24 hours'
),
complaints AS (
  SELECT count(*) AS total FROM ai_issue_reports
   WHERE created_at > now() - interval '24 hours'
)
SELECT c.total AS complaints_24h, f.total AS foxy_turns_24h,
       c.total * 1000.0 / NULLIF(f.total, 0) AS complaints_per_1000_turns
  FROM complaints c, foxy_turns f;
```

## Triage flow

1. **Open** `/super-admin/grounding/ai-issues?status=pending`
2. **Click a row** to drill into the trace + the Foxy message (the UI renders both side-by-side if the trace is joined)
3. **Read** the student's `reason_category` + `student_comment`, the AI answer, and the retrieved chunks listed on the trace
4. **Categorise** by setting `admin_resolution` via the POST handler (UI: "Resolve" button). Choose from the CHECK constraint values:

| Resolution | When to choose | Follow-up action |
|---|---|---|
| `bad_chunk` | An NCERT chunk was corrupted/truncated/wrong | Flag the chunk in `rag_content_chunks` (set a `flagged_at` column if present, or delete). Kick off chapter re-verification via verification-queue → re-verify. Loop in ai-engineer to re-ingest. |
| `bad_prompt` | The AI prompt template produced a misleading framing regardless of chunk quality | Open an ai-engineer ticket to version the prompt template (`prompt_template_id` in the trace will tell you which one). Do NOT modify the live template without review. |
| `bad_question` | A `question_bank` row has a genuinely wrong answer/explanation | Soft-delete the row via verification-queue → soft-delete. If > 3 rows from same chapter, request re-verification of whole chapter (UPDATE `verification_state='legacy_unverified'` for the chapter). Loop in assessment for content QA. |
| `infra` | Service health caused the wrong answer (Voyage/Claude outage at the time) | Cross-reference the trace's `created_at` against `ops_events` for `grounding.*_circuit_opened`. If confirmed infra, no content action needed — explain via support. |
| `no_issue` | Student misread the answer, or it was correct but phrased confusingly | Resolve with admin_notes explaining. If multiple students hit the same confusion, consider a UX ticket with frontend. |
| `pending` | You need more info / cannot decide alone | Leave as-is; add admin_notes explaining what's blocking; notify relevant domain owner. |

5. **Canary cross-check.** Before closing any `wrong_answer` ticket for a MCQ quiz: check the trace for `category='grounding.scoring'` ops_events around the same time window. The scoring integrity epoch canary catches client/server shuffle drift — if it fires, the "wrong answer" may be a P1 scoring bug, not a content bug. Escalate to architect + assessment.

6. **Student response.** If ticket was `no_issue` or `infra`, the support team should reply to the student. If it was `bad_chunk` / `bad_question`, thank the student — they found a real bug. (No automated email yet; manual via support-tickets table.)

## Rollback / escalation

- **Sustained complaint rate > 2/1000 turns for 24h:** page assessment + ai-engineer. Consider flipping the affected caller's flag (e.g., `ff_grounded_ai_foxy = false`) to fall back to legacy while investigating.
- **Pattern of complaints on same chunk or chapter:** do NOT resolve individually. Open an umbrella ticket in ai-engineer; soft-delete / re-verify the cluster in one action.
- **A complaint reveals a safety issue** (age-inappropriate content, P12 violation): page ai-engineer immediately, flip `ff_grounded_ai_enabled = false`, brief the founder.

## Post-incident

- Weekly: compute pattern analysis query above; loop recurring chapters back to ai-engineer for targeted re-ingestion
- Monthly: compute complaint rate trend; target trajectory ≤ 1/1000 Foxy turns. Report in founder digest.
- If `bad_prompt` accumulates > 5 reports in a week: ai-engineer owns a prompt template review.
