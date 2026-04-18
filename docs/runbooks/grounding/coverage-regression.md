# Coverage Regression Runbook

**Severity:** high (content integrity — students may hit hard-abstain for chapters that were `ready` yesterday)
**Typical trigger:** Nightly coverage-audit detects a chapter dropped from `ready` → `partial` or `missing`. Emits `ops_events` with category `grounding.coverage_regressed`, severity `high`.
**Owner:** ops (primary) → ai-engineer (for re-ingest) → assessment (scope validation)

## Symptoms

- `/super-admin/grounding/coverage` severity distribution shows new `critical`/`high` entries that weren't present in yesterday's snapshot
- `ops_events` row: `category='grounding.coverage_regressed'`, `severity='high'`, context contains `{ grade, subject_code, chapter_number, prev_status, new_status }`
- If enforcement was enabled for the affected (grade, subject_code) pair and the regression drops verified_ratio below threshold, the service auto-disables enforcement → `ff_grounded_ai_enforced_pairs.auto_disabled_at` is set
- Students filing `ai_issue_reports` for that chapter with `reason_category='off_topic'` or `'unclear'`

## Detection queries

Chapters that regressed in the last 24h (last two coverage snapshots):
```sql
WITH snapshots AS (
  SELECT created_at, board, grade, subject_code, chapter_number, rag_status,
         row_number() OVER (PARTITION BY board, grade, subject_code, chapter_number
                            ORDER BY created_at DESC) AS rn
    FROM coverage_audit_snapshots
   WHERE created_at > now() - interval '2 days'
)
SELECT a.board, a.grade, a.subject_code, a.chapter_number,
       a.rag_status AS current_status, b.rag_status AS prev_status
  FROM snapshots a
  JOIN snapshots b USING (board, grade, subject_code, chapter_number)
 WHERE a.rn = 1 AND b.rn = 2
   AND a.rag_status != b.rag_status
   AND a.rag_status IN ('partial','missing')
   AND b.rag_status = 'ready'
 ORDER BY a.grade, a.subject_code, a.chapter_number;
```

Chunk counts for the suspect chapter (is data actually gone?):
```sql
SELECT grade, subject_code, chapter_number, count(*) AS chunk_count
  FROM rag_content_chunks
 WHERE grade = '<grade>' AND subject_code = '<subject>' AND chapter_number = <n>
 GROUP BY 1,2,3;
```

Recent admin actions that could have caused chunk deletion:
```sql
SELECT occurred_at, source, message, context
  FROM ops_events
 WHERE category IN ('grounding.admin_action','cms.content')
   AND occurred_at > now() - interval '48 hours'
 ORDER BY occurred_at DESC;
```

## Response

1. **Identify the affected chapter(s)** — run the first detection query.
2. **Determine the cause:**
   - **Intentional scope change** (CBSE revised syllabus, chapter removed): update `cbse_syllabus.is_in_scope = false` for that chapter. Coverage regression is expected and correct — dismiss the alert.
   - **Admin action** (someone soft-deleted chunks, modified `rag_content_chunks`): check `ops_events` for `grounding.admin_action` source. Revert if unintentional (restore from backup; see `BACKUP_RESTORE.md`).
   - **Failed ingestion run** (`rag_ingestion_failures` has new rows for that chapter): trigger re-ingestion via ai-engineer. Do NOT retry automatically — the failure reason may need human review.
   - **Vacuum/cleanup gone wrong**: check recent migrations; open a ticket with architect.
3. **If the regression is critical and cannot be fixed within 4h:**
   - Check `ff_grounded_ai_enforced_pairs` for the affected (grade, subject_code). If the service already auto-disabled enforcement, you don't need to touch it — Foxy/quiz will soft-fallback for that pair until coverage returns.
   - If enforcement is still enabled, manually UPDATE `enabled=false, auto_disabled_reason='coverage_regression_manual'` via `/super-admin/grounding/verification-queue` → Enforcement tab, or via SQL.
4. **Re-verify chapter.** After chunks are restored, the nightly verifier will re-run. To speed it up, UPDATE `question_bank SET verification_state='legacy_unverified' WHERE grade=... AND subject=... AND chapter_number=...` (so verifier re-claims on next cron tick, within 30 min).

## Rollback / escalation

- **Intentional but admin forgot to update cbse_syllabus:** assessment owns the decision. Loop them in.
- **Data loss > 1 chapter:** page architect + ai-engineer; may need point-in-time Supabase restore.
- **Enforcement auto-disable is blocking students mid-session:** the auto-disable is the correct behaviour. Do NOT force-re-enable until chunks are restored and verified_ratio >= 0.9.

## Post-incident

- Add the incident to the weekly coverage report sent to the founder
- If the cause was an admin action: add a confirmation dialog / RBAC check for that action path
- If the cause was ingestion: ai-engineer adds an ingestion health check to the nightly run
