# `src/lib/state` — the unified state architecture

The substrate that makes Alfanumrik behave as **one interconnected unit** instead of a constellation of features each carrying private state. Built around seven pieces, all flag-gated, none enabled in production by default.

## The seven pieces

| # | Piece | File | What it does |
|---|---|---|---|
| 1 | **Student state model** | [`student-state.ts`](./student-state.ts) | The canonical shape of "what a learner IS at this moment". Identity, tenant, mastery, engagement, live session, access, consent. Source of truth every feature reads. |
| 2 | **Orchestrator** | [`orchestrator.ts`](./orchestrator.ts) | The single entry point that mutates domain state. Dispatches services, publishes events, evaluates rules, caches state. Per-learner mutex for serialisation. |
| 3 | **Service contract** | [`services/service.ts`](./services/service.ts) + [`services/quiz-completion-service.ts`](./services/quiz-completion-service.ts) | Every feature becomes a `Service<Input, Output>` that reads state and returns output + events. Pure-ish — no direct domain writes. |
| 4 | **Event bus** | [`events/registry.ts`](./events/registry.ts) + [`events/publish.ts`](./events/publish.ts) + [migration](../../../supabase/migrations/20260521100000_state_events_bus_rename.sql) | Typed discriminated union of every cross-feature signal. `state_events` table is append-only + service_role only. `publishEvent()` is the single writer. pg_notify drives subscribers. |
| 5 | **Learning journey** | [`journey/journey.ts`](./journey/journey.ts) | Continuous timeline projection over `state_events`. Parent / teacher / Foxy / mesh / super-admin all read the same projection. |
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
        │ (or read cache) │         │   PURE — returns │         │  → state_events │
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
| `ff_event_bus_v1` | `publishEvent()` writes rows to `state_events`. Subscribers can read; orchestrator can still be off. |
| `ff_orchestrator_v1` | `Orchestrator.dispatch()` publishes events through the bus (otherwise: runs services but skips publish). |

The bus and the orchestrator are gated separately so the bus can warm up (events flowing, projections built, subscribers verified) before any feature actually depends on the new state plane.

## Adoption phases (each independently shippable)

### Phase 1 — Wire the substrate (this PR)

- Migration applied → `state_events` table exists, RLS locked to `service_role`
- Both flags stay OFF in production
- No feature behaviour changes yet

### Phase 2 — Migrate one feature

Pick the highest-traffic single-write path. Recommended: **quiz completion**.

1. The quiz API route stops doing scattered writes (mastery + XP + parent + PostHog + …)
2. It calls `orchestrator.dispatch({ service: quizCompletionService, ... })`
3. Wire one subscriber: `mastery_state` writer reacts to `learner.mastery_changed`
4. Flip `ff_event_bus_v1` to `true` on the Cusiosense house tenant only
5. Watch `state_events` accumulate; verify the mastery writer keeps mastery_state in sync
6. Roll out: enable on pilot tenants → all tenants
7. Retire the legacy scattered writes in the quiz route once parity is confirmed

### Phase 3 — Migrate Foxy to context-rich

1. Foxy edge function reads `buildAiContext(state, journey, focus)` and splices into its system prompt
2. Existing prompt scaffold stays — we're adding ~1500 tokens of learner context, not rewriting prompts
3. Measure: does Foxy's `helpful: true` rate change? (PostHog cohort comparison)

### Phase 4 — Rules engine drives surfaces

For each surface that has policy in-line (sidebar nav, dashboard cards, gating decisions, upsells), replace the in-line if-blocks with `evaluate(STANDARD_RULES, state)` + `pickDecision(decisions, 'nav.module.hide')`.

### Phase 5 — Mesh agent reads journey + outcome_metrics

The mesh's L8 Evolution Agent (skeleton already in `agents/runtime/`) starts attributing outcomes:

- A cycle ships `learner.* surface changes` → outcome_metrics row links cycle_id to a target_metric
- Journey events over the next N days roll up to that metric
- Mesh decides whether to keep the change, evolve the prompt, or escalate

## What this PR does NOT do

- **Does not modify any existing feature.** Legacy code paths stay live and untouched.
- **Does not flip any flag.** Both `ff_event_bus_v1` and `ff_orchestrator_v1` ship OFF.
- **Does not implement `StudentStateBuilder`.** The type is exported; the actual DB-read function is a Phase 2 deliverable when we wire the first feature. Until then, callers can construct fixtures (see `src/__tests__/state/unified-state.test.ts::makeState`).
- **Does not implement Supabase Realtime subscriber.** Phase 2 ships the worker that LISTENs on `state_events` and feeds the orchestrator's `onEvent()`.

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
