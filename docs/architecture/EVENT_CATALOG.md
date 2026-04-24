# Event catalog (v1)

**As of:** 2026-04-24, branch `feat/stabilization-phase-0`.
**Status:** **no event bus exists today.** This document is a forward-
looking catalog of the events that WOULD be needed if and when a
service extraction happens (see
[`MICROSERVICES_EXTRACTION_PLAN.md`](./MICROSERVICES_EXTRACTION_PLAN.md)).
Every entry below is labelled **proposed** because none are implemented.

The abandoned v0 of this document listed 30+ events without
implementation intent — most were speculative. This version:

1. Lists only events for which a real synchronous coupling exists today
   (so we know which boundary would need to become asynchronous).
2. Names the **producing code path** that already exists.
3. Names the **consumers that would subscribe**.
4. Does not pretend a bus exists.

## Why an outbox pattern, not a distributed bus?

When (if) we start emitting events, the recommended mechanism is an
**outbox table + polling worker** inside the existing Supabase
Postgres. Concretely:

- Producers write event rows into `public.domain_events` in the same
  transaction as the source state change.
- A single worker (Edge Function `queue-consumer` already exists and
  can be repurposed) polls the outbox, dispatches to consumers
  (Postgres triggers, Edge Functions, or future services), and marks
  events processed.

This gives us event-driven integration **without** introducing Kafka,
SQS, Redis Streams, or any new vendor dependency — fitting the
brief's constraint "Do not invent infrastructure that the project
cannot realistically run."

**The `public.domain_events` table does not exist today.** It would
be created in Phase 0d.

## Event envelope (proposed)

```sql
CREATE TABLE public.domain_events (
  event_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type     TEXT NOT NULL,          -- e.g. 'quiz.completed'
  aggregate_type TEXT NOT NULL,          -- e.g. 'quiz_session'
  aggregate_id   UUID NOT NULL,          -- FK to the aggregate row
  payload        JSONB NOT NULL,         -- domain-specific
  correlation_id UUID,                   -- propagated from origin request
  causation_id   UUID,                   -- parent event_id (or NULL)
  actor_id       UUID,                   -- user who triggered (if any)
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ,            -- set by consumer worker
  failed_at      TIMESTAMPTZ,            -- set on DLQ move
  error_message  TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_domain_events_unprocessed
  ON public.domain_events (occurred_at)
  WHERE processed_at IS NULL;
```

## Catalog

### E1. `quiz.completed`  (proposed)

**Source of truth today:** `atomic_quiz_profile_update` RPC in
[`supabase/migrations/20260325160000_atomic_quiz_profile_update.sql`](../../supabase/migrations/).

**Producer (proposed):** append row to `domain_events` at the end of
the same RPC transaction, immediately after `UPDATE students SET
xp_total ...`.

**Payload (proposed):**
```json
{
  "student_id": "uuid",
  "subject": "string",
  "xp_earned": 42,
  "score_percent": 85,
  "total_questions": 10,
  "correct_answers": 8,
  "time_seconds": 123,
  "chapter_number": 5,
  "bloom_distribution": { "remember": 3, "apply": 5 }
}
```

**Current synchronous consumers (would switch to async):**
- Daily activity aggregation (`daily_activity` table) — already
  written in the same RPC; could stay sync or move async later
- Analytics dashboards read via polling; no sync coupling

**Future / new consumers:**
- B9 Assessment — updates `concept_mastery` using the response data
  (today this is a separate call from the quiz submit handler)
- B11 Notifications — fire "daily quiz streak" notifications at
  end of the day once all expected quizzes are complete
- B12 Analytics — update `student_analytics` aggregates

**Why this is a good first event:** the RPC already owns atomic
writes; adding one more `INSERT INTO domain_events` is trivial and
safe. All downstream consumers are today read-only against the
tables being written; switching them to read from the outbox instead
of polling the base tables is a clean boundary.

### E2. `payment.completed` (proposed)

**Source of truth today:** `activate_subscription` RPC and
`atomic_subscription_activation` RPC (new on this branch).

**Producer (proposed):** append to `domain_events` at the end of the
activation transaction.

**Payload (proposed):**
```json
{
  "student_id": "uuid",
  "payment_id": "uuid",
  "razorpay_payment_id": "string",
  "razorpay_subscription_id": "string | null",
  "plan_code": "string",
  "billing_cycle": "monthly | yearly",
  "amount_inr": 29900,
  "current_period_end": "2026-05-24T00:00:00Z"
}
```

**Consumers:**
- B11 Notifications — send welcome / upgrade email via
  `send-welcome-email` (today, this is invoked synchronously from
  the webhook route; async would be more robust against email
  provider outages)
- B12 Analytics — MRR / churn dashboards
- B7 Foxy — quota reset / upgrade (today read via
  `check_and_record_usage`)

**Why second priority:** the webhook is already idempotent (unique
index on `razorpay_payment_id`), so adding an outbox row is safe
against duplicate deliveries. Event also unlocks decoupling the
welcome-email send — currently a failure in email delivery can break
the webhook response, which Razorpay then retries.

### E3. `subscription.cancelled` (proposed)

**Source of truth today:** `/api/payments/cancel/route.ts`.

**Payload (proposed):**
```json
{
  "student_id": "uuid",
  "razorpay_subscription_id": "string | null",
  "cancel_reason": "string | null",
  "cancelled_at": "2026-04-24T12:00:00Z",
  "ended_at": "2026-05-24T00:00:00Z"
}
```

**Consumers:** B11 Notifications (win-back email), B12 Analytics
(churn).

### E4. `subscription.renewed` (proposed, webhook-triggered)

