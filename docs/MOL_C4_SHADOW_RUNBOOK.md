# MOL C4 Shadow Routing — Canary & Operations Runbook

**Status:** C4.2b-i shipped 2026-05-19. Default OFF on every environment.
**Owners:** ops (canary execution, kill switch) · ai-engineer (helper + grader code) · architect (schema, infra concerns)
**Related:**
- Architecture: `docs/MOL_ARCHITECTURE.md`
- Operations index: `docs/MOL_OPERATIONS.md`
- Code: `supabase/functions/grounded-answer/mol-shadow.ts`, `supabase/functions/_shared/mol/grader.ts`, `supabase/functions/_shared/mol/grader-cron.ts`
- Migrations: `supabase/migrations/20260519000001_mol_shadow_routing.sql`, `20260519000002_mol_shadow_flag_seed.sql`, `20260519000003_mol_request_health_24h.sql`

---

## 1. What ships

| Component | File | What it does |
|---|---|---|
| Shadow helper | `supabase/functions/grounded-answer/mol-shadow.ts` | Fires a parallel OpenAI call on every in-allow-list grounded-answer LLM invocation. Discards the response, persists the row for grading. |
| Wire-up | `supabase/functions/grounded-answer/pipeline.ts`, `pipeline-stream.ts` | Calls `fireShadowAndForget(...)` after the baseline Claude call returns. |
| Baseline tag | `supabase/functions/grounded-answer/mol-telemetry-adapter.ts` | Every baseline row is now stamped `shadow_role='baseline'` (C4.2b-i fix). |
| Pair view | `mol_shadow_pairs_v1` (in `20260519000001_mol_shadow_routing.sql`) | JOIN of baseline ↔ shadow rows by `request_id`. |
| Health view | `mol_request_health_24h` (in `20260519000003_mol_request_health_24h.sql`) | Hourly rollup sliced by provider × task_type × shadow_role. |
| Grader cron | `gradeMolShadowPairs` step in `supabase/functions/daily-cron/index.ts` | Stratified-sample shadow rows, call Sonnet grader, write score onto the shadow row. **Scaffold mode until C4.2b-ii lands text capture.** |
| Flag | `ff_grounded_answer_mol_shadow_v1` (`20260519000002_mol_shadow_flag_seed.sql`) | Default `enabled=false`, `rollout_pct=0`. |

---

## 2. Pre-flip checklist

Run all checks against the target environment BEFORE flipping the flag. Stop at the first failure.

1. **Migrations applied.**
   ```sql
   select count(*) from pg_views where viewname in ('mol_shadow_pairs_v1', 'mol_request_health_24h');
   -- expected: 2
   select column_name from information_schema.columns
    where table_name='mol_request_logs' and column_name in ('shadow_of_request_id','shadow_role','shadow_grader_score','shadow_grader_payload','shadow_graded_at','trace_id');
   -- expected: 6 rows
   ```

2. **Edge functions deployed.**
   ```bash
   supabase functions list | grep -E '(grounded-answer|daily-cron)'
   # both should appear with recent updated_at
   ```

3. **24h of baseline data exists.**
   ```sql
   select count(*) from public.mol_request_logs
    where shadow_role = 'baseline'
      and created_at > now() - interval '24 hours';
   -- expected: > 100 (canary needs a denominator to compare against)
   ```
   If this returns 0, verify `ff_grounded_answer_mol_telemetry_v1` is enabled and the C3 adapter is writing rows.

4. **Flag row exists, disabled.**
   ```sql
   select flag_name, is_enabled, metadata
     from public.feature_flags
    where flag_name = 'ff_grounded_answer_mol_shadow_v1';
   -- expected: is_enabled=false, metadata.enabled=false, metadata.rollout_pct=0
   ```

5. **OpenAI key configured.** Confirm `OPENAI_API_KEY` is set in Supabase Edge secrets (Settings → Functions → Secrets). Without it, `shadowFireOpenAI` short-circuits silently.

6. **Anthropic Sonnet key configured for the grader.** `ANTHROPIC_API_KEY` (same key the primary Haiku call uses). The grader uses Sonnet via the same key.

---

## 3. CRITICAL: env-level gate clarification

The flag has TWO independent "environment" gates and they do NOT mean the same thing:

- `feature_flags.target_environments` — array of env names. The seed migration sets `['staging', 'production']`.
- `feature_flags.metadata.enabled` — boolean inside the JSON envelope.

**`metadata.enabled` is the actual gate.** The shadow helper reads the envelope via `getFlagEnvelope`; `target_environments` is consulted only by `isFlagEnabled` (used elsewhere). Flipping `metadata.enabled=true` enables the shadow in EVERY environment that has the row, regardless of `target_environments`.

If you need staging-only enablement, ramp `metadata.rollout_pct` BEFORE flipping production. The flag row is global; there is no per-environment override.

