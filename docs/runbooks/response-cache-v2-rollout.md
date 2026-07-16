# Response-Cache v2 — Rollout Runbook

**Date:** 2026-07-16
**Status:** Pre-rollout. All four flags seeded OFF; no environment enabled yet. This runbook satisfies assessment's Condition 4 — no serving flag may flip ON before this document exists and its prerequisites are green.
**Flags:** `ff_foxy_response_cache_l2_shadow_v1` (shadow/observe-only), `ff_foxy_response_cache_l2_v1` (Foxy serving), `ff_response_cache_serve_ncert_v1` (ncert-solver serving — seed `20260716090200`), `ff_ncert_solver_solution_store_v1` (durable L3 — seed `20260716090300`). All default `is_enabled=false, rollout_percentage=0`.
**Data layer:** `rag_content_versions` (migration `20260716090000`), `ncert_solver_solutions` (migration `20260716090100`), dedicated cache-only Upstash Redis instance (`rag:cache:v2:*` keys)
**Regression pins:** REG-264..REG-269 (`.claude/regression-catalog.md` — authoritative wording)
**Owner:** ops (this runbook + flip procedure) · ai-engineer (pipeline: `supabase/functions/grounded-answer/`) · architect (schema/flag seeds, Redis provisioning review) · assessment (Condition 4 gate + wrong-solution correction sign-off)

## What this controls

The shared response cache in front of the grounded-answer pipeline (Foxy Next.js route + ncert-solver Edge Function both call it). Three tiers:

- **L1** — in-process memory, 5 min TTL, per Edge instance (pre-existing).
- **L2** — dedicated cache-only Upstash Redis, shared across instances/regions. Per-caller TTLs: foxy **20 min**, ncert-solver **24 h** (`cache-redis.ts`).
- **L3** — durable `ncert_solver_solutions` table (ncert-solver only). **No TTL by design** — invalidation is entirely `content_version` + `gen_ctx` keying. Do not add a TTL sweep.

v2 key = `rag:cache:v2:<grade>:<subject>:<mode>:<caller>:<sha256(normalized query)>:<gen_ctx fragment>`. The `gen_ctx` hash folds in everything that changes generation for the same text (prompt template + `PROMPT_REV`/`MODEL_ROUTE_REV`, model preference, max_tokens, temperature, template_variables, conversation_turns, per-scope content_version) — this is the fix for the v1 production bug where Foxy learn/practice/quiz_me turns collided on one key. Every read re-validates the FULL stored tuple (REG-264).

Safety properties that hold regardless of what this runbook flips:

- **Fail-open cache, fail-closed flags.** Missing/erroring Redis = miss (pipeline runs normally, REG-264/REG-267). Unreadable `feature_flags` = all four flags OFF (`_l2-cache-flags.ts`).
- **`cache_scope` is caller-declared and fail-closed** (REG-266): only `cache_scope:'shared'` requests touch any tier. ncert-solver is always shared (personalization-free by construction); Foxy declares shared only for cold-start turns with zero personalization sections. Personalized turns can never be written to or served from the shared cache.
- **Quota is consumed BEFORE the cache is consulted** (REG-265) — a cache hit saves tokens/latency, never a daily-limit unit. Do not expect quota-usage metrics to move when hit-rate rises.
- Abstains are never cached; only `grounded:true` responses are stored.

## Flag registry and semantics

| Flag | Gates | Seed |
|---|---|---|
| `ff_foxy_response_cache_l2_shadow_v1` | Shadow/observe-only mode: L2 lookup runs and logs `cache_l2_shadow_hit` ("would have hit") but NEVER serves. Writes DO happen in shadow (that is how the cache warms and hit-rate accumulates). Never short-circuits, so it cannot affect the REG-50 single-retrieval contract. | pre-v2 (L2 v1 wave) |
| `ff_foxy_response_cache_l2_v1` | REAL L2 serving for caller `foxy`. On hit: short-circuit, backfill L1, zero retrieval calls, zero new trace rows. | pre-v2 (L2 v1 wave) |
| `ff_response_cache_serve_ncert_v1` | REAL cache serving for caller `ncert-solver` (its own lane — 24 h TTL). OFF = ncert-solver is byte-identical to pre-v2 (full regeneration every request). | `20260716090200` |
| `ff_ncert_solver_solution_store_v1` | The durable L3 tier (`ncert_solver_solutions`): gates the L3 write-back on its own; the L3 lookup (after an L2 miss, strictly before retrieval) additionally requires the caller's serving flag (`ff_response_cache_serve_ncert_v1`) — store-ON alone warms the table without serving from it. OFF = the table is fully inert — never read, never written (REG-269c). | `20260716090300` |

