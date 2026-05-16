# Runbook — dead-letter inspection

**Triggered by:**
- `projector-failure.md` step 7 — non-empty `subscriber_dead_letters` with `resolved_at IS NULL`
- PostHog `projector_health_degraded` event with `events_dead_lettered > 0`
- Manual audit of the spine's tail

**Owner:** subscriber owner (per [`DOMAIN_BOUNDARIES.md`](../architecture/DOMAIN_BOUNDARIES.md)) — usually B9 assessment for `concept-mastery-projector`, B11 notifications for the notification projector when it lands, etc.

## What a dead letter means

An event exhausted `maxRetries` attempts. The substrate moved it from `subscriber_retry_state` to `subscriber_dead_letters` and stopped advancing the subscriber's cursor past it. The subscriber is now **stuck**: every subsequent event of the same `kind_filter` accumulates behind the poison-pill event, and `events_behind` keeps growing.

There is no automatic retry. A human must inspect, decide, and act.

## 1. Read the rows

```sql
SELECT
  event_id,
  subscriber_name,
  attempt_count,
  last_error,
  first_attempted_at,
  last_attempted_at,
  EXTRACT(EPOCH FROM (last_attempted_at - first_attempted_at))::int AS retry_duration_seconds
FROM public.subscriber_dead_letters
WHERE resolved_at IS NULL
ORDER BY last_attempted_at DESC;
```

Pin the `event_id` and `subscriber_name` — every subsequent query keys off this pair.

## 2. Read the originating event

```sql
SELECT event_id, kind, occurred_at, idempotency_key, actor_auth_user_id, tenant_id, payload
FROM public.state_events
WHERE event_id = '<event_id from step 1>';
```

Read the payload. **This is the input that caused the handler to fail repeatedly.**

P13 — handle with care. Payloads are PII-redacted at publish time per `src/lib/state/events/publish.ts` invariant 1, but they may still contain `student_id`, `tenant_id`, and operational fields. Do not paste payloads into chat / Slack / PRs — keep them inside the secure operator surface.

## 3. Read the failure message

`last_error` (from step 1) is the message of the final exception thrown by the handler. Common shapes:

| Error contains | Likely cause | Decision |
|---|---|---|
| `violates check constraint` / `violates not-null` | Payload validates against the registry but a downstream column tightened. Schema-update race. | Fix the handler or relax the constraint; replay. |
| `foreign key constraint` / `is not present in table` | Event references an entity (student, school, concept) that no longer exists. Could be a deletion race. | Decide: drop (entity is gone) or restore the entity then replay. |
| `duplicate key value violates unique constraint` | Idempotency invariant breach — handler tried to write the same row twice. | Bug in handler; fix and replay. |
| `timeout` / `connection terminated` | Transient infra blip that the retry budget couldn't absorb. | Replay once; if it succeeds, mark resolved with note. |
| `bkt_update returned NaN` / `mastery_mean must be between 0 and 1` | Bad math in handler. Often paired with an unusual payload shape. | Fix handler arithmetic; replay; consider widening `bkt_update` input validation. |
| `permission denied for table` | RLS misconfiguration or service-role JWT issue. | Fix RLS or rotate service-role key; replay. |

If `last_error` is unfamiliar — escalate.

## 4. Decide: replay, drop, or escalate

**Replay** (default when handler bug is identified and fix is deployed):

Two distinct mechanisms exist; pick the one matching the situation.

**Unstick the dead letter** — when the goal is to re-process *this specific event* after the handler bug is fixed:

```sql
-- Clear the retry + dead-letter rows. The subscriber's next tick will
-- pick the event up via normal cursor advance.
DELETE FROM public.subscriber_retry_state
WHERE event_id = '<event_id>' AND subscriber_name = '<subscriber_name>';

UPDATE public.subscriber_dead_letters
SET resolved_at = NOW()
WHERE event_id = '<event_id>' AND subscriber_name = '<subscriber_name>'
  AND resolved_at IS NULL;
```

Substrate's `tickOne(subscriberName)` picks it up on the next minute tick.

