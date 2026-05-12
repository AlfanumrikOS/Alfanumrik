# State Runtime Hardening — Per-subscriber cursors, persistent retries, dead letters, replay (Design)

**Date:** 2026-05-12 (revised after second CEO review — dead-letter semantics + cron drift fixed)
**Status:** Draft — awaiting CEO review
**Parent ADR:** [ADR-005 — Concept-First Adaptive Learning Spine](../../architecture/ADR-005-concept-first-adaptive-learning-spine.md)
**Companion spec:** [ADR-004 Phase 2 — BKT via concept-mastery-projector](./2026-05-12-adr-004-phase-2-bkt-projector-design.md)
**Ships as:** PR 1 of the two-PR Phase 2 sequence. **No learner-visible behaviour change.**
**Flag:** `ff_projector_runner_v1` (new, default OFF)

## Context

ADR-005 pins: *no API route is a canonical writer of learner state*. The runtime that enforces this rule already exists — there is no need to build a second one. PR 1 hardens what's there.

What exists today:

| Component | File | Status |
|---|---|---|
| Single publish path | [`src/lib/state/events/publish.ts`](../../../src/lib/state/events/publish.ts) | Live. Flag-gated on `ff_event_bus_v1`. Returns `PublishResult { published, reason }`. |
| 1-second polling listener | [`src/lib/state/runtime/event-listener.ts`](../../../src/lib/state/runtime/event-listener.ts) | Exists. `tick()` (one pass), `run()` (loop). |
| Fan-out dispatcher | [`src/lib/state/subscribers/dispatcher.ts`](../../../src/lib/state/subscribers/dispatcher.ts) | Exists. Subscriber-throwing doesn't abort others. |
| Concrete subscriber | [`src/lib/state/subscribers/mastery-state-writer.ts`](../../../src/lib/state/subscribers/mastery-state-writer.ts) | Live. Writes chapter-level `learner_mastery` for `learner.mastery_changed`. **Keep — legacy.** |
| Cursor | `public.bus_cursor`, key `state_events_watermark` | Live. Single global cursor. |

What's missing:

1. **Per-subscriber cursors.** Today one slow/failing subscriber stalls all others.
2. **Persistent retry state across ticks.** Today the in-memory 5-tick quarantine resets if the process restarts.
3. **Dead-letter table with attempt history.** Today there's only a `quarantined_at` column hint.
4. **Filtered replay command.** Today there's no way to re-run a subscriber over a slice of events without mutating the live cursor.
5. **Lag observability.** No queryable view of per-subscriber lag.
6. **Production invocation.** No live cron driving `tick()`.
7. **A kill switch flag.**

PR 1 addresses 1–7 by **extending the existing runtime**. No new `src/lib/projectors/*` directory. No new event kinds. No new subscribers. No learner-visible change.

## Goals

