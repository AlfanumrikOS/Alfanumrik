# `src/lib/state` — the unified state architecture

The substrate that makes Alfanumrik behave as **one interconnected unit** instead of a constellation of features each carrying private state. Built around seven pieces, all flag-gated, none enabled in production by default.

## The seven pieces

| # | Piece | File | What it does |
|---|---|---|---|
| 1 | **Student state model** | [`student-state.ts`](./student-state.ts) | The canonical shape of "what a learner IS at this moment". Identity, tenant, mastery, engagement, live session, access, consent. Source of truth every feature reads. |
| 2 | **Orchestrator** | [`orchestrator.ts`](./orchestrator.ts) | The single entry point that mutates domain state. Dispatches services, publishes events, evaluates rules, caches state. Per-learner mutex for serialisation. |
| 3 | **Service contract** | [`services/service.ts`](./services/service.ts) + [`services/quiz-completion-service.ts`](./services/quiz-completion-service.ts) | Every feature becomes a `Service<Input, Output>` that reads state and returns output + events. Pure-ish — no direct domain writes. |
| 4 | **Event bus** | [`events/registry.ts`](./events/registry.ts) + [`events/publish.ts`](./events/publish.ts) + [migration](../../../supabase/migrations/20260516180000_domain_events_bus.sql) | Typed discriminated union of every cross-feature signal. `domain_events` table is append-only + service_role only. `publishEvent()` is the single writer. pg_notify drives subscribers. |
| 5 | **Learning journey** | [`journey/journey.ts`](./journey/journey.ts) | Continuous timeline projection over `domain_events`. Parent / teacher / Foxy / mesh / super-admin all read the same projection. |
| 6 | **AI context builder** | [`context/builder.ts`](./context/builder.ts) | `buildAiContext(state, journey, focus) → markdown` — splices a learner-rich block into every Anthropic call. Bounded ~1500 tokens. |
| 7 | **Rule engine** | [`rules/engine.ts`](./rules/engine.ts) + [`rules/stdlib.ts`](./rules/stdlib.ts) | Declarative `Rule<Reason>` returning typed `Decision`s. Stdlib has Foxy gating, module hides, next-quiz nudge, family-plan upsell, parent digest. Surfaces consume decisions; nobody re-implements policy. |

## How a request flows through the system

```
                     ┌─── API route (e.g. POST /api/quiz/submit) ───┐
                     │                                              │
                     │   orchestrator.dispatch({                    │
                     │     authUserId, service, input               │
                     │   })                                          │
                     │                                              │
                     └───────────────────────┬──────────────────────┘
                                             │
                              ┌──────────────▼──────────────┐
                              │       ORCHESTRATOR          │
                              │   (per-learner mutex)        │
                              └──────────────┬──────────────┘
                                             │
                ┌────────────────────────────┼────────────────────────────┐
                │                            │                            │
        ┌───────▼─────────┐         ┌────────▼─────────┐         ┌────────▼─────────┐
        │ 1. Build state  │         │ 2. Call service  │         │ 3. Publish events│
        │ (or read cache) │         │   PURE — returns │         │  → domain_events │
        │                 │         │   Output + Events│         │  → pg_notify     │
        └─────────────────┘         └──────────────────┘         └────────┬─────────┘
                                                                          │
                                                       ┌──────────────────┼──────────────────┐
                                                       │                  │                  │
                                                ┌──────▼──────┐   ┌──────▼──────┐    ┌──────▼──────┐
                                                │ Subscribers │   │ Subscribers │    │ Subscribers │
                                                │  mastery DB │   │  parent     │    │  PostHog    │
                                                │  writer     │   │  notifier   │    │  + Sentry   │
                                                └─────────────┘   └─────────────┘    └─────────────┘

                              Surfaces re-read fresh state on the next request:
                                Student dashboard · Parent view · Teacher dashboard ·
                                Foxy (with AI context block) · Super-admin · Mesh agent
```

## Feature flags (both default OFF)

| Flag | Effect when ON |
|---|---|
| `ff_event_bus_v1` | `publishEvent()` writes rows to `domain_events`. Subscribers can read; orchestrator can still be off. |
| `ff_orchestrator_v1` | `Orchestrator.dispatch()` publishes events through the bus (otherwise: runs services but skips publish). |

The bus and the orchestrator are gated separately so the bus can warm up (events flowing, projections built, subscribers verified) before any feature actually depends on the new state plane.

## Adoption phases (each independently shippable)

### Phase 1 — Wire the substrate (this PR)

- Migration applied → `domain_events` table exists, RLS locked to `service_role`
- Both flags stay OFF in production
- No feature behaviour changes yet

