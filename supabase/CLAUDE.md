# Supabase Migrations

`supabase/migrations/` — root holds the `00000000000000_baseline_from_prod.sql` baseline plus the timestamped chain. **Count it, don't quote it** — this number drifts constantly (the root `CLAUDE.md` and `.claude/CLAUDE.md` had already drifted to two different wrong counts — 469 and 410 — before this file existed and was recounted fresh):

```
ls supabase/migrations/*.sql | wc -l                     # total incl. baseline
ls supabase/migrations/*.sql | sort | tail -1             # latest
find supabase/migrations/_legacy -name '*.sql' | wc -l    # pre-baseline legacy chain
```

As of 2026-08-01: **491 `.sql` files at root** (baseline + 490 timestamped), latest `20260801110100_cleanup_stale_board_score_predictions.sql`. The pre-baseline legacy chain (**359 files**) is archived under `_legacy/`, which `supabase db push` skips because the CLI only applies files at the immediate `supabase/migrations/` root.

Schema reproducibility P0 fix runbook: `docs/runbooks/schema-reproducibility-fix.md` — replaces the legacy chain with a pg_dump-derived idempotent baseline, pre-marked applied on prod and main-staging via `supabase migration repair` so the merge skips execution on those environments and only runs against fresh projects (CI live-DB tests, new staging, DR).

Every new table must have RLS enabled and policies in the same migration file (P8).