Same caveat applies to `metadata.kill_switch=true`: it kills the shadow in EVERY environment that has the row.

---

## 4. Flip-to-canary procedure

Target: 5% of `doubt_solving` traffic on staging first, then production after 24h of clean staging telemetry.

### Step 1 — Staging at 5%

```sql
-- Edit the metadata envelope. `enabled=true` + `rollout_pct=5` together
-- mean: of in-allow-list calls, hash-bucket-sample 5% to fire the shadow.
update public.feature_flags
   set metadata = metadata
     || jsonb_build_object(
          'enabled', true,
          'rollout_pct', 5,
          'kill_switch', false
        ),
       is_enabled = true,
       updated_at = now()
 where flag_name = 'ff_grounded_answer_mol_shadow_v1';
```

The in-process feature-flag cache TTL is 5 minutes. Wait 5 min, then verify with the queries in section 5.

### Step 2 — Ramp gates

| Gate | Stage | Quality criteria to pass before the next ramp |
|---|---|---|
| G1 | 5% staging | 24h with shadow rows ≈ 5% of baseline; failure rate ≤ 1%; p95 shadow latency ≤ p95 baseline + 50% |
| G2 | 25% staging | 48h with G1 criteria + Sonnet grader has scored ≥ 50 pairs (post-C4.2b-ii); no kill-switch trips |
| G3 | 50% staging | 24h with G2 criteria + daily INR cost ≤ ₹2,500 (10x baseline floor); shadow win-rate not zero |
| G4 | 100% staging | 24h with G3 criteria; no operator escalations |
| G5 | 5% production | 24h with G4 criteria + production baseline volume > 1,000 rows/day |
| G6 → 100% | 25% → 50% → 100% production | 24h between each; same per-gate criteria as staging |

Total ramp time staging → 100% production: ~5 days nominal.

---

## 5. What to monitor (queries)

All queries below use the new `mol_request_health_24h` view where possible.

### 5.1 Shadow row volume vs baseline

```sql
select hour, task_type, shadow_role, n_requests
  from public.mol_request_health_24h
 where shadow_role in ('baseline', 'shadow')
   and task_type in ('explanation','concept_explanation','doubt_solving','step_by_step')
 order by hour desc, task_type, shadow_role;
```
Expected: `n_requests(shadow) / n_requests(baseline)` ≈ `rollout_pct` for each in-allow-list task_type.

### 5.2 p95 latency comparison

```sql
select hour, task_type, shadow_role, p95_latency_ms
  from public.mol_request_health_24h
 where shadow_role in ('baseline','shadow')
 order by hour desc, task_type, shadow_role;
```
Expected: shadow p95 should NOT exceed baseline p95 by more than 50% steady-state. Spikes above 2× are the canary signal to investigate OpenAI rate-limit / quota issues.

### 5.3 Fallback rate

```sql
select hour, provider, task_type, shadow_role,
       n_requests,
       n_failures,
       round(100.0 * n_failures / nullif(n_requests, 0), 2) as failure_pct
  from public.mol_request_health_24h
 where shadow_role = 'shadow'
 order by hour desc;
```
Expected: shadow `failure_pct` ≤ 5% per hour. A sustained spike implies OpenAI provider trouble — verify via OpenAI status page.

### 5.4 Daily shadow cost (the kill-switch trigger)

```sql
select date_trunc('day', created_at) as day,
       sum(inr_cost) as inr_cost_sum,
       count(*) as rows
  from public.mol_request_logs
 where shadow_role = 'shadow'
   and created_at > now() - interval '7 days'
 group by 1
 order by 1 desc;
```
The grader cron flips `kill_switch=true` when today's `inr_cost_sum` exceeds ₹10,000 (`GRADER_DAILY_COST_CAP_INR` in `grader.ts`).

### 5.5 Pair coverage (mol_shadow_pairs_v1 returning rows)

```sql
select task_type, count(*) as pair_count
  from public.mol_shadow_pairs_v1
 where created_at > now() - interval '24 hours'
 group by 1
 order by 2 desc;
```
Expected: non-zero rows for every task_type in the C4 allow-list within 24h of the flag flip.

If this returns ZERO while shadow rows exist in `mol_request_logs`, the most likely cause is the C3 adapter writing baseline rows with `shadow_role=NULL` (pre-C4.2b-i bug). Re-verify the C3 adapter ships the fix from `mol-telemetry-adapter.ts:213`.

### 5.6 Grader cron sample coverage (post-C4.2b-ii)

```sql
select task_type,
       count(*)                       filter (where shadow_grader_score is null)  as ungraded,
       count(*)                       filter (where shadow_grader_score is not null) as graded,
       avg(shadow_grader_score)::numeric(4,3) as avg_score
  from public.mol_request_logs
 where shadow_role = 'shadow'
   and created_at > now() - interval '48 hours'
 group by 1
 order by 1;
```
Until C4.2b-ii lands response_text capture, `graded` will always be 0 (the cron correctly takes the `skipped_no_text` branch). The cron's stdout in Vercel logs reports `skipped_no_text=N` per night.

