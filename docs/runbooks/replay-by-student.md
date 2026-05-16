# Runbook — replay a subscriber for one student

**Triggered by:**
- A handler bug fix that corrected arithmetic / state derivation; affected students need their projection rebuilt
- An ad-hoc support request: "student X's mastery / schedule / entitlements look wrong"
- A QA scenario where a projection's correctness must be reproduced from event history
- Step 4 of [`dead-letter-inspection.md`](./dead-letter-inspection.md) when the operator decides on rebuild over unstick

**Owner:** assessment (mastery rebuilds), B11 notifications (notification log rebuilds), or whichever subscriber owner's projection is being rebuilt.

## Concept

The state-event bus persists every domain fact. A **subscriber** is a function `(event) → projection write`. The bus + a subscriber's idempotency contract means we can re-run the subscriber over the historical events and arrive at the same projection — modulo bugs we've since fixed. That is "replay."

Two cases are distinct:

| Case | Goal | Tool |
|---|---|---|
| **Unstick** | re-process one stuck event after a fix | SQL clear of `subscriber_retry_state` + `subscriber_dead_letters` ([`dead-letter-inspection.md`](./dead-letter-inspection.md)) |
| **Rebuild** | re-run the subscriber over a student's full history | `POST /api/super-admin/projectors/replay` (this runbook) |

Replay is a **read-side rebuild**. It does NOT mutate `subscriber_offsets` — the live cursor keeps advancing through new events while the rebuild runs in parallel. The subscriber's idempotency contract (per [`ADR-005-concept-first-adaptive-learning-spine.md`](../architecture/ADR-005-concept-first-adaptive-learning-spine.md) rule 2) makes this safe.

## When this is the right tool

- Handler arithmetic was wrong (e.g., BKT computed posterior incorrectly for a specific payload shape) and shipped to production. Affected students have wrong projection state today.
- A projection table was manually corrupted (rare; usually requires a backup restore instead).
- A subscriber was newly registered and you want it to "catch up" on a single student's history without consuming the whole bus.

## When this is NOT the right tool

- **The event itself was wrong.** Replaying re-applies the bug. Fix the publisher; new events are correct; old events stay wrong. Decide whether to accept the historical drift or perform a one-time correction migration.
- **The handler still has the bug.** Replay re-runs the broken code — nothing changes. Fix and deploy first; then replay.
- **You want to clear dead letters.** That's unstick, not rebuild. Use [`dead-letter-inspection.md`](./dead-letter-inspection.md).
- **You want to "reset" the subscriber globally.** This endpoint is per-student by design. Bus-wide rebuilds are a different operation (not currently exposed via API; would require migration-level work).

## Pre-conditions

1. Subscriber registered in `STANDARD_SUBSCRIBERS` (see `src/lib/state/subscribers/dispatcher.ts`). Use exact subscriber name — endpoint returns 404 `unknown_subscriber` otherwise.
2. Subscriber is **student-scoped** — implements `studentIdFromEvent`. Endpoint returns 422 `not_student_scoped` otherwise.
3. Handler fix is deployed (if this is post-bug-fix work). Verify via git log / Vercel deployment list.
4. Super-admin session — endpoint requires `authorizeAdmin` per [`src/app/api/super-admin/projectors/replay/route.ts:42`](../../src/app/api/super-admin/projectors/replay/route.ts). Internal-admin or school-admin sessions return 401.

## Step 1 — identify the student(s)

For a support ticket, the student is named. For a post-bug-fix sweep, identify affected students from the bug's payload shape:

```sql
-- Example: payload shape that triggered the bug had subjectCode = 'science'
-- and chapter_number > 10 between specific dates. Adapt to your bug's
-- actual signature.
SELECT DISTINCT actor_auth_user_id AS student_id, COUNT(*) AS event_count
FROM public.state_events
WHERE kind = 'learner.concept_check_answered'
  AND payload->>'subjectCode' = 'science'
  AND (payload->>'chapterNumber')::int > 10
  AND occurred_at BETWEEN '2026-05-10' AND '2026-05-12'
GROUP BY actor_auth_user_id
ORDER BY event_count DESC;
```

Save the list of `student_id` values for step 3.

## Step 2 — confirm the current projection state (sanity check)

Before replay, snapshot what the projection currently says so you can verify the change:

```sql
-- Example for concept-mastery-projector. Adjust target table per subscriber.
SELECT student_id, concept_id, mastery_mean, last_updated_at
FROM public.concept_mastery
WHERE student_id = '<student_id>'
ORDER BY last_updated_at DESC;
```

Copy the rows to a scratchpad. After replay, re-run the same query and diff.

## Step 3 — invoke the replay endpoint

For a single student:

```bash
curl -X POST 'https://<your-deploy>.alfanumrik.com/api/super-admin/projectors/replay' \
  -H 'Content-Type: application/json' \
  -H 'Cookie: <your super-admin session cookie>' \
  -d '{
    "subscriberName": "concept-mastery-projector",
    "studentId": "<student auth_user_id>"
  }'
```

Expected response (200):

```json
{
  "replayed": 47,
  "errors": []
}
```

`replayed` is the count of events the subscriber processed. `errors` is the list of events where the handler threw — investigate each one before declaring the rebuild successful.

Error shapes:

