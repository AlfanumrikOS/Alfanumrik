# coverage-audit

Nightly reconciliation of grounding coverage. Spec §8.2.

## What it does per run

1. **Drift correction** — calls `recompute_syllabus_status(grade, subject, chapter)` for every row in `cbse_syllabus` (scope = in-scope). The triggers normally keep `rag_status` correct, but manual writes or failed-trigger scenarios can leave stale values.
2. **Snapshot** — writes today's `cbse_syllabus` state to `coverage_audit_snapshots` (one row per IST day; UNIQUE `snapshot_date` makes same-day reruns idempotent).
3. **Regression detection** — compares today's rag_status to yesterday's snapshot. Any pair that dropped (`ready → partial/missing`, `partial → missing`) emits an `ops_events` row at `severity=error` with the full regression list.
4. **Auto-disable enforcement** — for each row in `ff_grounded_ai_enforced_pairs` where `enabled=true`, computes `verified_ratio = sum(verified_question_count) / sum(total_questions_in_chapter)` across the pair's chapters. If ratio < **0.85**, flips the pair `enabled=false`, records `auto_disabled_at`/`auto_disabled_reason`, and emits an error event.
5. **Purge old traces** — calls `purge_old_grounded_traces()` (retention: `grounded=true`>90d, `grounded=false`>180d).
6. **Summary event** — emits `grounding.coverage.audit_complete` with the full snapshot stats + run timing.

## Idempotency

- `coverage_audit_snapshots.snapshot_date` is `UNIQUE`; the upsert uses `onConflict=snapshot_date` so a same-day rerun **overwrites** the snapshot rather than duplicating.
- Yesterday lookup takes the **second-most-recent** snapshot when today's row already exists, preserving regression math across reruns.
- Auto-disable only touches pairs that are still `enabled=true`, so repeating the run is a no-op.

## Schedule (ops/user action required)

Not scheduled automatically. Configure once after deploy:

```bash
# 03:00 IST every night = 21:30 UTC
supabase functions schedule coverage-audit --cron "30 21 * * *"
```

## Local dev

```bash
supabase functions serve coverage-audit --env-file .env.local
curl -X POST http://localhost:54321/functions/v1/coverage-audit \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

## Environment

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Platform URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (reads syllabus, writes snapshots, flips flags, calls RPCs) |

## Related files

- Spec: `docs/superpowers/specs/2026-04-17-rag-grounding-integrity-design.md` §8.2
- Migration: `supabase/migrations/20260418101200_coverage_audit_helpers.sql`
- Pure logic: `supabase/functions/coverage-audit/shared.ts`
- Unit tests: `src/__tests__/coverage-audit-logic.test.ts`
- Related table: `ff_grounded_ai_enforced_pairs` (`supabase/migrations/20260418100800_feature_flags.sql`)
- Purge RPC: `purge_old_grounded_traces` in `supabase/migrations/20260418100300_grounded_ai_traces.sql`

## Ops rollback

If auto-disable fires incorrectly (e.g. a verifier outage tanked the ratio):

```sql
UPDATE ff_grounded_ai_enforced_pairs
SET enabled = true,
    auto_disabled_at = NULL,
    auto_disabled_reason = NULL
WHERE grade = '10' AND subject_code = 'science';
```

Then address the upstream cause. The audit will re-evaluate tomorrow — if the ratio still lags, it will auto-disable again (expected).