---

## 6. Kill switch procedure

When to fire the kill switch:
- Shadow `failure_pct` > 10% sustained for one hour
- Shadow p95 latency > 2× baseline sustained
- Daily INR cost > ₹10,000 (the cron does this automatically; the manual procedure is for the in-flight ramp)
- Any operator escalation

### Manual flip (preferred when ops is in the loop):

```sql
update public.feature_flags
   set metadata = metadata || jsonb_build_object('kill_switch', true),
       updated_at = now()
 where flag_name = 'ff_grounded_answer_mol_shadow_v1';
```

### Automated flip (the grader cron does this on cost overrun):

The daily-cron's `gradeMolShadowPairs` step sums `inr_cost` for `shadow_role='shadow' AND created_at::date = today`. If `> ₹10,000`, it flips `metadata.kill_switch=true` and exits before doing any grading work.

### TTL: 5 minutes.

The shadow helper reads `feature_flags` via the `getFlagEnvelope` path; the in-process cache has TTL = 5 minutes (see `supabase/functions/_shared/mol/feature-flag.ts`). Allow up to 5 min after the UPDATE for every Edge worker to pick up the new envelope. After 5 min, `mol_request_health_24h` should show shadow row volume dropping toward zero.

### Verifying the kill landed:

```sql
select metadata from public.feature_flags where flag_name='ff_grounded_answer_mol_shadow_v1';
-- expected: { ..., kill_switch: true, ... }

-- 5 min after the flip, the per-minute shadow row count should collapse:
select date_trunc('minute', created_at) as min, count(*)
  from public.mol_request_logs
 where shadow_role = 'shadow' and created_at > now() - interval '15 minutes'
 group by 1
 order by 1 desc;
```

---

## 7. Rollback procedure

Triggered when kill switch alone is insufficient (e.g. a real bug in `mol-shadow.ts` that fires shadows OUTSIDE the gate).

1. **Flip the flag fully off (column + envelope).**
   ```sql
   update public.feature_flags
      set is_enabled = false,
          metadata   = metadata || jsonb_build_object('enabled', false, 'kill_switch', true, 'rollout_pct', 0),
          updated_at = now()
    where flag_name = 'ff_grounded_answer_mol_shadow_v1';
   ```

2. **Wait 5 minutes** for the flag cache to expire on every Edge worker.

3. **Confirm no shadow rows are landing.**
   ```sql
   select count(*) from public.mol_request_logs
    where shadow_role = 'shadow' and created_at > now() - interval '5 minutes';
   -- expected: 0
   ```

4. **If shadows still fire** (indicating a code-level bug bypassing the gate), force a redeploy of `grounded-answer`:
   ```bash
   supabase functions deploy grounded-answer
   ```
   This restarts every worker and re-reads the flag from scratch.

5. **Post-incident:** open an issue with the 24h `mol_request_health_24h` rollup and the `failure_chain` distribution from the affected shadow rows. The C5 design will use this signal to decide whether to swap providers (e.g. gpt-4o-mini → gpt-4o).

---

## 8. Test plan post-flip

After each ramp gate, run:

| Test | Where | Pass criteria |
|---|---|---|
| `npm test -- mol-telemetry-adapter mol-shadow grader grader-cron` | local | all green |
| Manual smoke: ask a doubt_solving question on staging | grounded-answer | response served by Claude as before; latency unchanged |
| Pair view returns rows | staging SQL console | section 5.5 returns N > 0 |
| Health view sliced by role | staging SQL console | section 5.1 shows both baseline + shadow rows |

---

## 9. Known gaps (deferred to follow-ups)

| Gap | Tracker | Notes |
|---|---|---|
| Response text capture for grader | C4.2b-ii | The grader cron is in scaffold mode — every sampled pair reports `skipped_no_text`. The text-storage decision (column vs Redis vs ephemeral table) has P13 (PII) implications and needs its own design review. |
| Super-admin UI for shadow pairs | C4.2b-ii | The view + grader exist; the dashboard surfacing them does not. Until then, ops queries the views directly. |
| `newMolRequestId` dedupe | C4.2b-ii | Cosmetic — when the shadow helper crafts a synthetic request_id for the orchestrator's auto-log, the auto-log row may carry that id rather than the baseline's. Tracked separately. |
| OpenAI date-pinning | C5 | gpt-4o-mini is currently un-pinned. Date-pin in C5 to lock the comparator semantics. |
| Adding `grounding_check` / `quiz_generation` to the shadow allow-list | C5 | Today only 4 task_types are graded. After C4.2b-i canary lands, C5 evaluates whether expanding the allow-list is useful. |
