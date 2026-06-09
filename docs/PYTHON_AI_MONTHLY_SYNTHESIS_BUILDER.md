# Python AI — monthly-synthesis-builder port

Phase 2 continued — port of `supabase/functions/monthly-synthesis-builder/index.ts`
to Python FastAPI on Cloud Run (Mumbai, asia-south1). Default OFF.

## Architecture

```
                   ┌──────────────────┐
   pg_cron /       │ Edge Function    │   (default OFF)
   daily-cron ───► │ proxy block      │ ──ff_python_monthly_synthesis_builder_v1──┐
   internal call   │ (TS)             │                                            │
                   └────────┬─────────┘                                            │
                            │ fall-through on any failure                          │
                            ▼                                                      ▼
                   ┌──────────────────┐                              ┌──────────────────────┐
                   │ Legacy TS bundle │                              │ Cloud Run Python     │
                   │ builder (verbatim│                              │ /v1/monthly-synthesis│
                   │ TS handler)      │                              │ -builder             │
                   └────────┬─────────┘                              └──────────┬───────────┘
                            │                                                   │
                            └────────────┬──────────────────────────────────────┘
                                         ▼
                              ┌──────────────────────┐
                              │ monthly_synthesis_   │
                              │ runs (UNIQUE on      │
                              │ student_id +         │
                              │ synthesis_month)     │
                              └──────────────────────┘
```

## What's ported

The Python module reproduces the TS pipeline byte-for-byte:

1. **Cron-secret auth** (`auth.py`) — `hmac.compare_digest` constant-time
   match against `CRON_SECRET` env. 401 on mismatch, 503 on missing env.
2. **Idempotency lookup** (`repository.fetch_existing_run`) — short-circuits
   to the existing row's `id` + `bundle` with `alreadyExists=True`.
3. **Aggregate** — three concurrent Supabase reads:
   - `dive_artifacts.id` for the month window
   - `concept_mastery` rows touched in the month
   - `curriculum_topics` titles for the touched topic ids
4. **Bundle build** (`bundle.py`) — pure transformations matching TS
   constants verbatim (REG-100 pins these).
5. **Insert** — single `INSERT INTO monthly_synthesis_runs` with empty
   bilingual summaries (Next.js side fills lazily). PostgreSQL 23505
   unique_violation handled as `alreadyExists=True`.
6. **Response** — `BuildResponse` matching TS wire-shape exactly.

## What's NOT ported (kept on the Next.js side)

- **Claude summary generation** lives in
  `src/lib/ai/workflows/synthesis-summary.ts` and runs lazily at first
  parent view via `/api/synthesis/state`. The TS Edge function never
  emitted an LLM call either — this is by design (prompt logic stays
  next to the consumer).
- **Cron scheduling** lives in pg_cron + `daily-cron` Edge Function.

## Rollout playbook

| Step | Owner | Action |
|---|---|---|
| 1 | architect | Apply migration `20260609100000_python_monthly_synthesis_builder_flag.sql` (default OFF) |
| 2 | architect | Cloud Run deploy via `gcloud builds submit` — new revision picks up the new route |
| 3 | architect | Smoke `POST /v1/monthly-synthesis-builder` with a real `x-cron-secret` against a known student+month → expect 200 with `alreadyExists: true` if previously built |
| 4 | ops | Bump `ff_python_monthly_synthesis_builder_v1.rollout_percentage` to 10 via Supabase SQL Editor |
| 5 | ops | Watch `mol_request_logs` + Sentry for 24h; compare latency + error rate vs TS baseline |
| 6 | ops | 10 → 25 → 50 → 100 over 24-48h if green |

## Kill switches (any of these reverts to 100% TS)

```sql
-- Layer 1: kill_switch (highest priority, takes precedence over enabled)
UPDATE public.feature_flags
SET metadata = metadata || jsonb_build_object('kill_switch', true)
WHERE flag_name = 'ff_python_monthly_synthesis_builder_v1';

-- Layer 2: disable the flag entirely
UPDATE public.feature_flags
SET is_enabled = false,
    metadata = metadata || jsonb_build_object('enabled', false)
WHERE flag_name = 'ff_python_monthly_synthesis_builder_v1';

-- Layer 3: rollback rollout to 0%
UPDATE public.feature_flags
SET rollout_percentage = 0,
    metadata = metadata || jsonb_build_object('rollout_pct', 0)
WHERE flag_name = 'ff_python_monthly_synthesis_builder_v1';
```

All three layers can be flipped without redeploying anything — the Edge
function reads the envelope on every request.

## REG-100 catalog pin

See `.claude/regression-catalog.md` for the contract surface:
- Constants match TS byte-for-byte
- Wire-shape camelCase parity with Next.js consumer
- Pure logic parity (month bounds, mastery counters, chapter caps)