**Independence (deliberate — do not "simplify" into one flag):** the store flag and the ncert serving flag ramp independently, so the L3 store can warm before serving flips ON, and serving can be killed without discarding the store. Every other caller has no serve lane and is fail-closed (`isL2CacheServingEnabledForCaller`).

**Edge-reader flip semantics — READ THIS BEFORE FLIPPING.** These four flags are read by the grounded-answer Edge Function via `_l2-cache-flags.ts`, which checks **`is_enabled === true` only**:

- `rollout_percentage` is **ignored** by this reader. There is no percentage ramp for these flags — `is_enabled=true` means 100% of shared-scope traffic in that database's environment. The `rollout_percentage=0` in the seeds is REG-125 shape conformance, not a live gate.
- `target_environments` / `target_roles` / `target_institutions` are **ignored** by this reader. "Staging first" means flipping the flag row **in the staging Supabase project's database**, not env-scoping a shared row.
- Propagation: 60 s in-process memo per Edge instance (`FLAG_CACHE_TTL_MS`). Treat every flip as taking up to ~1 minute to fully propagate.
- Prefer the super-admin console (`/super-admin/flags` → PATCH `/api/super-admin/feature-flags`) for every flip — admin audit entry + `ops_events` row. SQL below is break-glass only.

## Prerequisites (must all be true before any flag flip)

- [ ] **Dedicated cache-only Upstash Redis DB provisioned** — Mumbai (ap-south / co-located with bom1 + Supabase), eviction policy `allkeys-lru` is acceptable **for this instance only**. It MUST be a **separate database from the existing rate-limiter/session instance**, which is `noeviction` and security-critical (`rl:*` / `sess:valid:*` keys). Never point the cache pair at that instance: a cache workload filling a noeviction DB starts failing rate-limiter WRITES — a security regression. The code enforces the split (REG-267: no fallback from the cache pair to `UPSTASH_REDIS_REST_URL/_TOKEN`), but provision it correctly anyway.
- [ ] **Secrets set on the Edge Function runtime** — grounded-answer is a Deno Edge Function, so the pair goes in Supabase Edge Function secrets (NOT Vercel env):
  ```bash
  supabase secrets set UPSTASH_CACHE_REDIS_REST_URL=<cache-instance-url> \
                       UPSTASH_CACHE_REDIS_REST_TOKEN=<cache-instance-token>
  ```
  Set per environment (staging project first). Absent secrets are safe: the cache degrades to a permanent miss (fail-open) — nothing breaks, you just get no hits. Verify with `supabase secrets list`.
- [ ] Migrations applied to the target environment:
  ```sql
  SELECT to_regclass('public.rag_content_versions'), to_regclass('public.ncert_solver_solutions');
  -- expect: both non-null

  SELECT polname FROM pg_policies WHERE tablename = 'rag_content_versions';
  -- expect exactly: rag_content_versions_service_all
  SELECT polname FROM pg_policies WHERE tablename = 'ncert_solver_solutions';
  -- expect the service-only policy and nothing else (default-deny is the design)

  SELECT flag_name, is_enabled, rollout_percentage FROM feature_flags
  WHERE flag_name IN ('ff_foxy_response_cache_l2_shadow_v1','ff_foxy_response_cache_l2_v1',
                      'ff_response_cache_serve_ncert_v1','ff_ncert_solver_solution_store_v1');
  -- expect: 4 rows, all is_enabled = false
  ```
- [ ] grounded-answer Edge Function redeployed with the v2 modules (`gen-ctx.ts`, `cache-redis.ts`, `cache-durable.ts`, `cache-telemetry.ts`, `_content-version.ts`, `_l2-cache-flags.ts`).
- [ ] The four ingestion writers (`embed-ncert-qa`, `embed-questions`, `generate-embeddings`, `extract-ncert-questions`) redeployed with the `bumpRagContentVersion` call (REG-268a) — without this, content re-ingestion will NOT invalidate cached answers.
- [ ] Know your log posture: all cache telemetry is structured `console.warn` from the grounded-answer Edge Function — it lands in **Supabase Edge Function logs**, not Vercel logs and not the event bus. Confirm you can query them (Supabase log explorer) before starting the shadow phase, or the shadow phase produces nothing you can read.
- [ ] Sentry capturing errors for the grounded-answer function and `/api/foxy`.

## Rollout phases

### Phase 1 — shadow (observe-only, 1–2 weeks)