**Rebuild a student's projection** — when the goal is to *re-run the subscriber over the student's full history* (e.g., a handler fix corrected mastery math and the student's `concept_mastery` row is now wrong):

```
POST /api/super-admin/projectors/replay
Authorization: <super-admin session cookie>
Content-Type: application/json
{
  "subscriberName": "<subscriber_name>",
  "studentId": "<student auth_user_id>"
}
```

Returns `{ replayed: <count>, errors: [] }`. The replay does NOT mutate `subscriber_offsets` — it's a read-side rebuild that depends on subscriber idempotency. See [`replay-by-student.md`](./replay-by-student.md) for the full procedure including when to use this vs. unstick, what to verify, and how to scope across many students.

**Drop** (when the event should not have been published, or the entity it references is gone):

```sql
UPDATE public.subscriber_dead_letters
SET resolved_at = NOW()
WHERE event_id = '<event_id>' AND subscriber_name = '<subscriber_name>'
  AND resolved_at IS NULL;
```

This advances past the poison pill without applying it. The event row in `state_events` is **not deleted** — the audit trail must remain intact. Record the drop decision in `audit_logs` via:

```sql
-- Operator action — record the manual drop for forensics.
INSERT INTO public.audit_logs (actor_auth_user_id, action, target_table, target_id, metadata)
VALUES (
  '<operator auth uuid>',
  'spine.dead_letter_dropped',
  'subscriber_dead_letters',
  '<event_id>',
  jsonb_build_object(
    'subscriber_name', '<subscriber_name>',
    'reason',          '<one-line operator justification>',
    'runbook',         'docs/runbooks/dead-letter-inspection.md'
  )
);
```

**Escalate** (when the cause is unclear, the event count is high, or you're not sure replay is safe): page the architect + the subscriber owner. Do not act until they're on the line.

## 5. Verify

After replay or drop:

```sql
-- Subscriber should advance past the formerly-stuck cursor on the next
-- tick (within ~60 s for projector-runner's 1-min cadence).
SELECT subscriber_name, events_behind, events_in_retry, events_dead_lettered, age_behind
FROM public.subscriber_lag
WHERE subscriber_name = '<subscriber_name>';
```

Expected:
- `events_in_retry = 0` (or decreasing if a backlog drained)
- `events_dead_lettered` is the historical count and does not decrease (intentional — the column tracks events that have *ever* dead-lettered, not current count). The current count is `SELECT count(*) FROM subscriber_dead_letters WHERE resolved_at IS NULL`.
- `events_behind` decreasing if the backlog is draining

`projector_health_degraded` PostHog events for this subscriber should stop within one health-check cycle (2 min).

## What NOT to do

- **Never** auto-replay every dead letter without inspecting each one. The bug may be in the *event* (bad payload from a misbehaving publisher) rather than in the handler. Replaying re-applies the bug.
- **Never** `DELETE FROM state_events` for the offending row. The audit trail must remain intact. Drop via `subscriber_dead_letters.resolved_at` only.
- **Never** flip `ff_projector_runner_v1` OFF to "clear" dead letters — flipping off pauses every subscriber; dead letters remain when the runner re-enables and will block re-start.
- **Never** raise `maxRetries` to make the symptom go away. The cap exists to surface poison pills; bypassing it just moves the symptom later.

## Common patterns

- **Repeated same dead letter across multiple subscribers** → bug in `publish.ts` validation or upstream payload constructor. Fix upstream, replay all affected.
- **One subscriber, many dead letters from a narrow time window** → infra blip during a deploy. Often safe to replay all once the deploy stabilized.
- **One subscriber, scattered dead letters across days** → handler bug that fires on specific payload shapes. Identify the shape, fix the handler, replay only the matching events.

## Related runbooks

- [`projector-failure.md`](./projector-failure.md) — the broader failure response that escalates here
- `replay-by-student.md` (Iteration 3) — surgical replay for a single student's history
- `forensic-quiz-investigation.md` — when the dead letter is a quiz-related event with student-visible impact