1. Each registered subscriber advances independently. Failure isolation per subscriber.
2. **Retry state persists across ticks.** A failing event accumulates attempts in a `subscriber_retry_state` row; when `attempt_count >= maxRetries`, dead-letter and advance the cursor.
3. Dead-letter table records the final `attempt_count`, error, and first/last attempted timestamps.
4. `replayForStudent(subscriberName, studentId)` re-invokes one subscriber for matching events **without mutating the live cursor**.
5. Per-subscriber lag is queryable in SQL and emitted as a PostHog event after every tick.
6. `tick()` is invoked by `pg_cron` at 1-minute cadence (Supabase's pg_cron minimum) via `pg_net.http_post` to a Supabase Edge Function.
7. `ff_projector_runner_v1` is the kill switch.

## Non-Goals

- New event kinds, new subscribers, BKT logic — all PR 2.
- Deprecating the legacy chapter-level `mastery-state-writer` — a future PR.
- `pg_notify`-driven low-latency listening — future enhancement.
- Exactly-once delivery (at-least-once + idempotent handlers is the contract).
- Backpressure on publishers.

## Architecture

```
publishEvent (existing, ff_event_bus_v1)
   └── INSERT state_events
              ▼
        ┌────────────────────────────────────────────────────────────┐
        │ pg_cron job (every 1 minute) calls pg_net.http_post → ...  │
        │                                                            │
        │ Edge Function: projector-runner                            │
        │ ┌────────────────────────────────────────────────────────┐ │
        │ │ if !ff_projector_runner_v1 → return {skipped:true}     │ │
        │ │                                                        │ │
        │ │ for each subscriber S:                                 │ │
        │ │   tickOne(S):                                          │ │
        │ │     cursor = subscriber_offsets[S.name]                │ │
        │ │     events = state_events                              │ │
        │ │              WHERE kind = S.kindFilter                 │ │
        │ │                AND (occurred_at, event_id) >           │ │
        │ │                    (cursor.last_occurred_at,           │ │
        │ │                     cursor.last_event_id)              │ │
        │ │              ORDER BY occurred_at, event_id            │ │
        │ │              LIMIT batchSize                           │ │
        │ │     for each event E in order:                         │ │
        │ │       prior_attempts = subscriber_retry_state[E.id]    │ │
        │ │                        ?? 0                            │ │
        │ │       try S.handle(E, ctx)                             │ │
        │ │       on success:                                      │ │
        │ │         DELETE subscriber_retry_state                  │ │
        │ │         advance cursor past E                          │ │
        │ │       on failure:                                      │ │
        │ │         new_count = prior_attempts + 1                 │ │
        │ │         if new_count >= S.maxRetries (default 3):      │ │
        │ │           INSERT subscriber_dead_letters               │ │
        │ │           DELETE subscriber_retry_state                │ │
        │ │           advance cursor past E (don't block queue)    │ │
        │ │         else:                                          │ │
        │ │           UPSERT subscriber_retry_state                │ │
        │ │             (event_id, S.name, new_count, error)       │ │
        │ │           STOP processing this subscriber's batch      │ │
        │ │           (cursor unchanged; retry next tick)          │ │
        │ │     capture posthog summary                            │ │
        │ └────────────────────────────────────────────────────────┘ │
        └────────────────────────────────────────────────────────────┘

Admin replay (does NOT mutate subscriber_offsets):
   POST /api/admin/projectors/replay { subscriberName, studentId }
     → state_events.filter(kind=S.kindFilter, payload.studentId=studentId)
       .map(e => S.handle(e, ctx))
     → return { replayed, errors }
```

### Dead-letter semantics (the one model)

- One tick = one attempt per (event, subscriber).
- `subscriber_retry_state` tracks attempt counts persistently across ticks.
- After `maxRetries` total failed attempts (across N ticks): move to `subscriber_dead_letters`, advance cursor past the event, continue.
- With default `maxRetries=3` and 1-minute cron: a permanently-broken event blocks its subscriber for ~3 minutes before dead-lettering. Other subscribers unaffected.
- Transient failures (recover by retry 2 or 3) self-heal; retry_state cleaned up on success.
- Process restarts do not reset retry counters (they're in the DB).

This replaces the in-memory N-retries-per-tick model in the old draft, which contradicted the "across ticks" semantics in the tests.

## Schema

```sql
-- 20260522000001_state_runtime_per_subscriber.sql

-- Per-subscriber watermarks.
CREATE TABLE IF NOT EXISTS public.subscriber_offsets (
  subscriber_name             text         PRIMARY KEY,
  kind_filter                 text         NOT NULL,
  last_processed_event_id     uuid                  NULL,
  last_processed_occurred_at  timestamptz           NULL,
  events_processed            bigint       NOT NULL DEFAULT 0,
  events_dead_lettered        bigint       NOT NULL DEFAULT 0,
  updated_at                  timestamptz  NOT NULL DEFAULT now()
);

-- Persistent retry state. Cleared on success; promoted to dead_letters
-- when attempt_count reaches maxRetries.
CREATE TABLE IF NOT EXISTS public.subscriber_retry_state (
  event_id            uuid         NOT NULL,
  subscriber_name     text         NOT NULL,
  attempt_count       int          NOT NULL,
  first_attempted_at  timestamptz  NOT NULL DEFAULT now(),
  last_attempted_at   timestamptz  NOT NULL DEFAULT now(),
  last_error          text         NOT NULL,
  PRIMARY KEY (event_id, subscriber_name)
);

-- Terminal: events that exhausted all retries.
CREATE TABLE IF NOT EXISTS public.subscriber_dead_letters (
  event_id             uuid         NOT NULL,
  subscriber_name      text         NOT NULL,
  attempt_count        int          NOT NULL,
  last_error           text         NOT NULL,
  first_attempted_at   timestamptz  NOT NULL,
  last_attempted_at    timestamptz  NOT NULL DEFAULT now(),
  resolved_at          timestamptz           NULL,
  PRIMARY KEY (event_id, subscriber_name)
);

-- Hot-path index on the bus.
CREATE INDEX IF NOT EXISTS idx_state_events_kind_occurred_event
  ON public.state_events (kind, occurred_at, event_id);

-- RLS: service_role only.
ALTER TABLE public.subscriber_offsets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriber_retry_state   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriber_dead_letters  ENABLE ROW LEVEL SECURITY;

-- Per-subscriber lag view (kind-filter join, with tiebreaker).
CREATE OR REPLACE VIEW public.subscriber_lag AS
SELECT
  so.subscriber_name,
  so.kind_filter,
  so.last_processed_occurred_at,
  so.events_processed,
  so.events_dead_lettered,
  (
    SELECT COUNT(*)
    FROM public.state_events se
    WHERE se.kind = so.kind_filter
      AND (se.occurred_at, se.event_id) >
          (COALESCE(so.last_processed_occurred_at, '1970-01-01'::timestamptz),
           COALESCE(so.last_processed_event_id, '00000000-0000-0000-0000-000000000000'::uuid))
  ) AS events_behind,
  (
    SELECT COUNT(*) FROM public.subscriber_retry_state
    WHERE subscriber_name = so.subscriber_name
  ) AS events_in_retry,
  NOW() - COALESCE(so.last_processed_occurred_at, NOW()) AS age_behind
FROM public.subscriber_offsets so;

-- Seed offsets at NOW so PR 1 does not retroactively replay history.
INSERT INTO public.subscriber_offsets (subscriber_name, kind_filter, last_processed_occurred_at)
VALUES ('mastery-state-writer', 'learner.mastery_changed', NOW())
ON CONFLICT (subscriber_name) DO NOTHING;

-- Kill-switch flag.
INSERT INTO public.feature_flags (
  flag_name, description, is_enabled, rollout_percentage, target_environments
)
VALUES (
  'ff_projector_runner_v1',
  'ADR-005 PR 1: kill-switch for the projector-runner Edge Function. When OFF, the runner returns immediately. See docs/superpowers/specs/2026-05-12-projector-substrate-design.md',
  false, 0, ARRAY['production','staging']::text[]
)
ON CONFLICT (flag_name) DO NOTHING;
```

Timestamp `20260522000001` provisional — must be later than the latest applied migration.

### Cron setup (pg_cron + pg_net)

A second migration adds the cron schedule. Supabase pg_cron supports 1-minute cadence as the minimum.

```sql
-- 20260522000002_projector_runner_cron.sql

-- Requires pg_cron and pg_net extensions enabled on the Supabase project.
-- Both are standard on Supabase Pro; verified pre-existing for this project.

-- The Edge Function URL is project-specific; passed via Vault for prod/staging.
-- The service-role key sits in Vault as well; never inlined here.

SELECT cron.schedule(
  job_name := 'projector-runner-tick',
  schedule := '*/1 * * * *',  -- every minute
  command  := $$
    SELECT net.http_post(
      url := current_setting('app.projector_runner_url'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('source', 'pg_cron'),
      timeout_milliseconds := 30000
    );
  $$
);

-- Setup the GUC entries that the cron command reads.
-- Done out-of-band via Supabase Vault → ALTER DATABASE ... SET app.* = ...
-- before this migration runs. The migration assumes the GUCs exist.
```

(If the project hasn't enabled `pg_cron`/`pg_net`, the PR adds an `ALTER` to enable them and a setup step in the runbook. Verify at PR-author time.)

Cadence note: 1 minute is the minimum Supabase pg_cron supports. The cron triggers a single `tickAll` invocation per minute. Sub-minute latency is a future enhancement (post-publish ad-hoc trigger from publishers, or pg_notify-driven worker).

## Code changes

### `src/lib/state/subscribers/subscriber.ts` + `types.ts` (modify)

Extend the `Subscriber` interface:

```ts
export interface Subscriber<K extends DomainEventKind> {
  name: string;
  kind: K;
  /** Default 3. Total attempts across ticks before dead-letter. */
  maxRetries?: number;
  handle(event: DomainEvent<K>, ctx: SubscriberContext): Promise<void>;
  /**
   * Optional. Maps a payload to the student it concerns. Required to
   * support replayForStudent; absence makes the subscriber not-student-scoped
   * and replay refuses with `not_student_scoped`.
   */
  studentIdFromEvent?(event: DomainEvent<K>): string | null;
}
```

### `src/lib/state/runtime/event-listener.ts` (modify, ~150 lines changed)

Replace `tick()` with `tickAll()` that loops per subscriber:

```ts
export async function tickAll(opts: ListenerOptions): Promise<TickAllResult> {
  if (!(await isProjectorRunnerEnabled(opts.sb))) {
    return { skipped: true, perSubscriber: [] };
  }
  const dispatcher = opts.dispatcher ?? standardDispatcher;
  const results = [];
  for (const sub of dispatcher.list()) {
    results.push(await tickOne(sub, opts));
  }
  return { skipped: false, perSubscriber: results };
}

async function tickOne(sub: AnySubscriber, opts: ListenerOptions): Promise<TickOneResult> {
  const maxRetries = sub.maxRetries ?? 3;
  const cursor = await readSubscriberOffset(opts.sb, sub.name);
  const events = await fetchEventsAfterCursor(opts.sb, sub.kind, cursor, opts.batchSize ?? 100);

  let processed = 0, deadLettered = 0;
  let advanceTo = cursor;

  for (const event of events) {
    const priorAttempts = await readRetryCount(opts.sb, event.event_id, sub.name);
    try {
      await sub.handle(event, opts.ctx);
      await clearRetryState(opts.sb, event.event_id, sub.name);
      processed += 1;
      advanceTo = { last_processed_occurred_at: event.occurred_at, last_processed_event_id: event.event_id };
    } catch (err: unknown) {
      const newCount = priorAttempts + 1;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (newCount >= maxRetries) {
        // Terminal: dead-letter and skip past.
        await insertDeadLetter(opts.sb, event, sub.name, newCount, errMsg);
        await clearRetryState(opts.sb, event.event_id, sub.name);
        deadLettered += 1;
        advanceTo = { last_processed_occurred_at: event.occurred_at, last_processed_event_id: event.event_id };
      } else {
        // Transient: persist retry state, stop processing more events.
        await upsertRetryState(opts.sb, event.event_id, sub.name, newCount, errMsg);
        break;  // Next tick retries this event.
      }
    }
  }

  if (advanceTo !== cursor) {
    await writeSubscriberOffset(opts.sb, sub.name, advanceTo, processed, deadLettered);
  }
  return { subscriberName: sub.name, processed, deadLettered, eventsBehind: /* computed */ };
}
```

The legacy `tick()` (global cursor) stays as a thin adapter for the standalone script, deprecated, deleted in the post-rollout follow-up.

### `src/lib/state/subscribers/dispatcher.ts` (modify, ~50 lines)

Add `replayForStudent`:

```ts
async replayForStudent(
  subscriberName: string,
  studentId: string,
  ctx: SubscriberContext,
): Promise<ReplayResult> {
  const sub = this.list().find(s => s.name === subscriberName);
  if (!sub) throw new Error(`unknown subscriber: ${subscriberName}`);
  if (!sub.studentIdFromEvent) {
    return { refused: 'not_student_scoped' };
  }
  const events = await ctx.sb
    .from('state_events')
    .select('*')
    .eq('kind', sub.kind)
    .filter('payload->>studentId', 'eq', studentId)
    .order('occurred_at', { ascending: true })
    .order('event_id', { ascending: true });

  let replayed = 0;
  const errors: Array<{ eventId: string; message: string }> = [];
  for (const row of events.data ?? []) {
    const event = parseEventRow(row);
    if (!event) continue;
    try {
      await sub.handle(event, ctx);
      replayed += 1;
    } catch (err) {
      errors.push({ eventId: event.eventId, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { replayed, errors };
}
```

### `src/app/api/admin/projectors/replay/route.ts` (new, ~80 lines)

`POST` admin endpoint. Body `{ subscriberName, studentId }`. Calls `dispatcher.replayForStudent(...)`. Audit log entry. Returns the result.

### `supabase/functions/projector-runner/index.ts` (new, ~60 lines)

Edge Function called by pg_cron via pg_net. Reads the service-role client, calls `tickAll`, captures `projector_runner_summary` PostHog event, returns JSON of per-subscriber results.

## Testing

### Unit — extended

- `event-listener.test.ts`: per-subscriber cursors advance independently. Mock subscriber that always fails: its cursor does NOT advance until dead-letter; other subscribers do.
- New: `dead-letter.test.ts`:
  - Insert 1 always-failing event. Run `tickAll`. After tick 1: `subscriber_retry_state.attempt_count=1`; cursor unchanged.
  - Run `tickAll` again. After tick 2: `attempt_count=2`; cursor unchanged.
  - Run `tickAll` again. After tick 3: row moved to `subscriber_dead_letters` with `attempt_count=3`; `retry_state` cleaned up; cursor advanced past the event.
- New: `replay-for-student.test.ts`: replay re-invokes handler; live cursor untouched; subscriber without `studentIdFromEvent` returns `{ refused: 'not_student_scoped' }`.

### Integration

- Insert 50 events for student A + 50 for student B. Run `tickAll`. Verify cursor at event 100, `events_processed=100`.
- Inject deliberately-failing subscriber + 1 bad event + 9 good events past it. Run `tickAll` 3 times. After tick 3: bad event in `subscriber_dead_letters` with `attempt_count=3`; remaining 9 good events processed; cursor at event 10.
- Replay endpoint test: insert 5 events for student A; `tickAll` projects them; POST replay → handler called 5 more times; cursor unchanged.

### Manual smoke (staging)

- Flip `ff_projector_runner_v1` ON in staging.
- Confirm pg_cron fires every minute (`SELECT * FROM cron.job_run_details WHERE jobname='projector-runner-tick' ORDER BY start_time DESC LIMIT 5`).
- Watch Edge Function logs.
- Insert a deliberately-malformed `learner.mastery_changed` event. After 3 cron firings (≈3 minutes), it appears in `subscriber_dead_letters` with `attempt_count=3`.
- Flip flag OFF. Confirm next invocation returns `{ skipped: true }` and no cursors move.

## Migration

```
supabase/migrations/20260522000001_state_runtime_per_subscriber.sql
supabase/migrations/20260522000002_projector_runner_cron.sql
```

The second migration depends on `pg_cron` + `pg_net` being enabled on the project. If not yet enabled, prepend `CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net;` (these require admin role; staging-first).

## Rollout

1. PR 1 merges. Flag OFF. Migration applies in staging via `Sync Migrations to Staging`. pg_cron job created but Edge Function returns `{ skipped: true }`.
2. CEO flips `ff_projector_runner_v1` ON in staging.
3. Soak for 24 h. Verify:
   - `subscriber_lag.events_behind` stays low for `mastery-state-writer`
   - `subscriber_dead_letters` empty
   - `subscriber_retry_state` empty (no failures expected from real events)
   - pg_cron `job_run_details` shows successful HTTP 200 responses
   - `learner_mastery` writes continue (existing chapter-level path unaffected)
4. Flip ON in production.
5. PR 2 lands. New subscriber `concept-mastery-projector` auto-picked up by `STANDARD_SUBSCRIBERS`; its cursor row seeded by PR 2's migration.
6. (~2 weeks post-100%-rollout) Follow-up PR deletes `bus_cursor`, the legacy global-cursor `tick()`, and the standalone script.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 1-minute cron lag too slow for tutor UX | Med | Med | Route returns optimistic; canonical write trails by ≤ 1 min. Phase 2.1: post-publish ad-hoc trigger from publishers. |
| Premature dead-lettering on transient failures | Low | Med | `maxRetries=3` (configurable per subscriber); replay endpoint recovers any dead-lettered event. Watch real production dead-letter rate; tune. |
| pg_net or pg_cron not enabled | Low | High (won't ship) | Migration verifies extensions; runbook step ensures Vault GUCs populated. Pre-PR check on prod's `pg_extensions`. |
| Standalone script + Edge Function double-process | Low | Med | Standalone script is dev-only; the Edge Function is the canonical driver. Adapter writes legacy `bus_cursor` to min-of-subscriber-cursors. |
| Wrong cron command syntax or env vars | Med | Med | First migration runs in staging only; verify `cron.job_run_details.return_message` for the first ~5 invocations before promoting. |
| Index `idx_state_events_kind_occurred_event` slows publishes | Low | Low | Single composite; EXPLAIN ANALYZE the publish path in staging soak. |
| `subscriber_dead_letters` and `subscriber_retry_state` grow unbounded | Low | Low | 90-day TTL job — Phase 2.1 follow-up. |

## File-by-file change list

| File | Action | Approx size |
|---|---|---|
| `supabase/migrations/20260522000001_state_runtime_per_subscriber.sql` | new | ~110 lines |
| `supabase/migrations/20260522000002_projector_runner_cron.sql` | new | ~30 lines |
| `src/lib/state/subscribers/subscriber.ts` + `types.ts` | modify | ~30 lines added |
| `src/lib/state/subscribers/mastery-state-writer.ts` | modify (`studentIdFromEvent`) | ~5 lines |
| `src/lib/state/subscribers/dispatcher.ts` | modify (`replayForStudent`) | ~60 lines added |
| `src/lib/state/runtime/event-listener.ts` | modify (`tickAll` + persistent retries) | ~150 lines changed |
| `src/lib/state/runtime/event-listener.test.ts` | modify | ~200 lines added |
| `src/lib/state/runtime/dead-letter.test.ts` | new | ~120 lines |
| `src/lib/state/runtime/replay-for-student.test.ts` | new | ~100 lines |
| `src/app/api/admin/projectors/replay/route.ts` | new | ~80 lines |
| `src/app/api/admin/projectors/replay/route.test.ts` | new | ~80 lines |
| `supabase/functions/projector-runner/index.ts` | new | ~60 lines |

Estimated effort: ~3 days including tests.

## Definition of done

- Migrations apply cleanly in staging including `pg_cron` + `pg_net` extension presence.
- `ff_projector_runner_v1` flips ON; pg_cron fires every minute; Edge Function returns `{ skipped: false, perSubscriber: [...] }`.
- Deliberately-injected malformed event lands in `subscriber_dead_letters` after exactly 3 cron firings with `attempt_count=3`.
- `replayForStudent` works for `mastery-state-writer`; refuses for an inserted student-unscoped test subscriber.
- All new tests pass; no existing tests regress.
- PR follows P14 review chain: architect, backend, ops, testing.

## References

- [ADR-005 — Spine](../../architecture/ADR-005-concept-first-adaptive-learning-spine.md)
- [Microservices Extraction Plan v1](../../architecture/MICROSERVICES_EXTRACTION_PLAN.md)
- [Supabase pg_cron docs](https://supabase.com/docs/guides/database/extensions/pg_cron)
- [Supabase pg_net docs](https://supabase.com/docs/guides/database/extensions/pg_net)
- Existing runtime files cited above.
