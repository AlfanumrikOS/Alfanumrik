# Verify Migrations Apply Cleanly — this session's `20260722*` batch

> **STAGING FIRST — never apply an unverified migration batch directly to
> production.** No agent could verify live migration application this session (no
> DB / Docker / psql available), so this checklist exists for an operator to run
> `supabase db push` against a **fresh staging DB** and confirm all 22 migrations
> apply cleanly, in timestamp order, before any production deploy.

## Scope

The 22 migrations added this session, in exact lexicographic (= apply) order —
`supabase db push` applies files at the immediate `supabase/migrations/` root in
filename order:

```
20260722090000_protected_feature_flags_registry.sql
20260722090100_feature_flags_db_guard_trigger.sql
20260722090200_admin_flip_feature_flag_rpc.sql
20260722091000_adaptive_interventions_rls_xc3_backport.sql
20260722092000_notification_log_audit_table.sql
20260722093000_assignment_submissions_teacher_feedback_hi.sql
20260722094000_whatsapp_notify_register_adaptive_remediation_caller.sql
20260722095000_task_queue_run_lock_unique_index.sql
20260722096000_exam_papers_add_grade_column.sql
20260722096100_mock_test_attempts_add_question_snapshot.sql
20260722096200_cbse_board_exam_papers_grade_subject_matrix_seed.sql
20260722097000_start_mock_test_attempt_rpc.sql
20260722097100_submit_mock_test_attempt_snapshot_scoring.sql
20260722097200_deactivate_legacy_cbse_multisubject_sample_paper.sql
20260722098000_monthly_synthesis_flagged_status.sql
20260722099000_irt_calibration_readiness_rpc.sql
20260722101000_adaptive_loops_health_rpc.sql
20260722101500_seed_alert_rule_adaptive_cron_heartbeat.sql
20260722102000_synthesis_quality_scores.sql
20260722102100_seed_alert_rule_synthesis_delivery_failure.sql
20260722102200_seed_alert_rules_adaptive_loops_monitor.sql
20260722103000_support_tickets_related_entity.sql
```

## Risk classification (apply-order aware)

Highest-risk migrations are the ones that **CREATE new tables or RPCs** — they
introduce new objects that later migrations (and the app) depend on, so a
failure here cascades. Pure seeds / ALTERs are lower risk (idempotent, additive,
easy to re-run).

### CREATE TABLE — highest risk (new tables + RLS + indexes)

| Migration | Creates | Notes |
|---|---|---|
| `…090000_protected_feature_flags_registry` | `public.protected_feature_flags` | + RLS enable + policy + seed INSERT. First in the batch — the feature-flag guard chain (`…090100`, `…090200`) builds on it. |
| `…092000_notification_log_audit_table` | `public.notification_log` | + RLS + 3 indexes + seed INSERTs. |
| `…102000_synthesis_quality_scores` | `public.synthesis_quality_scores` | + RLS + 2 indexes. |

**Confirm each: `relrowsecurity = t`, policies present, indexes created.**

### CREATE FUNCTION / RPC — high risk (new callable surface)

| Migration | Creates | Notes |
|---|---|---|
| `…090100_feature_flags_db_guard_trigger` | `public.protect_feature_flags_guard()` + 2 triggers | DB-level guard on `feature_flags`; depends on `…090000`. |
| `…090200_admin_flip_feature_flag_rpc` | `public.admin_flip_feature_flag(...)` | + seed INSERT. |
| `…097000_start_mock_test_attempt_rpc` | `public.start_mock_test_attempt(...)` | Depends on the `…096*` exam/mock-test ALTERs below. |
| `…097100_submit_mock_test_attempt_snapshot_scoring` | `public.submit_mock_test_attempt(...)` + scoring helpers | P1 score-formula surface — confirm it compiles. |
| `…099000_irt_calibration_readiness_rpc` | `public.get_irt_calibration_readiness()` | Read-only readiness RPC. |
| `…101000_adaptive_loops_health_rpc` | `public.get_adaptive_loops_health()` | Read-only monitor RPC (feeds the adaptive-loops dashboard). |

**Confirm each: `SELECT proname FROM pg_proc WHERE proname = '<fn>';` returns a
row; EXECUTE grants are as the migration declares.**

### ALTER TABLE — medium risk (additive column / CHECK / RLS changes)

| Migration | Changes |
|---|---|
| `…091000_adaptive_interventions_rls_xc3_backport` | 6 `CREATE POLICY` on `adaptive_interventions` (RLS backport — no data change). |
| `…093000_assignment_submissions_teacher_feedback_hi` | ALTER + ENABLE RLS (bilingual teacher-feedback column, P7). |
| `…096000_exam_papers_add_grade_column` | 4× ALTER — **adds a grade column. P5: confirm it is TEXT/varchar, never INTEGER.** |
| `…096100_mock_test_attempts_add_question_snapshot` | 2× ALTER (question-snapshot columns). |
| `…098000_monthly_synthesis_flagged_status` | 2× ALTER (flagged status). |
| `…103000_support_tickets_related_entity` | 3× ALTER + 1 index (related-entity columns). |