Flip **only** the shadow flag (staging first, then production — shadow is safe in production because it never serves):

```sql
-- break-glass SQL; prefer the super-admin console
UPDATE feature_flags SET is_enabled = true, updated_at = now()
WHERE flag_name = 'ff_foxy_response_cache_l2_shadow_v1';
```

All serving flags stay OFF. The pipeline now performs L2 lookups + writes for shared-scope requests from BOTH callers, logs `cache_l2_shadow_hit` on would-have-hits, and always falls through to full generation. Zero user-visible change.

Run 1–2 weeks. Read the counters from Edge Function logs, grouped **by caller** (dims: `caller`, `grade`, `subject`, `tokens_avoided`):

```
shadow hit-rate (per caller) = cache_l2_shadow_hit / (cache_l2_shadow_hit + cache_l2_miss)
projected token savings      = sum(tokens_avoided) over cache_l2_shadow_hit events
```

Note when interpreting Foxy's number: only `cache_scope:'shared'` turns (cold-start, zero personalization) ever reach the cache, so Foxy's shadow rate is over its *eligible* subset — that is exactly the "eligible-and-hitting" number the Phase 3 kill criterion is defined on.

### Phase 2 — serve ncert-solver (per-caller, first real serving)

**Gate:** proceed ONLY if the Phase 1 shadow hit-rate for caller `ncert-solver` is **≥ ~20%**. Below that, the cache is not paying for its operational surface on the solver — hold in shadow, or revisit sizing with ai-engineer.

Staging first; let it soak, verify `cache_l2_hit` events appear with `caller: ncert-solver` and solver answers are correct (spot-check a handful against fresh regenerations). Then production:

```sql
UPDATE feature_flags SET is_enabled = true, updated_at = now()
WHERE flag_name = 'ff_response_cache_serve_ncert_v1';
```

Foxy serving remains OFF. Hold ≥ 1 week watching the Monitoring section signals before Phase 3.

### Phase 3 — Foxy decision point

Evaluate the Foxy shadow numbers against the CEO-approved kill criterion, which is binding and quoted verbatim:

> **"if Foxy shadow shows <5% eligible-and-hitting, Foxy response caching is permanently dropped — no escalation to riskier schemes"**

- **< 5% eligible-and-hitting:** Foxy response caching is **permanently dropped**. Leave `ff_foxy_response_cache_l2_v1` OFF forever, flip the shadow flag OFF, and record the decision (ops note + flag description update). Do NOT propose loosening `cache_scope`, extending TTLs, or caching personalized turns to chase a better rate — that is the "riskier schemes" escalation the criterion forbids.
- **≥ 5%:** flip `ff_foxy_response_cache_l2_v1` ON (staging → production, same procedure as Phase 2). Foxy's lane serves with the 20-min TTL.

### Phase 4 — durable L3 (ncert-solver solution store)

Behind its own flag, after Phase 2 is stable (the store flag MAY be flipped earlier than serving to pre-warm the table — the independence is designed for exactly that):

```sql
UPDATE feature_flags SET is_enabled = true, updated_at = now()
WHERE flag_name = 'ff_ncert_solver_solution_store_v1';
```

Effects: after an L2 miss the pipeline consults `ncert_solver_solutions` (strictly before retrieval — an L3 hit performs zero retrieval calls, zero new trace rows, zero model calls, and backfills L1+L2, REG-269); fresh solves are upserted keyed on `(grade, subject_code, question_hash, gen_ctx_hash)` with the write-time `content_version`. Rows are question-keyed only — no student column exists in the schema (P13, REG-269d).

Watch table growth and `cache_l3_hit` volume for 2 weeks before declaring v2 shipped:

```sql
SELECT count(*), min(created_at), max(created_at) FROM ncert_solver_solutions;
SELECT grade, subject_code, count(*) FROM ncert_solver_solutions GROUP BY 1,2 ORDER BY 3 DESC LIMIT 15;
```

## Correcting a wrong cached NCERT solution (P6/P12)

If a cached solver answer is found to be wrong (pedagogically incorrect, out-of-scope, or grounded on bad content), escalate to assessment for the content verdict, then invalidate. Three levers, in order:

### 1. Normal path — content re-ingestion (automatic)

Fixing the underlying content and re-running the affected ingestion function (`embed-ncert-qa` / `embed-questions` / `generate-embeddings` / `extract-ncert-questions`) auto-bumps `rag_content_versions` for the (grade, subject) scope (REG-268a). Nothing else to do.

### 2. Manual operator bump (invalidate without re-ingesting)