### Phase 2 — Wire one feature (this PR)

Quiz completion is wired through the orchestrator **additively** — the legacy `submit_quiz_results_v2` RPC stays as the authoritative grader; the new path runs alongside, publishing events. Same code path can be flipped to fully replace the legacy writes once parity is verified.

What ships in Phase 2:

1. New migration `20260517100000_learner_state_projections.sql` — adds the `learner_mastery` projection table (the clean per-chapter rollup the StudentState model expects) and the `bus_cursor` table (the watermark store for the polling listener).
2. [`student-state-builder.ts`](./student-state-builder.ts) — the DB → StudentState projector. Parallel reads of `students`, `learner_mastery`, recent quiz/foxy sessions, guardian links, tenant modules.
3. [`services/registry.ts`](./services/registry.ts) — the typed service roster. Currently: `quizCompletionService`. Tests can subset via `pickServices([...])`.
4. [`subscribers/dispatcher.ts`](./subscribers/dispatcher.ts) + [`subscribers/mastery-state-writer.ts`](./subscribers/mastery-state-writer.ts) — the first concrete subscriber, upserts into `learner_mastery` on `learner.mastery_changed`. Idempotent. Respects dryRun.
5. [`quiz-orchestrator-bridge.ts`](./quiz-orchestrator-bridge.ts) — best-effort dispatch into the orchestrator after the legacy RPC succeeds. Wrapped in try/catch — NEVER breaks the route. Flag-gated on `ff_orchestrator_v1`.
6. [`runtime/event-listener.ts`](./runtime/event-listener.ts) — polling daemon: reads `domain_events` since cursor, fans out via dispatcher, advances cursor only on all-subscribers-ok. Standalone runner: `npx tsx scripts/run-event-listener.ts [--dry-run]`.
7. Tests in [`src/__tests__/state/phase-2-unit.test.ts`](../../__tests__/state/phase-2-unit.test.ts) — 18 unit tests covering builder, registry, writer, dispatcher, listener tick.

**Rollout plan (each step independently reversible):**

1. **Apply migration on staging.** Schema-only — no behaviour change.
2. **Deploy code with both flags OFF.** Quiz route bridge is a no-op; orchestrator never instantiated; subscriber daemon may run but sees nothing.
3. **Start the listener daemon (dryRun mode).** Subscribers log what they WOULD write. Confirms the listener can read the schema.
4. **Flip `ff_event_bus_v1` to `true` on the Cusiosense house tenant only.** `publishEvent()` starts writing rows. Subscribers (still in dryRun) log activity but don't touch `learner_mastery`.
5. **Flip `ff_orchestrator_v1` to `true` on the Cusiosense house tenant only.** The bridge starts firing on quiz submissions for that tenant. Events accumulate; dryRun logs show the projection writes that would happen.
6. **Flip subscribers out of dryRun.** `learner_mastery` rows start appearing alongside the legacy `adaptive_mastery` writes.
7. **Run the parity script.** Compare orchestrator-computed mastery deltas against `adaptive_mastery` for the past 24h on the house tenant. (Script: future PR.) Diff threshold: <5%.
8. **Roll out tenant-by-tenant.** Pilot schools → all schools → B2C.
9. **Retire legacy writes.** Once `learner_mastery` is the read source for surfaces (parent view, teacher dashboard), the legacy `adaptive_mastery` writes in the RPC can be removed in a separate PR.

### Phase 3 — Foxy reads context-rich state (this PR's sibling, #716)

1. New flag `ff_foxy_context_rich_v1`, default OFF.
2. [`context/foxy-context-bridge.ts`](./context/foxy-context-bridge.ts) builds the AI context block from StudentState + journey events. Never throws; wraps every fetch. Returns `{ block, approxTokens, reason }`.
3. `src/app/api/foxy/route.ts` appends `result.block` to the system prompt after the lab/mastery sections. Empty block = byte-identical prompt to today.
4. Tests in `src/__tests__/state/phase-3-foxy-context.test.ts` cover: flag off, happy path, builder error, empty events, unparseable rows, lookback window, lowercase coercion.
5. Rollout: flip `ff_foxy_context_rich_v1` on Cusiosense house tenant only. Measure `helpful: true` rate vs control. Expand tenant-by-tenant.

### Phase 4 — Rule engine drives surfaces (this PR's sibling, #717)