| HTTP | Body | Meaning |
|---|---|---|
| 400 | `{ error: 'Invalid body', detail: ... }` | malformed request |
| 401 | per `authorizeAdmin` | not a super-admin session |
| 404 | `{ error: 'unknown_subscriber' }` | `subscriberName` not in `STANDARD_SUBSCRIBERS` |
| 422 | `{ error: 'not_student_scoped' }` | subscriber doesn't implement `studentIdFromEvent` — replay can't scope to one student |
| 500 | `{ error: 'replay_failed', detail: '...' }` | dispatcher threw beyond `unknown_subscriber` — check Sentry |

## Step 4 — for many students, loop with care

Replay is single-student. For a sweep, drive from the affected-students list:

```bash
# Pipe student IDs from a file, one per line.
while read student_id; do
  echo "Replaying for $student_id..."
  curl -s -X POST 'https://<your-deploy>.alfanumrik.com/api/super-admin/projectors/replay' \
    -H 'Content-Type: application/json' \
    -H 'Cookie: <super-admin session cookie>' \
    -d "{\"subscriberName\":\"concept-mastery-projector\",\"studentId\":\"$student_id\"}" \
    | jq '.'
  sleep 1  # rate-limit ourselves; the endpoint has no built-in throttle
done < affected-students.txt
```

Considerations for sweep runs:

- **Throttle.** The endpoint reads from `state_events` per call; a tight loop hammers the DB. Default to ≥ 1 second between calls; less aggressive at scale.
- **Idempotency.** Re-running for the same student is safe — produces the same projection. So if the loop crashes mid-way, re-run the whole list; no harm done.
- **Log all responses.** Pipe `jq` output to a timestamped log file. Investigate every entry with `errors: [...]` non-empty before declaring success.
- **Pause new feature work on the affected surface** while the sweep runs — concurrent product traffic against the projection table can interleave with replay writes and confuse later auditing. Most replays finish in minutes; if your sweep is hours, consider flag-off-ing the feature for the window.

## Step 5 — verify the projection

Re-run the snapshot query from step 2:

```sql
SELECT student_id, concept_id, mastery_mean, last_updated_at
FROM public.concept_mastery
WHERE student_id = '<student_id>'
ORDER BY last_updated_at DESC;
```

Diff against the pre-replay snapshot. Expected diff:

- Rows for events that triggered the bug now show corrected `mastery_mean`.
- `last_updated_at` advances to the time of replay.
- Row count should match (replay rebuilds same rows; doesn't create new ones unless events existed without prior projection — rare).
- No rows lost. Replay is additive (UPSERT); rebuilds cannot delete.

If any row looks wrong post-replay, **stop**. Either the handler fix is incomplete, the bug is different than diagnosed, or the event payload itself was the bug. Escalate before further sweep.

## Step 6 — audit-log the operation

Manual replays are operationally significant. Record:

```sql
-- The route's logger.info already emits 'projector_replay_invoked' with
-- admin_user_id, subscriber, student_id. For sweep operations, also write
-- a summary row.
INSERT INTO public.audit_logs (actor_auth_user_id, action, target_table, target_id, metadata)
VALUES (
  '<operator auth uuid>',
  'spine.replay_sweep_completed',
  'subscriber_offsets',
  '<subscriber_name>',
  jsonb_build_object(
    'student_count',    <count from affected-students.txt>,
    'reason',           '<one-line justification — bug ID, PR link>',
    'started_at',       '<ISO timestamp>',
    'completed_at',     '<ISO timestamp>',
    'errors_observed',  <count of curl responses with non-empty errors[]>,
    'runbook',          'docs/runbooks/replay-by-student.md'
  )
);
```

## What replay does NOT do

- **Does not advance `subscriber_offsets`.** Live new events keep flowing; the cursor is unaffected.
- **Does not delete projection rows.** UPSERT only. If a row exists from a since-deleted historical event, it stays after replay (subscriber idempotency contract — handlers UPSERT, not DELETE).
- **Does not retry failed handler calls forever.** If the handler throws during replay, the event is added to the `errors` array of the response and replay moves on. Stuck events do NOT land in `subscriber_dead_letters` from replay — those are live-tick concepts.
- **Does not work for non-student-scoped subscribers.** A subscriber that doesn't implement `studentIdFromEvent` (e.g., a bus-wide audit-log projector) returns 422. A bus-wide rebuild is a different operation, not yet exposed via API.
- **Does not bypass RLS.** The route uses `supabaseAdmin` (service role) so RLS is bypassed for the read; the handler writes are governed by its own policies.

## Common pitfalls

1. **Replay before handler fix deploys.** Re-runs broken code; no projection improvement. Always verify the fix is in production first.
2. **Forgetting to snapshot before replay.** Diff becomes impossible to confirm.
3. **Sweeping without throttle.** DB pressure spikes; concurrent product traffic degrades. Always sleep between calls.
4. **Treating 200 with non-empty `errors`as success.** Read each error; do not declare done.
5. **Confusing the two replay mechanisms.** Unstick (`subscriber_retry_state` clear) is for live-tick stuck events. Rebuild (this endpoint) is for projection rebuild from history. Using the wrong one wastes time without fixing the symptom.

## Related runbooks

- [`projector-failure.md`](./projector-failure.md) — broader response when the runner or substrate is degraded
- [`dead-letter-inspection.md`](./dead-letter-inspection.md) — per-event triage that may hand off to replay
- [`vault-secret-rotation.md`](./vault-secret-rotation.md) — when the admin session can't authenticate
- [`forensic-quiz-investigation.md`](./forensic-quiz-investigation.md) — when the projection drift is quiz-related and student-visible
