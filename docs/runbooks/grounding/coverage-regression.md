# Coverage Regression Runbook

**Severity:** high (content integrity — students may hit hard-abstain for chapters that were `ready` yesterday)
**Typical trigger:** Nightly coverage-audit (triggered by the daily-cron fan-out step `coverage_audit_triggered`, 18:30 UTC / 00:00 IST) detects a chapter dropped from `ready` → `partial` or `missing`. Emits `ops_events` with category `grounding.coverage`, message `rag_status_regression_detected`, severity `error`.
**Owner:** ops (primary) → ai-engineer (for re-ingest) → assessment (scope validation)

## Symptoms

- `/super-admin/grounding/coverage` severity distribution shows new `critical`/`high` entries that weren't present in yesterday's snapshot
- `ops_events` row: `category='grounding.coverage'`, `message='rag_status_regression_detected'`, `severity='error'`, context contains `{ run_id, regression_count, regressions: [...] }` (regression list capped at 50 entries in the event payload)
- If enforcement was enabled for the affected (grade, subject_code) pair and the regression drops verified_ratio below threshold, the service auto-disables enforcement → `ff_grounded_ai_enforced_pairs.auto_disabled_at` is set
- Students filing `ai_issue_reports` for that chapter with `reason_category='off_topic'` or `'unclear'`

## Detection queries

Chapters that regressed between the two most recent snapshots.

> **Schema note:** `coverage_audit_snapshots` is **one row per IST day** (UNIQUE `snapshot_date`). Per-chapter state lives inside the `cbse_syllabus_rows` **jsonb array** (each element: `{ board, grade, subject_code, chapter_number, rag_status, chunk_count, verified_question_count }`), alongside summary columns (`ready_count`, `partial_count`, `missing_count`, `total_verified_questions`, `total_chunks`). Diffing requires expanding the jsonb:

```sql
WITH last_two AS (
  SELECT snapshot_date, cbse_syllabus_rows,
         row_number() OVER (ORDER BY snapshot_date DESC) AS rn
    FROM coverage_audit_snapshots
   ORDER BY snapshot_date DESC
   LIMIT 2
),
today AS (
  SELECT r->>'board' AS board, r->>'grade' AS grade,
         r->>'subject_code' AS subject_code,
         (r->>'chapter_number')::int AS chapter_number,
         r->>'rag_status' AS rag_status
    FROM last_two, jsonb_array_elements(cbse_syllabus_rows) AS r
   WHERE rn = 1
),
prev AS (
  SELECT r->>'board' AS board, r->>'grade' AS grade,
         r->>'subject_code' AS subject_code,
         (r->>'chapter_number')::int AS chapter_number,
         r->>'rag_status' AS rag_status
    FROM last_two, jsonb_array_elements(cbse_syllabus_rows) AS r
   WHERE rn = 2
)
SELECT t.board, t.grade, t.subject_code, t.chapter_number,
       t.rag_status AS current_status, p.rag_status AS prev_status,
       (SELECT snapshot_date FROM last_two WHERE rn = 2) AS compared_against
  FROM today t
  JOIN prev p USING (board, grade, subject_code, chapter_number)
 WHERE (p.rag_status = 'ready'   AND t.rag_status IN ('partial','missing'))
    OR (p.rag_status = 'partial' AND t.rag_status = 'missing')
 ORDER BY t.grade, t.subject_code, t.chapter_number;
```

Alternatively, read the audit's own emitted event (same data, pre-computed):
```sql
SELECT occurred_at, context->>'regression_count' AS regression_count,
       jsonb_pretty(context->'regressions') AS regressions
  FROM ops_events
 WHERE category = 'grounding.coverage'
   AND message = 'rag_status_regression_detected'
 ORDER BY occurred_at DESC
 LIMIT 5;
```

> **Stale-baseline caveat (first run after dormancy):** the audit diffs against the **most recent prior snapshot**, whatever its age. If the nightly job was dormant (e.g. before the daily-cron fan-out wiring landed), the first run may compare against a snapshot that is weeks old (e.g. 57 days). A large regression list on that first night is NOT automatically an incident — triage each entry against intentional scope changes (`cbse_syllabus.is_in_scope` edits, syllabus revisions, deliberate chunk cleanup) made during the dormant window before treating anything as data loss. Note `compared_against` in the query above to see how stale the baseline was. Similarly, an `enforcement_auto_disabled` event on that first night is **designed behavior** (the ratio check finally ran again) — do NOT force-re-enable enforcement until `verified_ratio >= 0.9` is confirmed.

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
4. **Re-verify chapter.** After chunks are restored, the nightly verifier will re-run. To queue it, UPDATE `question_bank SET verification_state='legacy_unverified' WHERE grade=... AND subject=... AND chapter_number=...` — the verifier re-claims on the **next nightly daily-cron fan-out run (18:30 UTC / 00:00 IST)**, not within 30 minutes. If you can't wait for the nightly run, invoke `verify-question-bank` manually with the service-role bearer (see its README's Local dev section — the same curl works against production).

