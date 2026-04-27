# Schema Reconciliation Runbook — 2026-04-27

> **Status: in progress this session.** Production schema selectively diverged from
> the repo. This runbook documents the reconciliation order, verification queries,
> and rollback approach. Owner: architect (DB) + ops (oversight).

## Pre-conditions verified

- Latest physical backup: 2026-04-27T02:23:40Z (~6h before reconciliation start)
- WAL-G enabled (continuous archive)
- 5+ daily snapshots retained
- Region: ap-south-1 (Mumbai)
- DB version: PostgreSQL 17.6.1.084
- Production status: ACTIVE_HEALTHY

## Out-of-scope for this runbook

- DROP of legacy `atomic_quiz_profile_update(uuid,int,int,int)` and
  `(uuid,int,int,int,int,text)` overloads (defer; covered by separate session
  after callers fully audited).
- PITR enablement (separate plan upgrade decision).
- Removal of duplicate / legacy edge functions from older naming schemes
  (deferred; not blocking).

## Migration apply order (dependency-resolved)

| # | File | Creates / changes | Depends on |
|---|---|---|---|
| 1 | `20260405300000_xp_transaction_ledger.sql` | `xp_transactions` table, `award_xp` RPC, `xp_ledger_*` views | (none — purely additive) |
| 2 | `20260408000004_link_quiz_xp_to_ledger.sql` | 7-arg `atomic_quiz_profile_update` overload, ALTER on `xp_transactions` source CHECK constraint | #1 |
| 3 | `20260425120000_domain_events_outbox.sql` | `domain_events` table + `enqueue_event` RPC | (none) |
| 4 | `20260425150000_payment_webhook_events.sql` | `payment_webhook_events` table + `mark_webhook_event_processed` RPC | (none) |
| 5 | `20260427000001_rls_policies_domain_events_webhook_events.sql` | RLS policies on the 2 tables above | #3, #4 (already a partial no-op was applied; this re-applies properly) |
| 6 | `20260427000100_misconception_ontology.sql` | `misconceptions`, `student_skill_state`, `question_misconceptions` tables | (none) |
| 7 | `20260428000300_skill_state_teacher_rls_and_retrieval_trace_redaction.sql` | Teacher RLS on `skill_state`, redaction view on `retrieval_traces` | #6 |
| 8 | `20260428000400_irt_2pl_calibration_impl.sql` | `irt_2pl_calibrate_nightly` cron RPC | (question_bank columns from prior `irt_calibration_columns`) |
| 9 | `20260428000500_misconception_candidate_view.sql` | `misconception_candidates` view + super_admin RLS | #6 |
| 10 | `20260428000600_select_questions_by_irt_info.sql` | `select_questions_by_irt_info` RPC | #8 |
| 11 | `20260428000700_fix_irt_info_rpc_type.sql` | Fix return type on #10 | #10 |

## After each step: verification SQL

```sql
-- step N: confirm artefact exists
SELECT to_regclass('public.<table>') IS NOT NULL AS table_exists;
SELECT to_regprocedure('public.<rpc>(...)') IS NOT NULL AS rpc_exists;
SELECT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='<t>' AND policyname='<p>') AS policy_exists;
```

## Final step — schema_migrations sync

After all 11 migrations apply cleanly:

```sql
BEGIN;
DROP TABLE IF EXISTS supabase_migrations._sm_backup_20260427_drift_repair;
CREATE TABLE supabase_migrations._sm_backup_20260427_drift_repair AS
  SELECT *, now() AS backed_up_at FROM supabase_migrations.schema_migrations;
DELETE FROM supabase_migrations.schema_migrations
 WHERE version NOT IN (<all 339 local file versions>);
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES (<one row per local file>)
ON CONFLICT (version) DO NOTHING;
COMMIT;
```

After sync, `supabase db push --linked --include-all` is a no-op. CI's `migrations`
job will pass on subsequent deploys.

## Rollback

If any step fails:
- Restore from `2026-04-27T02:23:40Z` physical backup via Supabase dashboard
  (Project Settings → Database → Backups → Restore)
- Recovery brings DB to ~6h before reconciliation; ~3 quiz sessions / 0 payments
  in that window per traffic check
- After restore, schema_migrations + edge function deploys from this session
  must be re-applied

## Smoke-test queries (post-reconciliation)

```sql
-- Submit quiz path
SELECT to_regprocedure('public.submit_quiz_results(uuid,text,text,text,int,jsonb,int)') IS NOT NULL;
-- 7-arg overload exists
SELECT to_regprocedure('public.atomic_quiz_profile_update(uuid,text,int,int,int,int,uuid)') IS NOT NULL;
-- Webhook idempotency in place
SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payment_webhook_events');
-- Foxy moat substrate present
SELECT to_regclass('public.misconceptions') IS NOT NULL, to_regclass('public.student_skill_state') IS NOT NULL;
```

Then confirm via web:
- `curl https://alfanumrik.com/api/v1/health` — should still return ok=true.
- Quiz submission via /quiz page should NOT log `submit_quiz_results RPC failed`.

## Authorisation log

| Step | Authorised by | When |
|---|---|---|
| Edge function deploys (Phase 1) | "DO WHATEVER IT TAKES TO MAKE IT PRODUCTION GRADE" + per-function continue | 2026-04-27 13:30+ IST |
| Schema reconciliation Path 1 | "Path 1" | 2026-04-27 14:00+ IST |
