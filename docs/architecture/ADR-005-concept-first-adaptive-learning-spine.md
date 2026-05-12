# ADR-005 — Concept-First Adaptive Learning Spine

**Date:** 2026-05-12
**Status:** Accepted (CEO sign-off 2026-05-12)
**Author of source thesis:** Pradeep Sharma. Drafted into ADR form 2026-05-12.
**Updates:** [ADR-001 — Learner Loop](./ADR-001-learner-loop-unification.md), [ADR-004 — Adaptive Tutor](./ADR-004-adaptive-tutor.md)
**Confirms:** [Microservices Extraction Plan v1](./MICROSERVICES_EXTRACTION_PLAN.md)
**Companion:** ADR-002 (LangGraph) — orthogonal; if accepted, LangGraph runtime lives behind the same event boundaries this ADR pins.

## Context

Alfanumrik today is a working modular monolith — Next.js portals, ~32 Supabase Edge Functions, 11 domain modules under [`src/lib/domains/`](../../src/lib/domains/), a unified state bus (`state_events`), an Adaptive Tutor MVP, a Learner Loop resolver, and durable billing/notification paths. Phase 0 of the microservices extraction plan is substantially complete; none of the extraction triggers (E1–E4) has fired.

Despite that, the architecture lacks a **stated spine**. Each new feature negotiates its own ownership of state, its own AI hookups, its own writer paths. This produces drift: features work in isolation but the product feels like a collection of pages, quizzes, AI routes, dashboards, and admin tools that happen to share a database. The CEO articulated this on 2026-05-12 alongside a North Star — *Alfanumrik should be a concept-first adaptive learning platform, not the sum of its surfaces.*

Lessons from comparable platforms point to a single pattern:
- **Duolingo** centralizes the learner's next-action decision behind a Session Generator + Birdbrain difficulty model.
- **Khan Academy** evolved their go-services migration gradually, running old and new paths side by side rather than rewriting.
- **Open edX** keeps the learning core cohesive and uses worker/microfrontend boundaries only where they're earned.
- **Coursera** treats payments as durable events with webhook + reconciliation, not as ad-hoc state mutation.

This ADR adopts the same shape for Alfanumrik.

## Decision

Adopt the spine:

```
Concept Graph → Durable State Events → Projectors → Next-Action Resolver → Web/Mobile BFF
```

In one sentence: **Alfanumrik's canonical learner state is event-sourced, projector-owned, and resolver-served.** Routes can compute optimistic responses; they MUST NOT be the canonical writers of learner-state tables.

### Target architecture layers

| # | Layer | Responsibility |
|---|---|---|
| 1 | Frontend | Next.js portals + Flutter mobile call the same BFF APIs |
| 2 | Proxy ([`src/proxy.ts`](../../src/proxy.ts)) | Auth refresh, rate limit, tenant routing, bot guard |
| 3 | BFF / API | Validate, authorize, call domain services, return typed responses |
| 4 | Domain ([`src/lib/domains/`](../../src/lib/domains/)) | Business logic + table-access boundary |
| 5 | Event substrate (`state_events`) | Durable, replayable log of learner/billing/notification state changes |
| 6 | Projectors | Workers that consume events; canonical writers of `concept_mastery`, schedules, analytics, notifications, entitlements |
| 7 | Resolver (`resolveNextConcept`, `resolveNextLearnerAction`) | Decides what the learner should do now |
| 8 | AI / RAG | One grounded-answer service; read-only on learner state; emits events |
| 9 | Data | Supabase Postgres / RLS / pgvector. Replicas, warehouses, queues only when load proves the need |
| 10 | Observability | Sentry, PostHog, OTel; event lag, projector failures, replay tools, AI evals |

## Architecture Rule

The enforceable rule, in priority order:

