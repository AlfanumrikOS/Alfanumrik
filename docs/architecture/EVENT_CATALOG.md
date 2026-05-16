# Event catalog (v2)

**As of:** 2026-05-16.
**Status:** **the event bus is LIVE.** Substrate landed in [PR #752](https://github.com/AlfanumrikOS/Alfanumrik/pull/752) (merged 2026-05-12), with the canonical event registry in [`src/lib/state/events/registry.ts`](../../src/lib/state/events/registry.ts) and the single publish entry point in [`src/lib/state/events/publish.ts`](../../src/lib/state/events/publish.ts). 16 typed event kinds are registered; producer status varies — see [§3 Catalog](#3-catalog).

This document supersedes v1 (2026-04-24) which catalogued a forward-looking proposal under the premise "no event bus exists today." Most of v1's proposed E1–E10 events have either landed under different names or remain schema-only — the mapping is preserved in [§9 Relation to v1](#9-relation-to-v1).

## 1. Why an outbox pattern, not a distributed bus

The bus is implemented as `public.state_events` in the same Postgres as everything else. Producers write event rows in the same transaction as the source state change. Subscribers poll their own watermarks via the `projector-runner` Edge Function, ticked by pg_cron every minute. No Kafka, no SQS, no Redis Streams, no new vendor dependency — this preserves Blueprint Hard Rule #11 (stack lock).

The trade-offs documented in v1 still hold:

- **Ordering.** Per-`(kind, occurred_at, event_id)` ordering is preserved. Across kinds, no global ordering is guaranteed.
- **Delivery semantics.** At-least-once. Subscribers must be idempotent.
- **Worker concurrency.** Single `projector-runner` instance per cron tick. If we ever scale to multiple, the polling query must use `SELECT … FOR UPDATE SKIP LOCKED`. Not relevant today.
- **Consumer death = silent backlog.** Addressed by [`subscriber_lag` view](../../supabase/migrations/20260524110001_state_runtime_per_subscriber.sql) + `projector-health-check` Edge Function ([Iteration 2 of Phase 5](../runbooks/projector-failure.md)).
- **Growth.** `state_events` can grow unbounded. Partitioning + archival policy is queued; see [§7 Observability and operations](#7-observability-and-operations).
- **DLQ.** Implemented as [`subscriber_dead_letters`](../../supabase/migrations/20260524110001_state_runtime_per_subscriber.sql) per subscriber. See [`docs/runbooks/dead-letter-inspection.md`](../runbooks/dead-letter-inspection.md).
- **Backpressure.** Pause producers (flag off) rather than RLS throttling. Not exercised yet — flag-off mechanism untested in anger.

## 2. Event envelope

Every event carries the envelope below before its kind-specific `payload`. Defined in [`src/lib/state/events/registry.ts`](../../src/lib/state/events/registry.ts):

```ts
const EventBaseSchema = z.object({
  eventId:          uuidLike(),          // stable id assigned at publish time
  occurredAt:       isoDatetime(),        // wall-clock the publisher captured
  actorAuthUserId:  uuidLike(),          // the auth_user_id this event is "about"
  tenantId:         uuidLike().nullable(), // tenant scope; null for B2C / global
  idempotencyKey:   z.string().min(1).max(128), // dedup key for retries / replay
});
```

DB table [`public.state_events`](../../supabase/migrations/20260516180000_domain_events_bus.sql) (renamed from `domain_events` per `20260521100000_state_events_bus_rename.sql`):

```sql
event_id              uuid PRIMARY KEY
kind                  text NOT NULL                -- e.g. 'learner.quiz_completed'
actor_auth_user_id    uuid NOT NULL
tenant_id             uuid NULL
idempotency_key       text NOT NULL                -- UNIQUE (event_id, idempotency_key)
occurred_at           timestamptz NOT NULL
payload               jsonb NOT NULL
created_at            timestamptz DEFAULT now()
-- RLS: service_role only.
```

The UNIQUE constraint on `(event_id, idempotency_key)` makes `publishEvent()` retries safe — a duplicate insert returns `{ published: true, reason: 'duplicate' }` rather than throwing.

## 3. Catalog

Each row of the registry's discriminated union is listed below with its producer status. **Producer status** is one of:

- ✅ **Live** — code calls `publishEvent()` (or inserts directly into `state_events` via an RPC) in production. File path cited.
- 🟡 **Schema-only** — registered for compile-time inventory; no producer in code yet. Waiting on the feature that needs it.

Verified by grep over `src/**` (2026-05-16) for `kind:` literals and `publishEvent(` call sites.

### Learner events

| Kind | Producer status | Producer / Notes |
|---|---|---|
| `learner.signed_up` | 🟡 Schema-only | No call site found. Signup flow (`bootstrap_user_profile` RPC + `supabase/functions/identity/`) currently relies on trigger-fan-out per [`RISK_REGISTER.md`](./RISK_REGISTER.md) R8. Migration to publish target. |
| `learner.session_started` | 🟡 Schema-only | Session establishment is handled by `src/middleware.ts` + `supabase/functions/session-guard/` today; no event publication. |
| `learner.quiz_completed` | 🟡 Schema-only | [`src/lib/state/services/quiz-completion-service.ts`](../../src/lib/state/services/quiz-completion-service.ts) is the staging ground; verify call sites before relying. Today's canonical write is the `atomic_quiz_profile_update` RPC, which does **not** publish to the bus. Migration to publish target. |
| `learner.lesson_completed` | ✅ Live | [`src/app/api/learner/lesson/progress/route.ts`](../../src/app/api/learner/lesson/progress/route.ts) |
| `learner.mastery_changed` | ✅ Live | Consumed by `mastery-state-writer` subscriber (`src/lib/state/subscribers/mastery-state-writer.ts`). Producer is the orchestrator path — see [`src/lib/state/orchestrator.ts`](../../src/lib/state/orchestrator.ts). Chapter-level legacy event; new concept-level work uses `learner.concept_check_answered` instead. |
| `learner.review_graded` | ✅ Live | [`src/app/api/learner/review/grade/route.ts`](../../src/app/api/learner/review/grade/route.ts). SM-2 quality button (0/3/4/5). |
| `learner.scan_extracted` | ✅ Live | [`src/app/api/scan-solve/route.ts`](../../src/app/api/scan-solve/route.ts) |
| `learner.concept_check_answered` | ✅ Live (via RPC) | [`src/app/api/tutor/answer/route.ts`](../../src/app/api/tutor/answer/route.ts) → `tutor_commit_attempt` RPC, which `INSERT`s into `state_events` inside the same transaction as `concept_attempts`. Consumed by [`concept-mastery-projector`](../../src/lib/state/subscribers/concept-mastery-projector.ts). ADR-005 Path C v2. |

### AI events

| Kind | Producer status | Producer / Notes |
|---|---|---|
| `ai.foxy_session_started` | ✅ Live | [`src/app/api/foxy/route.ts`](../../src/app/api/foxy/route.ts) |
| `ai.foxy_session_completed` | ✅ Live | [`src/app/api/foxy/route.ts`](../../src/app/api/foxy/route.ts) |

### Parent events

| Kind | Producer status | Producer / Notes |
|---|---|---|
| `parent.linked_to_learner` | 🟡 Schema-only | `/api/parent/approve-link` writes `guardian_student_links` directly; not yet publishing. Migration to publish target — closes the "implicit triggers blur ownership" gap (R8). |
| `parent.report_viewed` | 🟡 Schema-only | Parent portal does not yet emit a view event. Low priority. |
| `parent.teacher_message_sent` | ✅ Live | [`src/app/api/parent/messages/route.ts`](../../src/app/api/parent/messages/route.ts). Emitted when a guardian posts a message to a teacher on the parent↔teacher messaging surface. Payload omits the message body (subscribers fetch from `teacher_parent_messages`); carries `isNewThread`. Phase C.3. Surfaces on parent-facing journeys (`projectJourney` returns a 'parent' category card). |
| `parent.consent_granted` | ✅ Live | [`src/app/api/parent/consent/route.ts`](../../src/app/api/parent/consent/route.ts) POST. DPDP-compliance audit trail for parental consent grants. Payload carries `consentVersion` + per-scope booleans + locale; IP/UA persist only in the canonical `parental_consent` row. Phase D.1. |
| `parent.consent_revoked` | ✅ Live | [`src/app/api/parent/consent/route.ts`](../../src/app/api/parent/consent/route.ts) DELETE. Counterpart to `parent.consent_granted`; emitted when a guardian withdraws consent. Subscribers should treat as a "pause processing" signal. Phase D.1. |
| `parent.child_data_exported` | ✅ Live | [`src/app/api/parent/children/[student_id]/export/route.ts`](../../src/app/api/parent/children/[student_id]/export/route.ts). DPDP §13 compliance signal. Emitted when a verified guardian downloads the full JSON export of their child's data. Payload carries `schemaVersion`, `payloadBytes`, `tableCount`, and `rowCountTotal` so audit + analytics subscribers see export volume without re-reading the audit_logs row. The 10MB guardrail (413 response) does NOT emit an event — only successful downloads. Phase D.2. |

### Teacher events

| Kind | Producer status | Producer / Notes |
|---|---|---|
| `teacher.assignment_created` | ✅ Live | [`src/app/api/teacher/assignments/route.ts`](../../src/app/api/teacher/assignments/route.ts). Producer wired in Phase B.5 (ADR-005 canonical-writer rollout); ships behind `ff_event_bus_v1` like every other publisher. |
| `teacher.classroom_created` | ✅ Live | [`src/app/api/teacher/classes/route.ts`](../../src/app/api/teacher/classes/route.ts). Replaces the direct `teacher_create_class` RPC call from the page. Phase B.5. |
| `teacher.classroom_updated` | ✅ Live | [`src/app/api/teacher/classes/[id]/route.ts`](../../src/app/api/teacher/classes/[id]/route.ts) PATCH. Phase B.5. |
| `teacher.classroom_archived` | ✅ Live | [`src/app/api/teacher/classes/[id]/archive/route.ts`](../../src/app/api/teacher/classes/[id]/archive/route.ts). Phase B.5. |
| `teacher.student_note_set` | ✅ Live | [`src/app/api/teacher/students/[id]/notes/route.ts`](../../src/app/api/teacher/students/[id]/notes/route.ts) PUT. Payload only carries `hasNote/hasGoal` booleans; subscribers must fetch the full body from `teacher_student_notes`. Phase B.5. |
| `teacher.profile_updated` | ✅ Live | [`src/app/api/teacher/profile/route.ts`](../../src/app/api/teacher/profile/route.ts) PATCH. Phase B.5. |
| `teacher.submission_reviewed` | ✅ Live | [`src/app/api/teacher/submissions/[id]/review/route.ts`](../../src/app/api/teacher/submissions/[id]/review/route.ts) POST. Emitted when a teacher records feedback and (optionally) overrides the auto-score on a student's assignment submission. Payload omits the feedback body — subscribers fetch the full `teacher_feedback` from the canonical `assignment_submissions` row. Phase C.1. TODO: canonical write to `assignment_submissions.{graded_at, graded_by, teacher_feedback, score}` still in-route; extract to a `submission-review-projector` subscriber. |
| `teacher.grade_entry_set` | ✅ Live | [`supabase/functions/teacher-dashboard/index.ts`](../../supabase/functions/teacher-dashboard/index.ts) `set_grade_book_cell` action. Emitted when a teacher records a score on a (student, column_key) cell in the grade book matrix for the current term. Payload omits the notes body — subscribers fetch the full notes from the canonical `score_history` row when needed. Phase C.2. TODO: canonical write to `score_history` still in-handler; extract to a `grade-book-projector` subscriber. Today `score_history` is keyed `(student_id, subject, recorded_at)` — no `max_score`/`term`/`column_kind` columns; unit/attendance column kinds carry their metadata on the event but are not persisted yet (schema gap flagged in Phase C.2 PR). |
| `teacher.parent_message_sent` | ✅ Live | [`src/app/api/teacher/messages/route.ts`](../../src/app/api/teacher/messages/route.ts). Emitted when a teacher posts a message to a parent on the teacher↔parent messaging surface. Payload omits the message body (subscribers fetch from `teacher_parent_messages`); carries `isNewThread` so notification subscribers can pick a richer template for first-touch vs follow-up. Phase C.3. |

### School / tenant events

| Kind | Producer status | Producer / Notes |
|---|---|---|
| `school.module_toggled` | 🟡 Schema-only | Tenant module CRUD lives in `/api/school-admin/modules` (per [PR #570](https://github.com/AlfanumrikOS/Alfanumrik/pull/570)) and `/api/super-admin/module-overrides` (per [PR #573](https://github.com/AlfanumrikOS/Alfanumrik/pull/573)). Today they write `tenant_modules` + `school_audit_log` directly; not yet publishing to bus. Migration target. |

### Billing events

| Kind | Producer status | Producer / Notes |
|---|---|---|
| `billing.invoice_paid` | 🟡 Schema-only | Razorpay webhook in `/api/payments/webhook` currently writes `payments` + `student_subscriptions` + `school_subscriptions` directly (per PR #551 + #556). Not yet publishing. Bridge target — once published, the welcome-email + analytics + entitlements writes can decouple. See v1's E2 mapping for historical proposal. |

### Mesh events

| Kind | Producer status | Producer / Notes |
|---|---|---|
| `mesh.cycle_completed` | 🟡 Schema-only | Mesh runtime substrate per `project_agent_mesh_phase_alpha.md` (memory) — substrate landed; runtime not yet emitting events. Will publish from `agents/runtime/tick.ts` once `ff_agent_mesh_v1` activates. |

## 4. Naming convention

Every kind is `<actor>.<verb_past>`. Canonical actors: `learner`, `parent`, `teacher`, `school`, `ai`, `billing`, `mesh`. Enforced by [`src/__tests__/state/events-registry.test.ts`](../../src/__tests__/state/events-registry.test.ts).

`tenant.*` is **not** a canonical actor — tenant-scoped events use the `school.*` namespace because the canonical entity is `schools` (per the [Path B decision](./EXCEPTIONS.md#e4-legacy-srclibtenantts-coexists-with-srclibtenant-domain) in PR #558).

## 5. Schema evolution rules

Unchanged from v1. Restated for completeness:

- Event types are versioned by suffix when payload shape breaks (`learner.quiz_completed` → `learner.quiz_completed_v2`). Never mutate a schema in place once a producer exists.
- Consumers must handle an unknown event type by acknowledging and ignoring (never erroring), so new event types don't break old consumers.
- Payload fields are additive only within a version.
- Breaking changes require a new `.vN` and a dual-publish period.
- Within a version, payload additions are safe; payload removals or type changes are not.

For events still in schema-only state (🟡 rows above), the schema is mutable until a producer ships — there's no consumer to break. Once the first producer goes live, freeze.

## 6. Delivery guarantees

- **At-least-once** delivery from the bus. The `subscriber_offsets.last_processed_event_id` watermark advances atomically with the projection write; if the projection write commits but cursor advance fails, the event is re-processed on next tick — hence the idempotency contract on subscribers.
- **Consumers must be idempotent.** UPSERT-with-conflict-on-natural-key is the standard implementation (e.g., `concept-mastery-projector` UPSERTs on `(student_id, concept_id)`). Tested with `dispatcher.replay.test.ts` and per-subscriber tests.
- **Per-subscriber maxRetries** is configurable in `STANDARD_SUBSCRIBERS`. After exhaustion, the event lands in `subscriber_dead_letters` and the subscriber's cursor stays before it — see [`docs/runbooks/dead-letter-inspection.md`](../runbooks/dead-letter-inspection.md).
- **No backpressure mechanism today.** If a subscriber is fundamentally broken, dead-letter accumulation surfaces it via the health-check alert; ops decides whether to flag-off, fix, or replay.

## 7. Observability and operations

- **Outbox lag.** `public.subscriber_lag` view materializes `events_behind`, `events_in_retry`, `events_dead_lettered`, and `age_behind` per subscriber. Created in [`20260524110001_state_runtime_per_subscriber.sql`](../../supabase/migrations/20260524110001_state_runtime_per_subscriber.sql).
- **Alerting.** `supabase/functions/projector-health-check/index.ts` polls `subscriber_lag` every 2 minutes and emits `projector_health_degraded` PostHog events (added to taxonomy in [`src/lib/posthog/types.ts`](../../src/lib/posthog/types.ts)) when thresholds defined in [`SLO.md`](./SLO.md) are breached. Operator runbook is [`docs/runbooks/projector-failure.md`](../runbooks/projector-failure.md).
- **Replay.** Per-student rebuild via `POST /api/super-admin/projectors/replay`. Procedure in [`docs/runbooks/replay-by-student.md`](../runbooks/replay-by-student.md).
- **Dead-letter triage.** Per-event in [`docs/runbooks/dead-letter-inspection.md`](../runbooks/dead-letter-inspection.md).
- **Bus volume.** No partitioning today. Acceptable while `state_events` is under ~1M rows; revisit at E1 trigger per [`MICROSERVICES_EXTRACTION_PLAN.md`](./MICROSERVICES_EXTRACTION_PLAN.md).

## 8. Explicitly NOT proposed

Carried forward from v1 — these events are deliberately *not* in the registry because they would be too fine-grained, duplicate existing flows, or describe data already captured elsewhere:

- `question.answered` — too fine-grained; the RPC already captures this as a transactional write. `learner.concept_check_answered` is the closest live event and represents a *concept* check, not a question.
- `content.question_added` — content ingestion is queued via `queue-consumer`; no need for an event layer on top.
- `mastery.achieved` — milestone-style events; subsumed by `learner.mastery_changed` (consumers compute milestones).
- `role.assigned` — RBAC changes are low-volume and currently poll-friendly. R3 in [`RISK_REGISTER.md`](./RISK_REGISTER.md) tracks the broader RBAC modernization.
- `xp.updated` — XP changes always ride on `learner.quiz_completed` / `learner.review_graded` payloads; a standalone event is redundant.

Premature eventification is a real anti-pattern; introduce events only when a synchronous alternative demonstrably hurts.

## 9. Relation to v1

v1 proposed events E1–E10. The mapping to the live registry:

| v1 proposed | v2 status |
|---|---|
| E1 `quiz.completed` | renamed `learner.quiz_completed` — schema-only; producer migration target |
| E2 `payment.completed` | renamed `billing.invoice_paid` — schema-only |
| E3 `subscription.cancelled` | NOT in registry; v1 over-proposed. Subscription lifecycle currently lives in `school_subscriptions.status` transitions written by the Razorpay webhook (PR #551). Add to registry only when a consumer needs it. |
| E4 `subscription.renewed` | NOT in registry; same logic as E3 |
| E5 `user.registered` | renamed `learner.signed_up` — schema-only |
| E6 `relationship.linked` | renamed `parent.linked_to_learner` — schema-only |
| E7 `school.provisioned` | NOT in registry; super-admin school creation writes `schools` directly. Add when a consumer needs it. |
| E8 `practice.completed` / `review.completed` | merged → `learner.review_graded` — ✅ live |
| E9 `foxy.message_sent` | split into `ai.foxy_session_started` / `ai.foxy_session_completed` — ✅ live |
| E10 `weak_area.detected` | NOT in registry; weak-area detection happens inside the assessment service today. Re-evaluate when CME engine is restructured. |

## 10. Relation to the brief

The original architectural brief named: `quiz.completed`, `practice.completed`, `review.completed`, `xp.updated`, `payment.confirmed`, `subscription.changed`, `tenant.provisioned`, `student.linked_to_parent`, `weak_area_detected`. Mapping after v2:

| Brief | This catalog | Status |
|---|---|---|
| `quiz.completed` | `learner.quiz_completed` | schema-only |
| `practice.completed`, `review.completed` | `learner.review_graded` | ✅ live |
| `xp.updated` | not proposed (see §8) | — |
| `payment.confirmed` | `billing.invoice_paid` | schema-only |
| `subscription.changed` | not in registry (see §9 E3, E4) | — |
| `tenant.provisioned` | not in registry (see §9 E7) | — |
| `student.linked_to_parent` | `parent.linked_to_learner` | schema-only |
| `weak_area_detected` | not in registry (see §9 E10) | — |

## 11. Uncertainty and gaps

- **Producer migration cadence.** ~10 of 16 events are schema-only. Each migration is a small PR (route emits `publishEvent`, subscriber consumes); the order is driven by which consumer needs the decoupling first. Currently `billing.invoice_paid` is the highest-leverage candidate — it unblocks decoupling welcome-email + entitlements writes from the webhook synchronous path.
- **Cross-actor namespaces.** A super-admin overriding a school's module is conceptually `platform.*` but is currently slotted under `school.module_toggled` for namespace consistency. Re-evaluate if `platform.*` becomes a useful actor for super-admin-originated events.
- **Volumetric data.** No production volumes recorded yet. Once 3+ producers are live and `state_events` has weeks of data, derive partitioning + archival cadence from observed growth — don't speculate.
- **Ordering across kinds.** Some downstream consumers (e.g., daily-schedule projector, when it lands) may want cross-stream ordering. The bus does not guarantee it. Such consumers must reconstruct order from `occurred_at` or accept eventual consistency.

## Change log

- **2026-05-16 v2** — full rewrite. Bus is live as of 2026-05-12; replaced "proposed" catalog with the 16 typed events from `src/lib/state/events/registry.ts` + producer status verified by grep. Restored philosophy sections from v1. Added v1→v2 mapping at §9, brief mapping at §10.
- **2026-04-24 v1** — initial catalog. Premised on "no event bus exists today"; proposed 10 events as the forward-looking inventory.