### INDEX — medium-low risk

| Migration | Changes |
|---|---|
| `…095000_task_queue_run_lock_unique_index` | `CREATE UNIQUE INDEX IF NOT EXISTS idx_task_queue_run_lock_processing_unique` (+ RLS enable + seed INSERTs). A partial-unique index — confirm no existing duplicate rows block its creation on a non-fresh DB. |

### Pure seeds / INSERT / UPDATE — lowest risk (idempotent, additive)

| Migration | Effect |
|---|---|
| `…094000_whatsapp_notify_register_adaptive_remediation_caller` | INSERT — registers the adaptive-remediation caller. |
| `…096200_cbse_board_exam_papers_grade_subject_matrix_seed` | INSERT — grade×subject matrix seed. |
| `…097200_deactivate_legacy_cbse_multisubject_sample_paper` | UPDATE — deactivates a legacy sample paper (no DDL). |
| `…101500_seed_alert_rule_adaptive_cron_heartbeat` | INSERT — cron-heartbeat alert rule. |
| `…102100_seed_alert_rule_synthesis_delivery_failure` | INSERT — synthesis-delivery-failure alert rule. |
| `…102200_seed_alert_rules_adaptive_loops_monitor` | 2× INSERT — adaptive-loops monitor alert rules. |

## Procedure (fresh staging DB)

```bash
# 1. Point the CLI at a FRESH staging project (not prod).
supabase link --project-ref <staging-ref>

# 2. Dry-run the pending list — confirm exactly these 22 files are pending and
#    ordered as above.
supabase migration list

# 3. Apply. `db push` runs only files at the immediate migrations/ root, in
#    filename order; `_legacy/` is skipped automatically.
supabase db push

# 4. Expect: every file reports applied, no error, process exits 0.
#    If any migration errors, STOP — the batch is not production-safe. Note the
#    first failing file; nothing after it applied.
```

## Post-apply verification queries

```sql
-- (a) The 3 new tables exist with RLS enabled.
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('protected_feature_flags','notification_log','synthesis_quality_scores');
-- expect: 3 rows, relrowsecurity = t for each.

-- (b) The 6 new RPCs / guard function exist.
SELECT proname FROM pg_proc WHERE proname IN (
  'protect_feature_flags_guard','admin_flip_feature_flag','start_mock_test_attempt',
  'submit_mock_test_attempt','get_irt_calibration_readiness','get_adaptive_loops_health'
) ORDER BY proname;
-- expect: 6 rows.

-- (c) P5 guard — the exam_papers grade column must NOT be an integer type.
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'exam_papers' AND column_name = 'grade';
-- expect: data_type = 'text' (or 'character varying'), NEVER 'integer'/'smallint'.

-- (d) The task_queue partial-unique index exists.
SELECT indexname FROM pg_indexes
WHERE indexname = 'idx_task_queue_run_lock_processing_unique';
-- expect: 1 row.

-- (e) The adaptive_interventions RLS backport landed (policy count sane).
SELECT count(*) AS policy_count FROM pg_policies WHERE tablename = 'adaptive_interventions';
-- expect: >= the pre-existing 4 + the 6 backported policies (confirm no dupes error'd).

-- (f) Migration ledger head is the last file in the batch.
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1;
-- expect: '20260722103000'.
```

## Idempotency re-run check (optional but recommended)

Re-run `supabase db push` a second time against the same DB. Every migration is
authored `IF NOT EXISTS` / `CREATE OR REPLACE` / `ON CONFLICT`, so the second run
must be a **no-op** (nothing pending, exit 0). If the second run tries to
re-apply or errors on a duplicate, that migration is not idempotent — flag it to
architect before the production deploy.

## Why this matters for the drills

The drill scripts in this directory assume this batch is applied on staging:
- `…101000_adaptive_loops_health_rpc` + `…101500` / `…102200` alert-rule seeds
  power the monitoring surfaces the runbooks reference for Loop-D and B/C
  observation.
- `…091000_adaptive_interventions_rls_xc3_backport` hardens the RLS on the exact
  `adaptive_interventions` table the drills seed and read.
- `…094000_whatsapp_notify_register_adaptive_remediation_caller` registers the
  notification caller the escalation branches exercise.

Run this migration check green **before** running `loop-a-remediation-drill.sql`,
`loops-bc-drill.sql`, or `loop-d-prerequisite-drill.sql`.
</content>
