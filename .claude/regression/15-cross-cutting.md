## H2b — Event-Sourced Canonical-Write Migration (Stage 1 dual-write parity) — 2026-06-30

ADR-005 begins moving the canonical `scheduled_actions` write OFF the `/api/learner/next`
route and ONTO an event-sourced projector. Slice H2b ships the **Stage 1 dual-write parity
phase** (merged via PR #1141 + #1144 follow-ups): a new event kind
`learner.next_action_resolved` (`src/lib/state/events/registry.ts`), a new projector
`scheduledActionsWriter` (`src/lib/state/subscribers/scheduled-actions-writer.ts`) that OWNS
the `scheduled_actions` upsert once cutover completes, and a dual-write at the route. The route
(`src/app/api/learner/next/route.ts`) RETAINS its synchronous inline `scheduled_actions` upsert
(the existing E10 write) AND, best-effort, ALSO `publishEvent('learner.next_action_resolved')`
gated behind `ff_event_bus_v1`. This is the PARITY phase: the inline write stays authoritative
while the projector is proven to produce a byte-identical row before Stage 2 cuts over to
projector-only. P8 is UNCHANGED — `scheduled_actions` keeps its existing table/RLS posture;
no new table, no RLS toggle. The projector and the inline write target the SAME row via the
SAME conflict key, so the substrate's data-ownership boundary is untouched during parity.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-215 | `h2b_next_action_resolved_dualwrite_parity` | ADR-005 / P8: the `/api/learner/next` route DUAL-WRITES during Stage 1 — the synchronous inline `scheduled_actions` upsert (retained, E10) PLUS a best-effort `publishEvent('learner.next_action_resolved')` gated by `ff_event_bus_v1`. PARITY is pinned end-to-end: the published event, fed through the REAL `scheduledActionsWriter` projector, projects to a row BYTE-EQUAL to the inline upsert (same conflict key, 1:1 column mapping, `source` hard-coded scheduler). Flag-gating: flag ON → exactly one inline upsert AND one publishEvent; flag OFF → ZERO inline upserts and ZERO publishEvents, response byte-unchanged. Bus-outage isolation: an async `publishEvent` rejection is swallowed (best-effort) — the route still returns 200 with the resolver payload, so the event bus can never degrade the live next-action path. Projector independently pinned: binds to `learner.next_action_resolved`, idempotent on re-delivery (identical event → identical row), `dryRun` no-op, throws on substrate upsert error (retry), safe no-op on malformed payload. P8 substrate (scheduled_actions table/RLS) unchanged — no new table, no RLS toggle. | `src/__tests__/api/learner/next/route.test.ts` + `src/lib/state/subscribers/scheduled-actions-writer.test.ts` | E | P8 |

### Invariants covered by this section

- P8 (RLS boundary / canonical-write substrate) — REG-215 pins that H2b leaves the
  `scheduled_actions` table and its RLS posture untouched: the new projector writes the SAME
  row via the SAME upsert conflict key as the route's inline write (no new table, no RLS
  toggle, no second source of truth). The dual-write is additive parity, not a substrate change.
- ADR-005 (canonical write route → projector) — the byte-equal projection assertion is the
  GATE on the Stage 2 cutover. The published event, run through the REAL `scheduledActionsWriter`,
  must produce a row identical to the inline upsert; any column-mapping, conflict-key, or
  `source` drift between the two writers fails REG-215 and blocks cutover.
- Dual-write resilience (async-dispatch-aware) — the event publish is best-effort and
  flag-gated: an event-bus rejection cannot 500 the live next-action route, and
  `ff_event_bus_v1=OFF` makes the publish a no-op with a byte-unchanged response. The inline
  write remains the sole authority throughout Stage 1.

### Stage 2 sunset condition

REG-215 is the PARITY guard for the dual-write phase ONLY. It may be retired (the inline
E10 write deleted and this entry closed) once, and only once: (1) `ff_event_bus_v1` AND
`ff_projector_runner_v1` are both ramped to 100%, AND (2) production parity between the
inline write and the projector-produced row has been confirmed over the bake window. Until
all three hold, the inline `scheduled_actions` upsert stays authoritative and REG-215 stays
green. Deleting the inline write or closing E10 before that is a blocking regression.

### Catalog total

H2b Stage 1 dual-write parity adds REG-215 (event-sourced canonical-write migration —
`learner.next_action_resolved` event + `scheduledActionsWriter` projector + route dual-write;
byte-equal projection through the real projector, flag-gating ON/OFF, best-effort bus-outage
isolation, idempotent projector; P8 substrate unchanged; gates the ADR-005 Stage 2 cutover).
**Total catalog: 182 entries (target: 35 — TARGET EXCEEDED).**

---