## Rollback / escalation

- **Intentional but admin forgot to update cbse_syllabus:** assessment owns the decision. Loop them in.
- **Data loss > 1 chapter:** page architect + ai-engineer; may need point-in-time Supabase restore.
- **Enforcement auto-disable is blocking students mid-session:** the auto-disable is the correct behaviour. Do NOT force-re-enable until chunks are restored and verified_ratio >= 0.9.

## Post-incident

- Add the incident to the weekly coverage report sent to the founder
- If the cause was an admin action: add a confirmation dialog / RBAC check for that action path
- If the cause was ingestion: ai-engineer adds an ingestion health check to the nightly run

## Nightly grounding jobs — morning absence check

Both grounding jobs (`coverage-audit`, `verify-question-bank`) are triggered by the **daily-cron fan-out** (steps `coverage_audit_triggered` / `question_bank_verify_triggered`, 18:30 UTC / 00:00 IST) — there are NO separate function schedules. The fan-out is **fail-soft**: a failed trigger only `console.warn`s inside daily-cron and does not emit an alert. So absence of the expected events is the signal.

Every morning (or when suspicious), check that last night's audit actually ran:

```sql
SELECT max(occurred_at) AS last_audit
  FROM ops_events
 WHERE category = 'grounding.coverage'
   AND message = 'audit_complete';
```

If `last_audit` is older than yesterday, the trigger silently failed. In order:

1. **Check daily-cron Edge Function logs** (Supabase dashboard → Edge Functions → daily-cron → Logs) for `triggerCoverageAudit:` / `triggerVerifyQuestionBank:` warn lines (`SUPABASE_URL or CRON_SECRET unavailable`, `non-OK <status>`, or `network error`).
2. **Verify `CRON_SECRET` is set in Edge Function secrets** — without it the fan-out skips both triggers by design (the targets reject unauthenticated calls).
3. Check that the daily-cron pg_cron job itself ran (its other steps' effects will also be absent if not).

### Optional: alert on grounding error events

To get alerted on grounding errors instead of relying on the morning check, seed `alert_rules` rows for the two grounding categories (verified against the `alert_rules` schema in `supabase/migrations/00000000000000_baseline_from_prod.sql`; same house pattern as `20260617000000_seed_payment_failed_webhook_alert_rule.sql` — `alert_rules.name` has no UNIQUE constraint, so guard with `WHERE NOT EXISTS`):

```sql
BEGIN;

INSERT INTO alert_rules (
  name, description, enabled, category, min_severity,
  count_threshold, window_minutes, channel_ids, cooldown_minutes
)
SELECT
  'Grounding coverage errors',
  'Fires on error/critical grounding.coverage ops_events (rag_status_regression_detected, enforcement_auto_disabled, audit_run_failed) from the nightly coverage-audit.',
  false,                  -- operator flips to true after attaching a channel
  'grounding.coverage',
  'error',                -- counts error AND critical
  1,                      -- nightly job: a single error event is actionable
  1440,                   -- 24h window (job runs once per day)
  '{}',                   -- attach real channel ids: SELECT id, name FROM notification_channels WHERE enabled;
  720                     -- cooldown: at most one alert per half-day
WHERE NOT EXISTS (
  SELECT 1 FROM alert_rules WHERE name = 'Grounding coverage errors'
);

INSERT INTO alert_rules (
  name, description, enabled, category, min_severity,
  count_threshold, window_minutes, channel_ids, cooldown_minutes
)
SELECT
  'Grounding verifier errors',
  'Fires on error/critical grounding.verifier ops_events from the nightly verify-question-bank run.',
  false,                  -- operator flips to true after attaching a channel
  'grounding.verifier',
  'error',
  1,
  1440,
  '{}',                   -- attach real channel ids: SELECT id, name FROM notification_channels WHERE enabled;
  720
WHERE NOT EXISTS (
  SELECT 1 FROM alert_rules WHERE name = 'Grounding verifier errors'
);

COMMIT;
```

After seeding, attach a channel and enable:

```sql
UPDATE alert_rules
   SET channel_ids = ARRAY[(SELECT id FROM notification_channels WHERE name = '<your channel>' AND enabled)],
       enabled = true
 WHERE name IN ('Grounding coverage errors', 'Grounding verifier errors');
```

Note: these rules match error **events**; they cannot detect a *silent* trigger failure (no event at all) — that is what the morning absence check above is for.