When you need the stale answers gone NOW (or the fix isn't an ingestion run), bump the scope's version by hand — this is the contract SQL from migration `20260716090000`:

```sql
INSERT INTO rag_content_versions (grade, subject_code, version)
VALUES ('<grade>', '<subject_code>', 1)          -- e.g. ('10', 'science', 1)
ON CONFLICT (grade, subject_code)
DO UPDATE SET version = rag_content_versions.version + 1;
```

Use P5 short grades (`'6'`..`'12'`) and snake_case subject codes (`math`, `science` — check the `subjects` table). Effect: `content_version` is a gen_ctx component, so the bump rotates the cache key for the whole scope — **ALL THREE tiers invalidate within ~60 s** (the pipeline's per-scope version memo TTL, `_content-version.ts`): L1 and L2 keys stop matching, and L3 lookups require `stored content_version = current version`, so every stale L3 row becomes a miss and is superseded in place on the next fresh solve (REG-268c). Old L2 entries age out via TTL; stale L3 rows are inert and overwritten by the ON CONFLICT upsert.

Audit the L3 footprint before/after if you want confirmation:

```sql
SELECT content_version, count(*) FROM ncert_solver_solutions
WHERE grade = '<grade>' AND subject_code = '<subject_code>'
GROUP BY 1 ORDER BY 1;
```

### 3. Emergency full stop

Flip the serving flags OFF (console preferred):

```sql
UPDATE feature_flags SET is_enabled = false, updated_at = now()
WHERE flag_name IN ('ff_response_cache_serve_ncert_v1', 'ff_foxy_response_cache_l2_v1');
```

This is an **instant drain** — every cache READ is flag-gated, so within ≤60 s (flag memo TTL) no cached response is served anywhere; every request regenerates. No data is discarded: L2 entries age out on TTL, L3 rows sit inert (and survive for a later re-enable — killing serving without discarding the store is the designed independence). Cost of the stop is regeneration spend/latency only.

### Nuclear — namespace bump (code change)

If key-level invalidation itself is suspect (key-derivation bug, cross-scope contamination): bump `REDIS_CACHE_NAMESPACE` in `supabase/functions/grounded-answer/cache-redis.ts` from `rag:cache:v2` → `rag:cache:v3` and redeploy. Every existing Redis entry is orphaned instantly (ages out via TTL on the old prefix). This is an ai-engineer code change + Edge deploy, not an ops flip — pair it with the emergency stop above while it ships. The L3 equivalent, if ever needed, is a `PROMPT_REV` bump (rotates gen_ctx for everything) or, as a last resort, a scoped service-role `DELETE FROM ncert_solver_solutions WHERE grade = … AND subject_code = …` (safe — it is a cache, not a ledger).

## Monitoring / observability

All counters are structured `console.warn` lines in the **grounded-answer Edge Function logs** (Supabase log explorer). Metric names are a closed enum; dims are whitelisted and PII-free (REG-269 telemetry pin — anything smuggled onto the dims object is dropped, and the emission can never match `/name|email|phone|message|answer/i`).

| Metric | Meaning | Dims |
|---|---|---|
| `cache_l2_hit` | L2 served (serving flag ON for the caller) | caller, grade, subject, tokens_avoided |
| `cache_l2_miss` | Shared-scope request, no usable L2 entry | caller, grade, subject |
| `cache_l2_shadow_hit` | Shadow mode: would have hit, NOT served | caller, grade, subject, tokens_avoided |
| `cache_l3_hit` | Durable L3 served (ncert-solver only) | caller, grade, subject, tokens_avoided |

**Rename notice:** the v1 counter `cache_shadow_hit` no longer exists anywhere in the codebase — any dashboard, saved log query, or alert built on the old name silently reads zero and MUST be repointed to `cache_l2_shadow_hit`.

### Warn events to alert on

- **`cache_ineligible_content_version_error`** (grounded-answer `pipeline.ts`) — fires when the `rag_content_versions` read errors; the pipeline marks the request cache-ineligible (no read, no write, all tiers) for up to 60 s per scope per instance. Occasional blips are the safe-degrade working as designed. **Sustained firing means the version table is unreadable and caching has effectively self-disabled** — you are paying full regeneration on every request while believing the cache is on. Check the table, RLS/grants, and DB health; hit-rate dashboards will show a cliff at the same moment.
- **`rag_content_version_subject_heuristic_fallback`** (ingestion, `_shared/rag-content-version.ts`) — fires when an ingestion run's subject string is unknown to the `subjects` table and the bump falls back to a lowercase/underscore heuristic. A mis-normalized `subject_code` means the cache reader never sees that bump — **a missed invalidation bump, and because L3 has no TTL that is indefinite staleness, not a 24 h window. Investigate promptly**: identify the ingestion run (the warn carries `subject_raw` + `heuristic_code`), fix the subject mapping, re-run or manually bump the correct scope (lever 2 above).

Secondary signals: `cache_l2_tuple_mismatch` (defense-in-depth rejection on read — should be ~zero; a stream of these means a key-derivation bug, consider the nuclear option), `rag_content_version_bumped` (info — confirms each ingestion bump landed, with the new version), `cache_l2 read failed` / `cache_l2 write failed` (Redis health — fail-open, but sustained failures mean you're paying for a cache you're not getting; check the Upstash instance and secrets).

Investigate when:

- ncert-solver hit-rate drops sharply with no ingestion event or flag change (Redis eviction pressure — check Upstash memory; `allkeys-lru` evicting hot keys means the instance is undersized).
- `tokens_avoided` totals diverge wildly from finance-side Claude spend expectations (sanity cross-check).
- Any cache metric appears with an unexpected `caller` value (only `foxy`/`ncert-solver` have lanes; anything else should be fail-closed).
- L3 row count grows without corresponding `cache_l3_hit` volume after Phase 4 has soaked (write-only store = flag posture or lookup ordering regression; re-run the REG-269 suite).

## Regression pins (must stay green through every phase)

Exact wording lives in `.claude/regression-catalog.md` (REG-264..REG-269 section, 2026-07-16). Summary:

| Pin | Guards |
|---|---|
| REG-264 | v2 full-context key shape + gen_ctx read-time re-validation (the learn/practice cross-serving kill) + REG-240 continuity (shadow write-gating, fail-open, no-abstain-caching, REG-50 L2-hit contract) + per-caller TTLs |
| REG-265 | Quota decremented BEFORE cache fetch in both callers — a hit can never bypass daily limits (P12) |
| REG-266 | Fail-closed `cache_scope` — personalized Foxy turns never touch the shared cache (P13); all-flags-OFF = byte-identical pre-v2 behavior (safe merge) |
| REG-267 | Cache/rate-limiter Redis env-pair split — cache traffic can never land on the noeviction security instance |
| REG-268 | Content-version bump rotates keys end-to-end — stale grounding is never served after re-ingestion |
| REG-269 | L3 REG-50 position (after L2 miss, before retrieval) + flag-OFF full inertness + P13 payload/telemetry whitelists |

If any phase requires touching the enforcing tests, that is a review-chain event (ai-engineer + testing), not an ops flip.

## Rollback

1. **Standard:** flip the relevant serving flag(s) OFF via the super-admin console. Instant drain (≤60 s) — see Emergency full stop. No data loss, no schema to reverse.
2. **Shadow rollback:** flip `ff_foxy_response_cache_l2_shadow_v1` OFF — stops lookups/writes/telemetry entirely; the pipeline is back to REG-266(b) pre-v2 behavior.
3. **Store rollback:** flip `ff_ncert_solver_solution_store_v1` OFF — `ncert_solver_solutions` becomes fully inert (never read, never written). Rows persist harmlessly for a later re-enable.
4. **Flag-row removal** (documented manual DOWN in both seeds): `DELETE FROM feature_flags WHERE flag_name = '<flag>';` — a missing row resolves OFF.
5. Migrations stay in place — both tables are additive, service-role-only, and inert while their flags are OFF. Never DROP in a panic.

## References

- Regression catalog: `.claude/regression-catalog.md` (REG-264..REG-269)
- Pipeline: `supabase/functions/grounded-answer/pipeline.ts` (+ `gen-ctx.ts`, `cache-redis.ts`, `cache.ts`, `cache-durable.ts`, `cache-telemetry.ts`, `_content-version.ts`, `_l2-cache-flags.ts`)
- Version-bump writer: `supabase/functions/_shared/rag-content-version.ts` (called by `embed-ncert-qa`, `embed-questions`, `generate-embeddings`, `extract-ncert-questions`)
- Callers: `apps/host/src/app/api/foxy/route.ts` (Foxy), `supabase/functions/ncert-solver/index.ts`
- Migrations: `supabase/migrations/20260716090000_rag_content_versions.sql`, `20260716090100_ncert_solver_solutions.sql`, `20260716090200_seed_ff_response_cache_serve_ncert_v1.sql`, `20260716090300_seed_ff_ncert_solver_solution_store_v1.sql`
- Style precedent: `docs/runbooks/adaptive-remediation-rollout.md`