1. **No API route is a canonical writer of learner state.** Routes may compute and return optimistic results, but the canonical write to `concept_mastery`, `daily_schedule`, `scheduled_actions`, `entitlements`, `notification_sends`, etc. happens in a projector subscribing to a durable `state_events` row. *Operational and log tables (per-attempt logs, request audit trails, idempotency reservations like `concept_attempts`) are route-owned by design — they record what happened, not what the learner has learned.*
2. **Every cross-domain write goes through an event or a domain service.** No direct table joins across domain boundaries inside API routes.
3. **Every projector handler is idempotent on a stable key** (typically the event's `attemptId` / `paymentId` / `notificationId`). Replay is a first-class operation, not an exception.
4. **Every AI route is read-only on learner state.** AI may *publish* recommendation/explanation/classification events; it may not UPDATE state tables directly. Foxy, the tutor's reteach path, and the grounded-answer service all obey this.
5. **Every protected route uses the standard authorization helper.** No bespoke auth checks.
6. **Every architectural exception has an expiry date** and lives in `docs/architecture/EXCEPTIONS.md` with owner + sunset date.

### Use the existing runtime

A polling event-listener already exists at [`src/lib/state/runtime/event-listener.ts`](../../src/lib/state/runtime/event-listener.ts), a fan-out dispatcher at [`src/lib/state/subscribers/dispatcher.ts`](../../src/lib/state/subscribers/dispatcher.ts), and a registered subscriber (the chapter-level `mastery-state-writer` for `learner.mastery_changed`) at [`src/lib/state/subscribers/mastery-state-writer.ts`](../../src/lib/state/subscribers/mastery-state-writer.ts). `publishEvent` is at [`src/lib/state/events/publish.ts`](../../src/lib/state/events/publish.ts) and is itself flag-gated on `ff_event_bus_v1`. The cursor lives in `bus_cursor`.

New projector work **extends this runtime**; it does not duplicate it. Specifically, PR 1 of the Phase 2 sequence promotes the global cursor to **per-subscriber cursors** and adds a persistent dead-letter table and a filtered replay command. PR 2 adds a `concept-mastery-projector` subscriber for the new `learner.concept_check_answered` event. The chapter-level legacy `mastery-state-writer` (for `learner.mastery_changed`) continues to run until the chapter-first surfaces are retired.

Publishers must check `PublishResult.published === true` after every `publishEvent`. A `flag_off` reason means `ff_event_bus_v1` is OFF for the current scope — the caller is responsible for either failing loudly or falling back to a legacy path. There is no "fire and forget" mode that silently drops canonical state.

### The route ↔ projector pairing

For the Adaptive Tutor specifically (and as the pattern for every other learner write):

```
GET /api/tutor/next
   ├── resolves concept (existing)
   ├── generates attemptId (uuid)  ← no DB write
   └── returns { concept, attemptId }

POST /api/tutor/answer { attemptId, correct, ... }
   │
   ├── if all three flags on (ff_event_bus_v1 && ff_projector_runner_v1
   │                          && ff_tutor_bkt_v1):
   │     CALL atomic RPC tutor_commit_attempt(...) which, in one DB
   │     transaction holding pg_advisory_xact_lock on (student, concept):
   │       1. SELECT chain head from concept_attempts (latest answered)
   │            → prior = chain_head.posterior_mastery_mean
   │                    ?? concept_mastery.mastery_mean
   │                    ?? DEFAULT_BKT.pInit (= 0.30)
   │       2. attempt_sequence = COALESCE(MAX(seq), 0) + 1
   │       3. posterior = bkt_update(prior, correct)  [SQL fn]
   │       4. INSERT concept_attempts { attempt_id, ..., status='answered',
   │                                    attempt_sequence, prior, posterior }
   │       5. INSERT state_events { kind='learner.concept_check_answered',
   │                                payload carries the prior + posterior }
   │     RPC returns (attempt_sequence, prior, posterior, event_id)
   │     Route returns optimistic { mastery_mean = posterior, ... }
   │
   ├── if RPC fails OR any flag off:
   │     fallback: INSERT concept_attempts { ..., status='excluded' }
   │              + inline legacy naive concept_mastery write
   │              + ops-critical log + tutor_answer_path_c_fallback metric
   │     (excluded rows are skipped when reading chain head)
   │
   ▼
   ≤ 1 polling interval + handler time (~1 minute p99 under Supabase pg_cron)
   ▼
concept-mastery-projector (PR 2 subscriber to learner.concept_check_answered)
   │
   ├── pulls new events from state_events past its per-subscriber cursor
   ├── for each event: posterior = bkt_update(payload.priorMasteryMean,
   │                                          payload.correct)
   │     → identical to what the RPC computed (same pure function, same
   │       prior carried in payload, no DB re-read)
   ├── UPSERT concept_mastery
   │     - if last_attempt_id == event.attemptId → no-op (idempotent)
   ├── advances subscriber_offsets[concept-mastery-projector]
   └── on terminal failure → subscriber_dead_letters
```

Three invariants make this safe under concurrency:

1. **Deterministic equivalence.** RPC and projector both call `bkt_update(prior, correct)`; the event payload carries the prior so neither side reads a moving target.
2. **Chain integrity under multi-outstanding attempts.** The advisory lock + answer-time prior assignment means two attempts opened "before" but answered out-of-order chain correctly in *commit order*: whoever's RPC runs second sees the first's posterior as its prior.
3. **Atomic commit.** `concept_attempts` row insert and `state_events` row insert happen in one transaction. Either both land or neither does — no divergence where the chain advances but the projector never gets the event.

## Consequences

### Positive

- One coherent answer to "what should this learner do next?" — the resolver.
- Replayable history → easier debugging, easier QA, easier audit. `replay-by-student` is a supported operation.
- AI is grounded by definition — it cannot silently mutate state to cover a hallucination.
- Mobile and web converge on the same events and projectors; one contract, no split brains.
- When extraction does happen (post Phase 9 trigger), the event boundary is the natural service seam.
- Billing reconciliation, Foxy answer rating, mesh attribution all reuse the same projector substrate.

### Negative / costs

- **Two writers (route optimistic + projector canonical) require deterministic equivalence.** Mitigated: the pure update function lives in the domain layer, called from both. The event payload carries the prior so both sides operate on identical inputs.
- **Picker reads may trail the projector by ≤ 1 polling interval + handler time.** Current runtime is a 1-second poller, run on a 30-second cron in production; expect p99 latency of ~1–30 s depending on invocation cadence. Mitigated by (a) the route returning the optimistic posterior so the immediate UI doesn't lag, (b) chained-prior reads from route-owned operational tables (e.g. `concept_attempts`) so concurrent answers don't depend on projection catching up first, (c) ADR-004 Phase 1's `currentChapterHint` keeping the student on the right chapter.
- **Projector worker is new infrastructure to monitor** — lag, dead-letter, replay. Substrate spec defines the dashboards and alerts.
- **Migration takes longer than a one-PR fix would.** Two PRs minimum for Phase 2 (substrate + BKT subscriber). The CEO's explicit guidance: pick the right ownership model now rather than refactoring at scale later.

## Migration Plan

Lifted from the source thesis. Each phase is independently shippable. Phases 0–3 are the structural moves; 4–9 build on them.

| Phase | Goal | Status |
|---|---|---|
| **0 — Source of truth + map** | Canonical-repo declaration, route inventory, domain ownership matrix, stale-doc cleanup | Mostly done; consolidate in this PR cycle |
| **1 — Domain boundary enforcement** | ESLint rule for `supabaseAdmin.from()` in API routes; standard auth helper coverage; high-risk domains migrated to services | Lint rule shipped; full coverage TBD |
| **2 — Durable event spine** | Event registry + idempotency + versioning + retry/dead-letter + lag dashboard | Substrate exists (`state_events`); needs hardening (PR 1) |
| **3 — Projectors + learner state** | `mastery-state-writer`, schedule, analytics, notification, billing projectors. Routes become event publishers. | **Next work.** Starts with PR 1 (substrate) + PR 2 (BKT projector) |
| **4 — Adaptive Tutor core** | Prerequisite-aware picker, decay, BKT/IRT mastery, content QA loop | ADR-004 + ongoing; Phase 2 BKT projector seeds it |
| **5 — One web/mobile contract** | Zod/OpenAPI contracts; mobile uses same APIs as web; legacy Edge Function paths retired | Not started |
| **6 — AI/RAG architecture** | One AI gateway; no direct provider calls outside AI domain; eval CI; admin review queue | Mesh α has the substrate; full pattern TBD |
| **7 — Billing/entitlements/audit** | Razorpay events → durable events → entitlement projector; reconciliation job | Webhook idempotency mostly done; entitlement projector TBD |
| **8 — Analytics/reporting** | Aggregates projected from events; read replica or warehouse only when load proves it | Polling-aggregate path exists; event-driven path TBD |
| **9 — Scale decision gates** | Extract a service only if a documented trigger fires (E1–E4 from extraction plan v1) | Plan v1 active; no trigger fired |

## Non-Goals

- **No microservice extraction in 2026** unless a Phase 9 trigger fires. Confirms Microservices Extraction Plan v1.
- **No Kafka / SQS / Cloud Tasks / Redis Streams** today. Postgres-backed `state_events` is the substrate until volume or isolation requirements prove otherwise.
- **No big-bang rewrites.** Each phase ships behind its own flag, default OFF, with the old path preserved until the new one is proven (Khan Academy's gradual-migration lesson).
- **No CQRS-as-religion.** Projectors are write-side; reads still happen from the projected tables directly via domain services.
- **No multi-region** until a named customer requires it.
- **AI does not mutate learner state.** AI publishes events; projectors write.

## First 30 Days

The implementation order, owned by individual specs:

1. **Architecture map + route inventory** — `docs/architecture/CURRENT_SYSTEM_MAP.md` + the route ownership table. Consolidates Phase 0 of the migration plan.
2. **Domain boundary lint + auth helper coverage report** — extends the existing `no-restricted-imports` rule to cover the writer/reader split.
3. **Event taxonomy fix in `/api/tutor/answer`** — already specified; ships with PR 2.
4. **Durable `learner.concept_check_answered` event** — see [PR 2 spec](../superpowers/specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md).
5. **Projector substrate (PR 1)** — see [substrate spec](../superpowers/specs/2026-05-12-projector-substrate-design.md). Ships with NO learner behavior change.
6. **Mastery projector skeleton (PR 2)** — first real subscriber of the substrate; ships behind `ff_tutor_bkt_v1`.
7. **Web/mobile tutor contract** — Zod-typed `/api/tutor/next` and `/api/tutor/answer` consumed by both clients.
8. **Billing webhook idempotency review** — confirms `atomic_subscription_activation` path satisfies the canonical-writer rule.
9. **Foxy/mobile split-brain migration plan** — short doc; sets up Phase 6.
10. **This ADR (#10 in the thesis) — landed.**

## Success Metrics

### Technical
- 0 unauthorized direct DB writes from API routes (lint-enforced)
- ≥95% protected routes using the standard auth helper
- Event-projector lag p95 < 5 s under normal load; alert at 30 s
- Duplicate event handling tested (idempotency on `attemptId`)
- Replay-by-student command exists and is documented
- Tutor next-action p95 < 300 ms
- AI eval pass rate tracked in CI

### Product
- Higher lesson completion
- Better daily return rate
- Faster time to next useful activity
- Lower tutor wrong-answer frustration (measured via Foxy reteach trigger rate post-Phase 3)
- Better teacher visibility into weak concepts (Phase 4 teacher view)
- Fewer billing/support incidents (Phase 7 reconciliation)

## Supersedes / Updates

- **Updates ADR-001 — Learner Loop:** confirms the resolver-centered design; pins the canonical-writer rule the signal bus has been hinting at. ADR-001's Phases 1/3c/5 (shipped) are consistent with ADR-005; future phases (2, 4) inherit the projector-canonical rule.
- **Updates ADR-004 — Adaptive Tutor:** moves the Phase 2 BKT implementation from "sync inline in route" (the original approved Approach C) to "projector-canonical" (Path C with guardrails). The pure BKT function and rollout flag plan carry over; the wiring changes. ADR-004 phasing table unchanged.
- **Confirms Microservices Extraction Plan v1:** Phase 0 modularization is largely done; extraction triggers (E1–E4) stand; this ADR does not promote any service. The event spine *enables* eventual extraction without forcing it.
- **No effect on ADR-002 — LangGraph:** orthogonal. If accepted, the LangGraph runtime emits events to the same substrate.

## References

- [Duolingo — Rewriting the engine in Scala (Session Generator)](https://blog.duolingo.com/rewriting-duolingos-engine-in-scala/)
- [Duolingo — Birdbrain](https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain/)
- [Khan Academy — Go services migration](https://blog.khanacademy.org/go-services-one-goliath-project/)
- [Open edX architecture](https://docs.openedx.org/en/latest/developers/references/developer_guide/architecture.html)
- [Coursera — real-time subscription renewals](https://medium.com/coursera-engineering/improving-the-learner-experience-with-real-time-subscription-renewals-6f6dd3bc5d5f)
- [ADR-001 — Learner Loop](./ADR-001-learner-loop-unification.md)
- [ADR-004 — Adaptive Tutor](./ADR-004-adaptive-tutor.md)
- [Microservices Extraction Plan v1](./MICROSERVICES_EXTRACTION_PLAN.md)
- Source thesis: CEO message of 2026-05-12 ("Whole Plan"). Archived in session transcript.