1. New flag `ff_rule_engine_v1`, default OFF.
2. [`rules/service.ts`](./rules/service.ts) exports `getLearnerDecisions({ authUserId, decisionSlugs?, minPriority? })`. Builds state, evaluates `STANDARD_RULES`, returns `Decision[]`. 30s per-process cache. Never throws — failure returns `{ decisions: [], reason: 'error' }`.
3. [`/api/state/decisions`](../../app/api/state/decisions/route.ts) — `GET` endpoint, JWT-auth, optional `?slug=` and `?minPriority=` filters. Returns `{ decisions: [], reason: 'flag_off' }` while flag is off.
4. [`rules/client.ts`](./rules/client.ts) — `useLearnerDecisions(opts)` + `useLearnerDecision(slug)` SWR hooks. Surfaces also get `isFlagOff` to decide whether to fall back to legacy in-line checks.
5. [`decisionsToModuleEnablement(decisions, allKeys)`](./rules/service.ts) — maps `nav.module.hide` decisions to the sidebar's `Record<moduleKey, boolean>` shape. Phase 4 doesn't yet wire it into DashboardSidebar — that cutover is a per-surface follow-up PR.
6. Tests in `src/__tests__/state/phase-4-rule-engine-service.test.ts` cover: flag off / on, slug filter, minPriority, error path, module-enablement reducer.

Rollout: flip `ff_rule_engine_v1` on Cusiosense house tenant only. Surfaces stay on their legacy fallback until each one is individually migrated to consume `useLearnerDecisions()`.

### Phase 5 — Mesh L8 outcome attribution (this PR's sibling, #718)

The final layer of the unified-state loop. Shipped cycles get
attributed against `domain_events`-derived metrics.

1. New flag `ff_mesh_l8_attribution_v1`, default OFF.
2. [`agents/runtime/metrics/registry.ts`](../../../agents/runtime/metrics/registry.ts) — 4 starter metrics: `foxy_helpful_rate`, `quiz_completion_rate`, `mastery_velocity`, `streak_retention_7d`. Each computes from `domain_events` over a window.
3. [`agents/runtime/layers/l8-evolution.ts`](../../../agents/runtime/layers/l8-evolution.ts) — `runL8Attribution({ sb, windowDays })` reads shipped cycles, computes before/after deltas, inserts `outcome_metrics` rows. Idempotent. Conservative significance threshold (|delta|≥0.05 + N≥30 for rates).
4. [`scripts/run-l8-attribution.ts`](../../../scripts/run-l8-attribution.ts) — standalone CLI. `npx tsx scripts/run-l8-attribution.ts [--dry-run]`. Cron via GitHub Actions or Vercel cron once flag flips.
5. Tests in `src/__tests__/state/phase-5-l8-attribution.test.ts` cover: flag off, no-cycles, unknown metric, already-attributed, happy path, window incomplete, significance thresholds, registry completeness.

Rollout: keep flag OFF until Phase 2's event bus has ≥14d of data on the Cusiosense house tenant. Then flip globally; the attribution loop is read-mostly and writes one row per (cycle, metric).

## What Phase 2 does NOT do

- **Does not remove any legacy write.** `submit_quiz_results_v2` keeps writing `adaptive_mastery`, `quiz_sessions`, xp_ledger rows exactly as before. The orchestrator runs alongside; both flags ship OFF.
- **Does not migrate Foxy, dashboards, or any non-quiz feature.** Those are Phase 3+.
- **Does not flip any flag in production.** Staging-only canary on the Cusiosense house tenant after this lands.
- **Does not depend on Supabase Realtime.** Phase 2 uses polling on the `domain_events.occurred_at` cursor. Realtime / pg_notify is a future swap behind the same Dispatcher interface.

## Tests

Pure-logic tests in [`src/__tests__/state/unified-state.test.ts`](../../__tests__/state/unified-state.test.ts) cover:

- Zod schema validation (state + events)
- BKT math + idempotency of the quiz completion service
- Journey projector (event → render, noise drops, mastery threshold crossing, IST day grouping)
- AI context builder (focus subject, tenant personality, minor flag, bounded tokens)
- Rule engine (Foxy gate, next-quiz suggestion, upsell, priority ordering)

Run via the broader test suite once the project's `npm test` is fixed; for now:

```bash
npx vitest run --config vitest.mesh.config.ts src/__tests__/state/
```

## See also

- [`agents/runtime/AUTOMATION.md`](../../../agents/runtime/AUTOMATION.md) — the mesh agent that will eventually attribute cycle outcomes to journey deltas
- [`governance/rubric.md`](../../../governance/rubric.md) — the rubric the mesh critic uses, also applicable to manual reviews
- [PR #572](https://github.com/AlfanumrikOS/Alfanumrik/pull/572) — the original `ff_event_bus_v1` flag introduction