**Source of truth today:** `razorpay.subscription.charged` webhook
→ `/api/payments/webhook/route.ts`.

Same payload shape as E2.

### E5. `user.registered` (proposed)

**Source of truth today:** `bootstrap_user_profile` RPC.

**Consumers:**
- B11 Notifications — welcome email (today, the
  `send-welcome-email` Edge Function is called from the signup
  flow — could move async)
- B12 Analytics — funnel metrics
- Auto-free subscription trigger (today in
  [`supabase/migrations/20260409000002_auto_free_subscription_on_signup.sql`](../../supabase/migrations/20260409000002_auto_free_subscription_on_signup.sql))
  — this is an implicit DB trigger today; making it an event would
  make the flow observable

### E6. `relationship.linked` (proposed)

**Source of truth today:** `/api/parent/approve-link/route.ts`
inserts into `guardian_student_links`.

**Consumers:**
- B11 Notifications — inform student "your parent is now linked"
- B3 Parent portal — refresh dashboard
- B12 Analytics — engagement funnel

### E7. `school.provisioned` (proposed)

**Source of truth today:** super-admin school creation endpoint
under `/api/super-admin/*`.

**Consumers:**
- B2 Tenant — seed default classes, admin user
- B10 Billing — create draft subscription plan
- B11 Notifications — welcome email to school admin
- B12 Analytics

### E8. `practice.completed` / `review.completed` (proposed)

**Source of truth today:** SM-2 update path in `/api/review/*`.

**Consumers:** B9 Assessment, B12 Analytics, B11 Notifications
(streak milestones).

### E9. `foxy.message_sent` (proposed; sampled)

**Source of truth today:** `/api/foxy/route.ts` / `grounded-answer`
Edge Function writes `foxy_chat_messages` + `grounded_ai_traces`.

**Payload (proposed, PII-redacted):**
```json
{
  "session_id": "uuid",
  "student_id": "uuid",
  "trace_id": "uuid",
  "grounding_status": "verified | unverified | hard_abstain | fallback",
  "confidence": 0.87,
  "token_usage": { "input": 450, "output": 120 },
  "latency_ms": 2300
}
```

**Why sampled:** at 100% volume this would swamp the outbox. Sample
at 10% (or all abstain + fallback events, 100% of errors).

**Consumers:** B13 Ops (grounding health dashboard, already exists
per commit `5e0d354`), B9 Assessment (response-quality signal).

### E10. `weak_area.detected` (proposed)

**Source of truth today:** `cme-engine` Edge Function heuristics.

**Consumers:** B8 Practice (schedule reinforcement cards), B11
Notifications (gentle nudge), B9 Assessment (gap tracking).

## Explicitly NOT proposed (yet)

Events that sound reasonable but have no concrete producer today or
duplicate existing well-working flows:

- `question.answered` — too fine-grained; the RPC already captures
  this as a transactional write, no consumer needs individual
  answers as an async stream
- `content.question_added` — content ingestion is already queued
  via `queue-consumer`; no need to wrap in an event layer on top
- `mastery.achieved` — milestone-style events; nice-to-have, defer
- `role.assigned` — RBAC changes are low-volume and can poll

Premature eventification is a real anti-pattern; prefer to introduce
events when the synchronous alternative demonstrably hurts.

## Schema evolution rules (proposed)

- Event types are versioned by suffix (`quiz.completed.v1`,
  `quiz.completed.v2`) — never mutate a schema in place
- Consumers must handle an unknown event type by acknowledging and
  ignoring (not erroring), so new event types don't break old consumers
- Payload fields are additive only within a version
- Breaking changes require a new `.vN` and a dual-publish period

## Delivery guarantees (proposed)

- **At-least-once** delivery from outbox
- Consumers must be **idempotent**. All our high-value consumers
  already can be made idempotent cheaply: `concept_mastery` uses
  `ON CONFLICT`; analytics aggregates can use `MERGE` / `ON
  CONFLICT`; notifications can use a dedup key.

## Observability (proposed)

- Outbox lag metric: `max(NOW() - occurred_at) WHERE processed_at IS NULL`
  — alert above 60 s
- Consumer error rate per event type
- Dead-letter queue table `public.domain_events_dlq` for events that
  exceeded `attempts` (proposed cap 5)
- Surface these in the existing super-admin observability dashboards

## Relation to the brief

The original brief (Section 12) named this set of example events:

> `quiz.completed`, `practice.completed`, `review.completed`,
> `xp.updated`, `payment.confirmed`, `subscription.changed`,
> `tenant.provisioned`, `student.linked_to_parent`,
> `weak_area_detected`

Mapping to this catalog:

| Brief name | This catalog |
|---|---|
| `quiz.completed` | E1 |
| `practice.completed`, `review.completed` | E8 (merged — same path) |
| `xp.updated` | **not proposed** — XP changes always ride on E1 / E8; a standalone event is redundant |
| `payment.confirmed` | E2 |
| `subscription.changed` | E3, E4 (split by direction) |
| `tenant.provisioned` | E7 |
| `student.linked_to_parent` | E6 |
| `weak_area_detected` | E10 |

## Uncertainty / gaps

- **Ordering:** outbox delivery is per-aggregate-id; across aggregates
  no ordering is guaranteed. Consumers that need cross-stream
  ordering (rare) must reconstruct via `occurred_at`.
- **Volume:** no volumetric data exists for the proposed streams.
  E9 is the only one likely to be high-volume. Capacity sizing is
  deferred until at least one stream is in production.
- **Backpressure:** outbox can grow unbounded if consumers fall
  behind. Mitigation: monitor lag metric + pause producers if
  exceeded (backpressure via RLS on domain_events is overkill today).
