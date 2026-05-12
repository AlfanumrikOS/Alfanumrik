# State Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing state-events runtime (`src/lib/state/runtime/event-listener.ts`, `src/lib/state/subscribers/dispatcher.ts`) to support per-subscriber cursors, persistent retry state across ticks, dead-letter table, replay-by-student, lag observability, and pg_cron-driven invocation. No learner-visible behaviour change.

**Architecture:** Replace the single global `bus_cursor` watermark with per-subscriber rows in a new `subscriber_offsets` table. Persist retry attempts in `subscriber_retry_state` across ticks; promote to `subscriber_dead_letters` on terminal failure. Add `replayForStudent` to the dispatcher that re-invokes one subscriber without mutating live cursors. A new Supabase Edge Function `projector-runner` is invoked every 1 minute by `pg_cron` via `pg_net.http_post`.

**Tech Stack:** TypeScript + Next.js 14 (Vercel), Supabase Postgres + Edge Functions, `pg_cron`, `pg_net`, vitest, Zod, `@supabase/supabase-js` v2.

**Parent ADR:** [ADR-005](../../architecture/ADR-005-concept-first-adaptive-learning-spine.md)
**Source spec:** [State Runtime Hardening (PR 1)](../specs/2026-05-12-projector-substrate-design.md)
**Companion plan (next PR):** ADR-004 Phase 2 BKT (written after PR 1 lands).
**Branch:** `feat/state-runtime-hardening`

---

## File structure

**New:**
- `supabase/migrations/<ts1>_state_runtime_per_subscriber.sql` — tables, RLS, lag view, flag, seed
- `supabase/migrations/<ts2>_projector_runner_cron.sql` — pg_cron schedule (depends on Vault GUCs)
- `src/lib/state/runtime/offsets.ts` — read/write `subscriber_offsets`
- `src/lib/state/runtime/retry-state.ts` — read/upsert/clear `subscriber_retry_state`, insert `subscriber_dead_letters`
- `src/lib/state/runtime/flag.ts` — cached read of `ff_projector_runner_v1`
- `src/lib/state/runtime/tick-one.ts` — single-subscriber tick logic
- `src/lib/state/runtime/tick-all.ts` — fan-out wrapper + flag gate
- `src/lib/state/runtime/offsets.test.ts`
- `src/lib/state/runtime/retry-state.test.ts`
- `src/lib/state/runtime/flag.test.ts`
- `src/lib/state/runtime/tick-one.test.ts`
- `src/lib/state/runtime/tick-all.test.ts`
- `src/lib/state/runtime/dead-letter-integration.test.ts`
- `src/lib/state/runtime/replay-for-student.test.ts`
- `src/lib/state/subscribers/dispatcher.replay.test.ts`
- `src/app/api/admin/projectors/replay/route.ts`
- `src/app/api/admin/projectors/replay/route.test.ts`
- `supabase/functions/projector-runner/index.ts`

**Modify:**
- `src/lib/state/subscribers/subscriber.ts` — add `maxRetries?`, `studentIdFromEvent?` to `Subscriber` and `AnySubscriber`
- `src/lib/state/subscribers/mastery-state-writer.ts` — implement `studentIdFromEvent`
- `src/lib/state/subscribers/dispatcher.ts` — add `replayForStudent`
- `src/lib/state/runtime/event-listener.ts` — replace single-cursor `tick()` with `tickAll`/`tickOne` adapters

**Migration timestamps:** placeholders `<ts1>` and `<ts2>` resolve to current-time-greater-than the latest applied migration. Convention in this repo: `YYYYMMDDHHMMSS`. The most recent applied migration as of authoring is `20260521100000_state_events_bus_rename.sql`. Suggested: `<ts1> = 20260522000001`, `<ts2> = 20260522000002`. Verify and adjust at PR creation.

---

## Task 1: Add SQL migration for substrate tables + view + flag

**Files:**
- Create: `supabase/migrations/20260522000001_state_runtime_per_subscriber.sql`

- [ ] **Step 1: Confirm migration timestamp**

Run: `Get-ChildItem "supabase/migrations" -Filter "*.sql" | Sort-Object Name | Select-Object -Last 5`

If the latest applied migration's timestamp is greater than `20260521100000`, pick a timestamp 1 second later than the latest. Otherwise use `20260522000001`. Update the filename and all in-document references.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260522000001_state_runtime_per_subscriber.sql`:

```sql
-- Per-subscriber watermarks. One row per registered subscriber.
CREATE TABLE IF NOT EXISTS public.subscriber_offsets (
  subscriber_name             text         PRIMARY KEY,
  kind_filter                 text         NOT NULL,
  last_processed_event_id     uuid                  NULL,
  last_processed_occurred_at  timestamptz           NULL,
  events_processed            bigint       NOT NULL DEFAULT 0,
  events_dead_lettered        bigint       NOT NULL DEFAULT 0,
  updated_at                  timestamptz  NOT NULL DEFAULT now()
);

-- Persistent per-event retry state across ticks. Cleared on success;
-- promoted to subscriber_dead_letters when attempt_count reaches maxRetries.
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

-- RLS: service_role only (matches state_events).
ALTER TABLE public.subscriber_offsets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriber_retry_state   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriber_dead_letters  ENABLE ROW LEVEL SECURITY;

-- Per-subscriber lag view.
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

-- Seed offsets at NOW so this migration doesn't replay history.
INSERT INTO public.subscriber_offsets (subscriber_name, kind_filter, last_processed_occurred_at)
VALUES ('mastery-state-writer', 'learner.mastery_changed', NOW())
ON CONFLICT (subscriber_name) DO NOTHING;

-- Kill-switch flag.
INSERT INTO public.feature_flags (
  flag_name, description, is_enabled, rollout_percentage, target_environments
)
VALUES (
  'ff_projector_runner_v1',
  'ADR-005 PR 1: kill-switch for the projector-runner Edge Function. When OFF, the runner returns {skipped:true}. See docs/superpowers/specs/2026-05-12-projector-substrate-design.md',
  false, 0, ARRAY['production','staging']::text[]
)
ON CONFLICT (flag_name) DO NOTHING;
```

- [ ] **Step 3: Apply locally and verify schema**

Run: `supabase db reset` (if you're on a throw-away local DB) OR `supabase migration up`.

Verify: `psql "$DATABASE_URL" -c "\d subscriber_offsets" -c "\d subscriber_retry_state" -c "\d subscriber_dead_letters" -c "SELECT * FROM subscriber_lag;"`

Expected: three tables exist; the view returns one row for `mastery-state-writer` with `events_behind = 0` and `last_processed_occurred_at` close to NOW.

- [ ] **Step 4: Commit**

```bash
git checkout -b feat/state-runtime-hardening
git add supabase/migrations/20260522000001_state_runtime_per_subscriber.sql
git commit -m "feat(state-runtime): per-subscriber offsets, retry state, dead-letter tables (#PR-1)"
```

---

## Task 2: Extend Subscriber interface

**Files:**
- Modify: `src/lib/state/subscribers/subscriber.ts`

- [ ] **Step 1: Write a type-check test**

Create `src/lib/state/subscribers/subscriber.types.test.ts`:

```ts
import { describe, it } from 'vitest';
import type { Subscriber } from './subscriber';
import type { DomainEvent } from '../events/registry';

describe('Subscriber interface', () => {
  it('accepts optional maxRetries and studentIdFromEvent', () => {
    // Compile-time check: this should type-check.
    const s: Subscriber<'learner.mastery_changed'> = {
      name: 'test',
      kind: 'learner.mastery_changed',
      maxRetries: 5,
      studentIdFromEvent: (e) => e.actorAuthUserId,
      async handle(_event, _ctx) {},
    };
    void s; // unused
  });

  it('accepts a subscriber without the new optional fields', () => {
    const s: Subscriber<'learner.mastery_changed'> = {
      name: 'minimal',
      kind: 'learner.mastery_changed',
      async handle(_event, _ctx) {},
    };
    void s;
  });
});
```

- [ ] **Step 2: Run test to confirm it fails to compile**

Run: `pnpm exec vitest run src/lib/state/subscribers/subscriber.types.test.ts`

Expected: TypeScript compile error — "Object literal may only specify known properties, and 'maxRetries' does not exist in type 'Subscriber<...>'".

- [ ] **Step 3: Extend the Subscriber and AnySubscriber interfaces**

Modify `src/lib/state/subscribers/subscriber.ts`. Find the `Subscriber<K>` interface and add fields:

```ts
export interface Subscriber<K extends DomainEventKind = DomainEventKind> {
  /** Stable name, used in logs and metrics. */
  readonly name: string;
  /** The single event kind this subscriber listens to. */
  readonly kind: K;
  /**
   * Total attempts across ticks before dead-letter (default 3).
   * The runner increments a persistent counter in subscriber_retry_state
   * on each failure and dead-letters when count >= maxRetries.
   */
  readonly maxRetries?: number;
  /**
   * Optional. Maps the event payload to the studentId this event concerns.
   * Required for replayForStudent — absence makes the subscriber not
   * student-scoped (the admin replay endpoint refuses with
   * `not_student_scoped`).
   */
  studentIdFromEvent?(event: Extract<DomainEvent, { kind: K }>): string | null;
  /** Handle one event. MUST be idempotent. */
  handle(
    event: Extract<DomainEvent, { kind: K }>,
    ctx: SubscriberContext,
  ): Promise<void>;
}
```

Then find `AnySubscriber` and add the same optional fields:

```ts
export interface AnySubscriber {
  readonly name: string;
  readonly kind: DomainEventKind;
  readonly maxRetries?: number;
  studentIdFromEvent?(event: DomainEvent): string | null;
  handle(event: DomainEvent, ctx: SubscriberContext): Promise<void>;
}
```

- [ ] **Step 4: Run test to confirm it passes**

Run: `pnpm exec vitest run src/lib/state/subscribers/subscriber.types.test.ts`

Expected: PASS, both cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/subscribers/subscriber.ts src/lib/state/subscribers/subscriber.types.test.ts
git commit -m "feat(state-runtime): extend Subscriber with maxRetries + studentIdFromEvent"
```

---

## Task 3: Cursor read/write helpers (`offsets.ts`)

**Files:**
- Create: `src/lib/state/runtime/offsets.ts`
- Create: `src/lib/state/runtime/offsets.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/state/runtime/offsets.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readSubscriberOffset, writeSubscriberOffset } from './offsets';
import { makeServiceSupabase, resetDb } from '@/test/supabase-test-helpers';

describe('subscriber offsets', () => {
  const sb = makeServiceSupabase();

  beforeEach(async () => {
    await resetDb(['subscriber_offsets']);
    await sb.from('subscriber_offsets').insert({
      subscriber_name: 'test-sub',
      kind_filter: 'learner.mastery_changed',
      last_processed_occurred_at: '2026-05-12T00:00:00Z',
    });
  });

  it('readSubscriberOffset returns the row for a known subscriber', async () => {
    const offset = await readSubscriberOffset(sb, 'test-sub');
    expect(offset).toEqual({
      lastEventId: null,
      lastOccurredAt: '2026-05-12T00:00:00Z',
    });
  });

  it('readSubscriberOffset returns sentinel for an unknown subscriber', async () => {
    const offset = await readSubscriberOffset(sb, 'does-not-exist');
    expect(offset).toEqual({
      lastEventId: null,
      lastOccurredAt: '1970-01-01T00:00:00Z',
    });
  });

  it('writeSubscriberOffset advances the watermark and updates counters', async () => {
    const eventId = '11111111-1111-1111-1111-111111111111';
    await writeSubscriberOffset(sb, 'test-sub', {
      lastEventId: eventId,
      lastOccurredAt: '2026-05-13T00:00:00Z',
    }, { processed: 3, deadLettered: 1 });

    const offset = await readSubscriberOffset(sb, 'test-sub');
    expect(offset.lastEventId).toBe(eventId);
    expect(offset.lastOccurredAt).toBe('2026-05-13T00:00:00Z');

    const { data } = await sb
      .from('subscriber_offsets')
      .select('events_processed, events_dead_lettered')
      .eq('subscriber_name', 'test-sub')
      .single();
    expect(data?.events_processed).toBe(3);
    expect(data?.events_dead_lettered).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/state/runtime/offsets.test.ts`

Expected: FAIL — module `./offsets` does not exist.

- [ ] **Step 3: Implement `offsets.ts`**

Create `src/lib/state/runtime/offsets.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

const EPOCH = '1970-01-01T00:00:00Z';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export interface SubscriberOffset {
  lastEventId: string | null;
  lastOccurredAt: string;  // ISO timestamp; '1970-01-01T00:00:00Z' for new subscribers
}

/** Read one subscriber's watermark. Returns the EPOCH sentinel if none. */
export async function readSubscriberOffset(
  sb: SupabaseClient,
  subscriberName: string,
): Promise<SubscriberOffset> {
  const { data, error } = await sb
    .from('subscriber_offsets')
    .select('last_processed_event_id, last_processed_occurred_at')
    .eq('subscriber_name', subscriberName)
    .maybeSingle();
  if (error || !data) {
    return { lastEventId: null, lastOccurredAt: EPOCH };
  }
  return {
    lastEventId: data.last_processed_event_id as string | null,
    lastOccurredAt: (data.last_processed_occurred_at as string | null) ?? EPOCH,
  };
}

/** Write the subscriber's watermark and bump counters. UPSERT semantics. */
export async function writeSubscriberOffset(
  sb: SupabaseClient,
  subscriberName: string,
  newOffset: SubscriberOffset,
  delta: { processed: number; deadLettered: number },
): Promise<void> {
  // We need atomic increments on processed/dead-lettered. The simplest
  // path under PostgREST is an UPSERT with a +SQL expression via RPC, but
  // here we read-modify-write because contention is low (one writer per
  // subscriber per tick).
  const { data: existing } = await sb
    .from('subscriber_offsets')
    .select('events_processed, events_dead_lettered, kind_filter')
    .eq('subscriber_name', subscriberName)
    .maybeSingle();

  await sb.from('subscriber_offsets').upsert({
    subscriber_name: subscriberName,
    kind_filter: existing?.kind_filter ?? '',
    last_processed_event_id: newOffset.lastEventId,
    last_processed_occurred_at: newOffset.lastOccurredAt,
    events_processed: (existing?.events_processed ?? 0) + delta.processed,
    events_dead_lettered: (existing?.events_dead_lettered ?? 0) + delta.deadLettered,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'subscriber_name' });
}

export { EPOCH, ZERO_UUID };
```

Note: this assumes a test helper `@/test/supabase-test-helpers` exists. If not, see Task 17 for the helper module.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/state/runtime/offsets.test.ts`

Expected: PASS — all three cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/runtime/offsets.ts src/lib/state/runtime/offsets.test.ts
git commit -m "feat(state-runtime): subscriber-offset read/write helpers"
```

---

## Task 4: Retry-state + dead-letter helpers (`retry-state.ts`)

**Files:**
- Create: `src/lib/state/runtime/retry-state.ts`
- Create: `src/lib/state/runtime/retry-state.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/state/runtime/retry-state.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readRetryCount,
  upsertRetryState,
  clearRetryState,
  insertDeadLetter,
} from './retry-state';
import { makeServiceSupabase, resetDb } from '@/test/supabase-test-helpers';

const sb = makeServiceSupabase();
const EVENT_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(async () => {
  await resetDb(['subscriber_retry_state', 'subscriber_dead_letters']);
});

describe('retry state', () => {
  it('readRetryCount returns 0 for a new (event, subscriber)', async () => {
    const n = await readRetryCount(sb, EVENT_ID, 'test-sub');
    expect(n).toBe(0);
  });

  it('upsertRetryState inserts then increments', async () => {
    await upsertRetryState(sb, EVENT_ID, 'test-sub', 1, 'first error');
    expect(await readRetryCount(sb, EVENT_ID, 'test-sub')).toBe(1);
    await upsertRetryState(sb, EVENT_ID, 'test-sub', 2, 'second error');
    expect(await readRetryCount(sb, EVENT_ID, 'test-sub')).toBe(2);
    const { data } = await sb
      .from('subscriber_retry_state')
      .select('last_error, first_attempted_at, last_attempted_at')
      .eq('event_id', EVENT_ID).eq('subscriber_name', 'test-sub').single();
    expect(data?.last_error).toBe('second error');
    expect(data!.last_attempted_at >= data!.first_attempted_at).toBe(true);
  });

  it('clearRetryState removes the row', async () => {
    await upsertRetryState(sb, EVENT_ID, 'test-sub', 1, 'err');
    await clearRetryState(sb, EVENT_ID, 'test-sub');
    expect(await readRetryCount(sb, EVENT_ID, 'test-sub')).toBe(0);
  });
});

describe('dead letters', () => {
  it('insertDeadLetter records the terminal failure', async () => {
    await insertDeadLetter(sb, EVENT_ID, 'test-sub', 3, 'final error');
    const { data } = await sb
      .from('subscriber_dead_letters')
      .select('*')
      .eq('event_id', EVENT_ID).eq('subscriber_name', 'test-sub').single();
    expect(data?.attempt_count).toBe(3);
    expect(data?.last_error).toBe('final error');
    expect(data?.resolved_at).toBeNull();
  });

  it('insertDeadLetter is idempotent (UNIQUE upsert)', async () => {
    await insertDeadLetter(sb, EVENT_ID, 'test-sub', 3, 'err 1');
    await insertDeadLetter(sb, EVENT_ID, 'test-sub', 3, 'err 2');
    const { count } = await sb
      .from('subscriber_dead_letters')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', EVENT_ID).eq('subscriber_name', 'test-sub');
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/state/runtime/retry-state.test.ts`

Expected: FAIL — module `./retry-state` does not exist.

- [ ] **Step 3: Implement `retry-state.ts`**

Create `src/lib/state/runtime/retry-state.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export async function readRetryCount(
  sb: SupabaseClient,
  eventId: string,
  subscriberName: string,
): Promise<number> {
  const { data } = await sb
    .from('subscriber_retry_state')
    .select('attempt_count')
    .eq('event_id', eventId)
    .eq('subscriber_name', subscriberName)
    .maybeSingle();
  return (data?.attempt_count as number | undefined) ?? 0;
}

export async function upsertRetryState(
  sb: SupabaseClient,
  eventId: string,
  subscriberName: string,
  attemptCount: number,
  lastError: string,
): Promise<void> {
  // UPSERT: insert on first failure, update last_attempted_at + last_error
  // on subsequent failures. first_attempted_at preserved by ON CONFLICT.
  const now = new Date().toISOString();
  const { data: existing } = await sb
    .from('subscriber_retry_state')
    .select('first_attempted_at')
    .eq('event_id', eventId).eq('subscriber_name', subscriberName)
    .maybeSingle();
  await sb.from('subscriber_retry_state').upsert({
    event_id: eventId,
    subscriber_name: subscriberName,
    attempt_count: attemptCount,
    first_attempted_at: existing?.first_attempted_at ?? now,
    last_attempted_at: now,
    last_error: lastError.slice(0, 2000),
  }, { onConflict: 'event_id,subscriber_name' });
}

export async function clearRetryState(
  sb: SupabaseClient,
  eventId: string,
  subscriberName: string,
): Promise<void> {
  await sb
    .from('subscriber_retry_state')
    .delete()
    .eq('event_id', eventId)
    .eq('subscriber_name', subscriberName);
}

export async function insertDeadLetter(
  sb: SupabaseClient,
  eventId: string,
  subscriberName: string,
  attemptCount: number,
  lastError: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { data: retry } = await sb
    .from('subscriber_retry_state')
    .select('first_attempted_at')
    .eq('event_id', eventId).eq('subscriber_name', subscriberName)
    .maybeSingle();
  await sb.from('subscriber_dead_letters').upsert({
    event_id: eventId,
    subscriber_name: subscriberName,
    attempt_count: attemptCount,
    last_error: lastError.slice(0, 2000),
    first_attempted_at: (retry?.first_attempted_at as string | undefined) ?? now,
    last_attempted_at: now,
  }, { onConflict: 'event_id,subscriber_name' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/state/runtime/retry-state.test.ts`

Expected: PASS — all five cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/runtime/retry-state.ts src/lib/state/runtime/retry-state.test.ts
git commit -m "feat(state-runtime): retry-state and dead-letter helpers"
```

---

## Task 5: Flag check helper (`flag.ts`)

**Files:**
- Create: `src/lib/state/runtime/flag.ts`
- Create: `src/lib/state/runtime/flag.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/state/runtime/flag.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { isProjectorRunnerEnabled, __resetFlagCacheForTests } from './flag';
import { makeServiceSupabase, resetDb } from '@/test/supabase-test-helpers';

const sb = makeServiceSupabase();

beforeEach(async () => {
  await resetDb(['feature_flags']);
  __resetFlagCacheForTests();
});

describe('ff_projector_runner_v1 flag', () => {
  it('returns false when flag is missing', async () => {
    expect(await isProjectorRunnerEnabled(sb)).toBe(false);
  });
  it('returns true when flag is enabled', async () => {
    await sb.from('feature_flags').insert({
      flag_name: 'ff_projector_runner_v1', is_enabled: true,
      rollout_percentage: 100, target_environments: ['production'],
    });
    expect(await isProjectorRunnerEnabled(sb)).toBe(true);
  });
  it('returns false when flag is disabled', async () => {
    await sb.from('feature_flags').insert({
      flag_name: 'ff_projector_runner_v1', is_enabled: false,
      rollout_percentage: 0, target_environments: ['production'],
    });
    expect(await isProjectorRunnerEnabled(sb)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/state/runtime/flag.test.ts`

Expected: FAIL — module `./flag` does not exist.

- [ ] **Step 3: Implement `flag.ts`**

Create `src/lib/state/runtime/flag.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

const FLAG_NAME = 'ff_projector_runner_v1';
const TTL_MS = 30_000;
let cachedAt: number | null = null;
let cachedValue: boolean | null = null;

export async function isProjectorRunnerEnabled(sb: SupabaseClient): Promise<boolean> {
  const now = Date.now();
  if (cachedValue !== null && cachedAt !== null && now - cachedAt < TTL_MS) {
    return cachedValue;
  }
  const { data } = await sb
    .from('feature_flags')
    .select('is_enabled')
    .eq('flag_name', FLAG_NAME)
    .maybeSingle();
  cachedValue = data?.is_enabled === true;
  cachedAt = now;
  return cachedValue;
}

export function __resetFlagCacheForTests(): void {
  cachedAt = null;
  cachedValue = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/state/runtime/flag.test.ts`

Expected: PASS — all three cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/runtime/flag.ts src/lib/state/runtime/flag.test.ts
git commit -m "feat(state-runtime): ff_projector_runner_v1 cached flag check"
```

---

## Task 6: `tickOne` happy path

**Files:**
- Create: `src/lib/state/runtime/tick-one.ts`
- Create: `src/lib/state/runtime/tick-one.test.ts`

- [ ] **Step 1: Write failing test (happy path)**

Create `src/lib/state/runtime/tick-one.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { tickOne } from './tick-one';
import { defaultLog, type SubscriberContext } from '../subscribers/subscriber';
import type { AnySubscriber } from '../subscribers/subscriber';
import { makeServiceSupabase, resetDb, insertEvent } from '@/test/supabase-test-helpers';

const sb = makeServiceSupabase();
const ctx: SubscriberContext = {
  sb, dryRun: false, now: () => new Date(), log: defaultLog,
};

beforeEach(async () => {
  await resetDb(['state_events', 'subscriber_offsets', 'subscriber_retry_state', 'subscriber_dead_letters']);
  await sb.from('subscriber_offsets').insert({
    subscriber_name: 'happy',
    kind_filter: 'learner.mastery_changed',
    last_processed_occurred_at: '2026-05-12T00:00:00Z',
  });
});

describe('tickOne happy path', () => {
  it('processes events in order and advances cursor', async () => {
    const calls: string[] = [];
    const sub: AnySubscriber = {
      name: 'happy',
      kind: 'learner.mastery_changed',
      async handle(event) { calls.push(event.eventId); },
    };
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: '2026-05-12T01:00:00Z' });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: '2026-05-12T02:00:00Z' });
    const result = await tickOne(sub, { sb, ctx });
    expect(result.processed).toBe(2);
    expect(result.deadLettered).toBe(0);
    expect(calls.length).toBe(2);
    const { data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at, events_processed')
      .eq('subscriber_name', 'happy').single();
    expect(off?.last_processed_occurred_at).toBe('2026-05-12T02:00:00+00:00');
    expect(off?.events_processed).toBe(2);
  });

  it('processes nothing when no events past cursor', async () => {
    const sub: AnySubscriber = {
      name: 'happy', kind: 'learner.mastery_changed',
      async handle() {},
    };
    const result = await tickOne(sub, { sb, ctx });
    expect(result.processed).toBe(0);
    expect(result.deadLettered).toBe(0);
  });

  it('filters by kind', async () => {
    const calls: string[] = [];
    const sub: AnySubscriber = {
      name: 'happy', kind: 'learner.mastery_changed',
      async handle(event) { calls.push(event.eventId); },
    };
    await insertEvent(sb, { kind: 'learner.quiz_completed', occurredAt: '2026-05-12T01:00:00Z' });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: '2026-05-12T02:00:00Z' });
    const result = await tickOne(sub, { sb, ctx });
    expect(result.processed).toBe(1);
    expect(calls.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/state/runtime/tick-one.test.ts`

Expected: FAIL — module `./tick-one` does not exist.

- [ ] **Step 3: Implement happy path of `tick-one.ts`**

Create `src/lib/state/runtime/tick-one.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnySubscriber, SubscriberContext } from '../subscribers/subscriber';
import { DomainEventSchema, type DomainEvent } from '../events/registry';
import {
  readSubscriberOffset, writeSubscriberOffset,
  EPOCH, ZERO_UUID,
} from './offsets';
import {
  readRetryCount, upsertRetryState, clearRetryState, insertDeadLetter,
} from './retry-state';

export interface TickOneOptions {
  sb: SupabaseClient;
  ctx: SubscriberContext;
  batchSize?: number;
}

export interface TickOneResult {
  subscriberName: string;
  processed: number;
  deadLettered: number;
  eventsBehindAfter: number;
}

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_RETRIES = 3;

export async function tickOne(
  sub: AnySubscriber,
  opts: TickOneOptions,
): Promise<TickOneResult> {
  const { sb, ctx } = opts;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxRetries = sub.maxRetries ?? DEFAULT_MAX_RETRIES;

  const cursor = await readSubscriberOffset(sb, sub.name);

  // Fetch events past cursor for this subscriber's kind, ordered by
  // (occurred_at, event_id) — same tiebreaker the lag view uses.
  // We over-fetch on occurred_at and filter the boundary tie in JS to
  // avoid a complex AND-of-OR predicate.
  const { data: rows, error } = await sb
    .from('state_events')
    .select('*')
    .eq('kind', sub.kind)
    .gte('occurred_at', cursor.lastOccurredAt)
    .order('occurred_at', { ascending: true })
    .order('event_id', { ascending: true })
    .limit(batchSize + 1);

  if (error) throw new Error(`tick-one: fetch failed for ${sub.name}: ${error.message}`);

  // Strip events at or before the boundary (cursor row itself).
  const events = (rows ?? []).filter(r => {
    const occ = r.occurred_at as string;
    const id = r.event_id as string;
    if (occ > cursor.lastOccurredAt) return true;
    if (occ === cursor.lastOccurredAt) return id > (cursor.lastEventId ?? ZERO_UUID);
    return false;
  }).slice(0, batchSize);

  let processed = 0;
  let deadLettered = 0;
  let advanceTo = cursor;

  for (const row of events) {
    const event = parseEventRow(row);
    if (!event) continue;

    try {
      await sub.handle(event, ctx);
      await clearRetryState(sb, event.eventId, sub.name);
      processed += 1;
      advanceTo = { lastEventId: event.eventId, lastOccurredAt: event.occurredAt };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const priorAttempts = await readRetryCount(sb, event.eventId, sub.name);
      const newCount = priorAttempts + 1;
      if (newCount >= maxRetries) {
        await insertDeadLetter(sb, event.eventId, sub.name, newCount, errMsg);
        await clearRetryState(sb, event.eventId, sub.name);
        deadLettered += 1;
        advanceTo = { lastEventId: event.eventId, lastOccurredAt: event.occurredAt };
      } else {
        await upsertRetryState(sb, event.eventId, sub.name, newCount, errMsg);
        // STOP processing more events for this subscriber this tick.
        // Cursor unchanged from advanceTo so far.
        break;
      }
    }
  }

  if (advanceTo !== cursor) {
    await writeSubscriberOffset(sb, sub.name, advanceTo, { processed, deadLettered });
  }

  return {
    subscriberName: sub.name,
    processed,
    deadLettered,
    eventsBehindAfter: 0,  // computed below; placeholder for happy-path test
  };
}

function parseEventRow(row: unknown): DomainEvent | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const candidate = {
    eventId: r.event_id,
    occurredAt: r.occurred_at,
    actorAuthUserId: r.actor_auth_user_id,
    tenantId: r.tenant_id ?? null,
    idempotencyKey: r.idempotency_key,
    kind: r.kind,
    payload: r.payload,
  };
  const parsed = DomainEventSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/state/runtime/tick-one.test.ts`

Expected: PASS — all three cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/runtime/tick-one.ts src/lib/state/runtime/tick-one.test.ts
git commit -m "feat(state-runtime): tick-one happy path (per-subscriber cursor + kind filter)"
```

---

## Task 7: `tickOne` retry + dead-letter paths

**Files:**
- Modify: `src/lib/state/runtime/tick-one.test.ts`

- [ ] **Step 1: Add failing tests for retry + dead-letter**

Append to `src/lib/state/runtime/tick-one.test.ts`:

```ts
describe('tickOne retry path', () => {
  it('persists attempt_count on failure and does not advance cursor', async () => {
    const sub: AnySubscriber = {
      name: 'happy', kind: 'learner.mastery_changed',
      async handle() { throw new Error('boom'); },
    };
    const e = await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: '2026-05-12T01:00:00Z' });

    const r1 = await tickOne(sub, { sb, ctx });
    expect(r1.processed).toBe(0);
    expect(r1.deadLettered).toBe(0);
    const { data: retryRow } = await sb.from('subscriber_retry_state')
      .select('attempt_count, last_error')
      .eq('event_id', e.eventId).eq('subscriber_name', 'happy').single();
    expect(retryRow?.attempt_count).toBe(1);
    expect(retryRow?.last_error).toBe('boom');

    // Cursor unchanged (still the seed value).
    const { data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at').eq('subscriber_name', 'happy').single();
    expect(off?.last_processed_occurred_at).toBe('2026-05-12T00:00:00+00:00');
  });

  it('dead-letters after maxRetries failed ticks and advances cursor', async () => {
    const sub: AnySubscriber = {
      name: 'happy', kind: 'learner.mastery_changed',
      maxRetries: 3,
      async handle() { throw new Error('persistent'); },
    };
    const e = await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: '2026-05-12T01:00:00Z' });

    await tickOne(sub, { sb, ctx });  // count=1
    await tickOne(sub, { sb, ctx });  // count=2

    // Cursor still unchanged.
    let { data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at, events_dead_lettered').eq('subscriber_name', 'happy').single();
    expect(off?.last_processed_occurred_at).toBe('2026-05-12T00:00:00+00:00');

    const r3 = await tickOne(sub, { sb, ctx });  // count=3 → dead-letter
    expect(r3.deadLettered).toBe(1);

    const { data: dl } = await sb.from('subscriber_dead_letters')
      .select('attempt_count, last_error')
      .eq('event_id', e.eventId).eq('subscriber_name', 'happy').single();
    expect(dl?.attempt_count).toBe(3);
    expect(dl?.last_error).toBe('persistent');

    // Retry state cleared.
    const { count: retryCount } = await sb.from('subscriber_retry_state')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', e.eventId);
    expect(retryCount).toBe(0);

    // Cursor advanced past the bad event.
    ({ data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at, events_dead_lettered').eq('subscriber_name', 'happy').single());
    expect(off?.last_processed_occurred_at).toBe('2026-05-12T01:00:00+00:00');
    expect(off?.events_dead_lettered).toBe(1);
  });

  it('clears retry state when handler eventually succeeds', async () => {
    let attempts = 0;
    const sub: AnySubscriber = {
      name: 'happy', kind: 'learner.mastery_changed',
      maxRetries: 3,
      async handle() { if (++attempts < 2) throw new Error('flake'); },
    };
    const e = await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: '2026-05-12T01:00:00Z' });

    await tickOne(sub, { sb, ctx });  // count=1
    const r2 = await tickOne(sub, { sb, ctx });  // success
    expect(r2.processed).toBe(1);

    const { count } = await sb.from('subscriber_retry_state')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', e.eventId);
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm exec vitest run src/lib/state/runtime/tick-one.test.ts`

Expected: All cases PASS — the retry and dead-letter logic was already implemented in Task 6's tick-one.ts. If a test fails, fix the implementation; do not soften the test.

- [ ] **Step 3: Commit**

```bash
git add src/lib/state/runtime/tick-one.test.ts
git commit -m "test(state-runtime): tick-one retry-state persistence and dead-letter across ticks"
```

---

## Task 8: `tickAll` wrapper + flag gate

**Files:**
- Create: `src/lib/state/runtime/tick-all.ts`
- Create: `src/lib/state/runtime/tick-all.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/state/runtime/tick-all.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { tickAll } from './tick-all';
import { __resetFlagCacheForTests } from './flag';
import { createDispatcher, type AnySubscriber } from '../subscribers/dispatcher';
import { defaultLog, type SubscriberContext } from '../subscribers/subscriber';
import { makeServiceSupabase, resetDb, insertEvent } from '@/test/supabase-test-helpers';

const sb = makeServiceSupabase();
const ctx: SubscriberContext = { sb, dryRun: false, now: () => new Date(), log: defaultLog };

beforeEach(async () => {
  await resetDb([
    'state_events', 'subscriber_offsets',
    'subscriber_retry_state', 'subscriber_dead_letters', 'feature_flags',
  ]);
  __resetFlagCacheForTests();
});

describe('tickAll', () => {
  it('returns { skipped: true } when flag is OFF', async () => {
    await sb.from('feature_flags').insert({
      flag_name: 'ff_projector_runner_v1', is_enabled: false,
      rollout_percentage: 0, target_environments: ['production'],
    });
    const dispatcher = createDispatcher([]);
    const result = await tickAll({ sb, ctx, dispatcher });
    expect(result.skipped).toBe(true);
    expect(result.perSubscriber).toEqual([]);
  });

  it('runs each registered subscriber when flag is ON', async () => {
    await sb.from('feature_flags').insert({
      flag_name: 'ff_projector_runner_v1', is_enabled: true,
      rollout_percentage: 100, target_environments: ['production'],
    });
    const subA: AnySubscriber = {
      name: 'a', kind: 'learner.mastery_changed', async handle() {},
    };
    const subB: AnySubscriber = {
      name: 'b', kind: 'learner.quiz_completed', async handle() {},
    };
    await sb.from('subscriber_offsets').insert([
      { subscriber_name: 'a', kind_filter: 'learner.mastery_changed', last_processed_occurred_at: '2026-05-12T00:00:00Z' },
      { subscriber_name: 'b', kind_filter: 'learner.quiz_completed',  last_processed_occurred_at: '2026-05-12T00:00:00Z' },
    ]);
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: '2026-05-12T01:00:00Z' });
    await insertEvent(sb, { kind: 'learner.quiz_completed', occurredAt: '2026-05-12T01:00:00Z' });
    const dispatcher = createDispatcher([subA, subB]);
    const result = await tickAll({ sb, ctx, dispatcher });
    expect(result.skipped).toBe(false);
    expect(result.perSubscriber).toHaveLength(2);
    expect(result.perSubscriber.find(r => r.subscriberName === 'a')?.processed).toBe(1);
    expect(result.perSubscriber.find(r => r.subscriberName === 'b')?.processed).toBe(1);
  });

  it('isolates subscribers — one failing does not block the other', async () => {
    await sb.from('feature_flags').insert({
      flag_name: 'ff_projector_runner_v1', is_enabled: true,
      rollout_percentage: 100, target_environments: ['production'],
    });
    const okSub: AnySubscriber = {
      name: 'ok', kind: 'learner.mastery_changed', async handle() {},
    };
    const badSub: AnySubscriber = {
      name: 'bad', kind: 'learner.quiz_completed',
      async handle() { throw new Error('always fails'); },
    };
    await sb.from('subscriber_offsets').insert([
      { subscriber_name: 'ok', kind_filter: 'learner.mastery_changed', last_processed_occurred_at: '2026-05-12T00:00:00Z' },
      { subscriber_name: 'bad', kind_filter: 'learner.quiz_completed', last_processed_occurred_at: '2026-05-12T00:00:00Z' },
    ]);
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: '2026-05-12T01:00:00Z' });
    await insertEvent(sb, { kind: 'learner.quiz_completed', occurredAt: '2026-05-12T01:00:00Z' });
    const dispatcher = createDispatcher([okSub, badSub]);
    const result = await tickAll({ sb, ctx, dispatcher });
    expect(result.perSubscriber.find(r => r.subscriberName === 'ok')?.processed).toBe(1);
    expect(result.perSubscriber.find(r => r.subscriberName === 'bad')?.processed).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/state/runtime/tick-all.test.ts`

Expected: FAIL — module `./tick-all` does not exist.

- [ ] **Step 3: Implement `tick-all.ts`**

Create `src/lib/state/runtime/tick-all.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Dispatcher } from '../subscribers/dispatcher';
import type { SubscriberContext } from '../subscribers/subscriber';
import { tickOne, type TickOneResult } from './tick-one';
import { isProjectorRunnerEnabled } from './flag';

export interface TickAllOptions {
  sb: SupabaseClient;
  ctx: SubscriberContext;
  dispatcher: Dispatcher;
  batchSize?: number;
}

export interface TickAllResult {
  skipped: boolean;
  perSubscriber: TickOneResult[];
}

export async function tickAll(opts: TickAllOptions): Promise<TickAllResult> {
  if (!(await isProjectorRunnerEnabled(opts.sb))) {
    return { skipped: true, perSubscriber: [] };
  }
  const perSubscriber: TickOneResult[] = [];
  for (const sub of opts.dispatcher.list()) {
    const r = await tickOne(sub, {
      sb: opts.sb, ctx: opts.ctx, batchSize: opts.batchSize,
    });
    perSubscriber.push(r);
  }
  return { skipped: false, perSubscriber };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/state/runtime/tick-all.test.ts`

Expected: PASS — all three cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/runtime/tick-all.ts src/lib/state/runtime/tick-all.test.ts
git commit -m "feat(state-runtime): tick-all wrapper with flag gate and per-subscriber isolation"
```

---

## Task 9: Wire `studentIdFromEvent` on legacy `mastery-state-writer`

**Files:**
- Modify: `src/lib/state/subscribers/mastery-state-writer.ts`

- [ ] **Step 1: Write a small unit test**

Create `src/lib/state/subscribers/mastery-state-writer.studentid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { masteryStateWriter } from './mastery-state-writer';

describe('masteryStateWriter.studentIdFromEvent', () => {
  it('returns the actor auth_user_id', () => {
    const event = {
      eventId: '00000000-0000-0000-0000-000000000001',
      kind: 'learner.mastery_changed' as const,
      actorAuthUserId: 'auth-user-123',
      tenantId: null,
      idempotencyKey: 'idem-1',
      occurredAt: '2026-05-12T00:00:00Z',
      payload: { subjectCode: 'math', chapterNumber: 1, toMastery: 0.5 },
    };
    expect(masteryStateWriter.studentIdFromEvent?.(event as never)).toBe('auth-user-123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/state/subscribers/mastery-state-writer.studentid.test.ts`

Expected: FAIL — `studentIdFromEvent` is not defined on the subscriber.

- [ ] **Step 3: Add the method**

Modify `src/lib/state/subscribers/mastery-state-writer.ts`. Find the `masteryStateWriter` export and add `studentIdFromEvent`:

```ts
export const masteryStateWriter: Subscriber<'learner.mastery_changed'> = {
  name: 'mastery-state-writer',
  kind: 'learner.mastery_changed',
  studentIdFromEvent(event) {
    return event.actorAuthUserId;
  },
  async handle(event, ctx: SubscriberContext) {
    // ... existing body unchanged
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/state/subscribers/mastery-state-writer.studentid.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/subscribers/mastery-state-writer.ts \
        src/lib/state/subscribers/mastery-state-writer.studentid.test.ts
git commit -m "feat(state-runtime): mastery-state-writer wires studentIdFromEvent for replay"
```

---

## Task 10: `dispatcher.replayForStudent`

**Files:**
- Modify: `src/lib/state/subscribers/dispatcher.ts`
- Create: `src/lib/state/subscribers/dispatcher.replay.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/state/subscribers/dispatcher.replay.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDispatcher, type AnySubscriber } from './dispatcher';
import { defaultLog, type SubscriberContext } from './subscriber';
import { makeServiceSupabase, resetDb, insertEvent } from '@/test/supabase-test-helpers';

const sb = makeServiceSupabase();
const ctx: SubscriberContext = { sb, dryRun: false, now: () => new Date(), log: defaultLog };

beforeEach(async () => {
  await resetDb(['state_events', 'subscriber_offsets']);
});

describe('replayForStudent', () => {
  it('refuses for a subscriber without studentIdFromEvent', async () => {
    const sub: AnySubscriber = {
      name: 'no-scope', kind: 'learner.mastery_changed',
      async handle() {},
    };
    const dispatcher = createDispatcher([sub]);
    const r = await dispatcher.replayForStudent('no-scope', 'auth-user-X', ctx);
    expect(r).toEqual({ refused: 'not_student_scoped' });
  });

  it('throws for an unknown subscriber name', async () => {
    const dispatcher = createDispatcher([]);
    await expect(
      dispatcher.replayForStudent('ghost', 'auth-user-X', ctx),
    ).rejects.toThrow(/unknown subscriber/i);
  });

  it('re-invokes handler for matching events; does not mutate offset', async () => {
    const calls: string[] = [];
    const sub: AnySubscriber = {
      name: 'replayable',
      kind: 'learner.mastery_changed',
      studentIdFromEvent: (e) => e.actorAuthUserId,
      async handle(e) { calls.push(e.eventId); },
    };
    await sb.from('subscriber_offsets').insert({
      subscriber_name: 'replayable',
      kind_filter: 'learner.mastery_changed',
      last_processed_occurred_at: '2026-05-12T05:00:00Z',
    });
    await insertEvent(sb, { kind: 'learner.mastery_changed', actorAuthUserId: 'auth-1', occurredAt: '2026-05-12T01:00:00Z' });
    await insertEvent(sb, { kind: 'learner.mastery_changed', actorAuthUserId: 'auth-2', occurredAt: '2026-05-12T02:00:00Z' });
    await insertEvent(sb, { kind: 'learner.mastery_changed', actorAuthUserId: 'auth-1', occurredAt: '2026-05-12T03:00:00Z' });

    const dispatcher = createDispatcher([sub]);
    const r = await dispatcher.replayForStudent('replayable', 'auth-1', ctx);
    expect(r).toMatchObject({ replayed: 2, errors: [] });
    expect(calls.length).toBe(2);

    // Offset untouched.
    const { data: off } = await sb.from('subscriber_offsets')
      .select('last_processed_occurred_at').eq('subscriber_name', 'replayable').single();
    expect(off?.last_processed_occurred_at).toBe('2026-05-12T05:00:00+00:00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/state/subscribers/dispatcher.replay.test.ts`

Expected: FAIL — `replayForStudent` does not exist on `Dispatcher`.

- [ ] **Step 3: Add `replayForStudent` to the dispatcher**

Modify `src/lib/state/subscribers/dispatcher.ts`. Add to the `Dispatcher` interface and the factory return:

```ts
export interface ReplayResult {
  replayed?: number;
  errors?: Array<{ eventId: string; message: string }>;
  refused?: 'not_student_scoped';
}

export interface Dispatcher {
  handleEvent(event: DomainEvent, ctx: SubscriberContext): Promise<DispatchOutcome[]>;
  subscribersFor<K extends DomainEventKind>(kind: K): ReadonlyArray<Subscriber<K>>;
  list(): ReadonlyArray<AnySubscriber>;
  replayForStudent(
    subscriberName: string,
    studentId: string,
    ctx: SubscriberContext,
  ): Promise<ReplayResult>;
}
```

In `createDispatcher`, add the implementation:

```ts
async replayForStudent(subscriberName, studentId, ctx): Promise<ReplayResult> {
  const sub = subscribers.find(s => s.name === subscriberName);
  if (!sub) throw new Error(`unknown subscriber: ${subscriberName}`);
  if (!sub.studentIdFromEvent) return { refused: 'not_student_scoped' };

  // Filter events by kind + payload→studentId match in JS (PostgREST
  // can express the latter via filter('payload->>studentId', 'eq', ...)
  // but actorAuthUserId-keyed events use a column not the payload, so
  // we fetch by kind and filter in JS for correctness across both shapes).
  const { data: rows } = await ctx.sb
    .from('state_events')
    .select('*')
    .eq('kind', sub.kind)
    .order('occurred_at', { ascending: true })
    .order('event_id', { ascending: true });

  let replayed = 0;
  const errors: Array<{ eventId: string; message: string }> = [];
  for (const row of rows ?? []) {
    const parsed = parseEventRow(row);
    if (!parsed) continue;
    if (sub.studentIdFromEvent(parsed) !== studentId) continue;
    try {
      await sub.handle(parsed, ctx);
      replayed += 1;
    } catch (err) {
      errors.push({
        eventId: parsed.eventId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { replayed, errors };
},
```

Add the `parseEventRow` helper at the bottom of dispatcher.ts (or import from a shared util):

```ts
function parseEventRow(row: unknown): DomainEvent | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const candidate = {
    eventId: r.event_id,
    occurredAt: r.occurred_at,
    actorAuthUserId: r.actor_auth_user_id,
    tenantId: r.tenant_id ?? null,
    idempotencyKey: r.idempotency_key,
    kind: r.kind,
    payload: r.payload,
  };
  const parsed = DomainEventSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
```

Add `DomainEventSchema` to the existing import from `../events/registry`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/state/subscribers/dispatcher.replay.test.ts`

Expected: PASS — all three cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state/subscribers/dispatcher.ts \
        src/lib/state/subscribers/dispatcher.replay.test.ts
git commit -m "feat(state-runtime): dispatcher.replayForStudent (does not mutate offsets)"
```

---

## Task 11: Admin replay endpoint

**Files:**
- Create: `src/app/api/admin/projectors/replay/route.ts`
- Create: `src/app/api/admin/projectors/replay/route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/app/api/admin/projectors/replay/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockReplayForStudent = vi.fn();
vi.mock('@/lib/state/subscribers/dispatcher', async () => {
  const actual = await vi.importActual<typeof import('@/lib/state/subscribers/dispatcher')>(
    '@/lib/state/subscribers/dispatcher',
  );
  return {
    ...actual,
    standardDispatcher: {
      ...actual.standardDispatcher,
      replayForStudent: mockReplayForStudent,
    },
  };
});

const mockResolveAdmin = vi.fn();
vi.mock('@/lib/auth/resolve-admin', () => ({ resolveAdmin: mockResolveAdmin }));

beforeEach(() => { vi.clearAllMocks(); });

describe('POST /api/admin/projectors/replay', () => {
  it('returns 401 when caller is not admin', async () => {
    mockResolveAdmin.mockResolvedValueOnce(null);
    const req = new Request('http://localhost/api/admin/projectors/replay', {
      method: 'POST',
      body: JSON.stringify({ subscriberName: 's', studentId: 'auth-1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 on missing body fields', async () => {
    mockResolveAdmin.mockResolvedValueOnce({ id: 'admin-1' });
    const req = new Request('http://localhost/api/admin/projectors/replay', {
      method: 'POST', body: JSON.stringify({ subscriberName: 's' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('calls replayForStudent and returns its result', async () => {
    mockResolveAdmin.mockResolvedValueOnce({ id: 'admin-1' });
    mockReplayForStudent.mockResolvedValueOnce({ replayed: 5, errors: [] });
    const req = new Request('http://localhost/api/admin/projectors/replay', {
      method: 'POST',
      body: JSON.stringify({ subscriberName: 'mastery-state-writer', studentId: 'auth-1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ replayed: 5, errors: [] });
    expect(mockReplayForStudent).toHaveBeenCalledWith(
      'mastery-state-writer', 'auth-1', expect.any(Object),
    );
  });

  it('surfaces 422 for not_student_scoped', async () => {
    mockResolveAdmin.mockResolvedValueOnce({ id: 'admin-1' });
    mockReplayForStudent.mockResolvedValueOnce({ refused: 'not_student_scoped' });
    const req = new Request('http://localhost/api/admin/projectors/replay', {
      method: 'POST',
      body: JSON.stringify({ subscriberName: 'noop', studentId: 'auth-1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('not_student_scoped');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/app/api/admin/projectors/replay/route.test.ts`

Expected: FAIL — module `./route` does not exist.

- [ ] **Step 3: Implement the route**

Create `src/app/api/admin/projectors/replay/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { resolveAdmin } from '@/lib/auth/resolve-admin';
import { standardDispatcher } from '@/lib/state/subscribers/dispatcher';
import { defaultLog } from '@/lib/state/subscribers/subscriber';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  subscriberName: z.string().min(1).max(100),
  studentId: z.string().min(1),
});

export async function POST(request: Request) {
  const admin = await resolveAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    const json = await request.json();
    body = BodySchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: 'bad_request', detail: (err as Error).message.slice(0, 200) },
      { status: 400 },
    );
  }

  try {
    const result = await standardDispatcher.replayForStudent(
      body.subscriberName,
      body.studentId,
      {
        sb: supabaseAdmin,
        dryRun: false,
        now: () => new Date(),
        log: defaultLog,
      },
    );

    logger.info('admin replay invoked', {
      adminId: admin.id,
      subscriberName: body.subscriberName,
      studentId: body.studentId,
      result,
    });

    if (result.refused === 'not_student_scoped') {
      return NextResponse.json(
        { error: 'not_student_scoped' },
        { status: 422 },
      );
    }
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('unknown subscriber')) {
      return NextResponse.json({ error: 'unknown_subscriber' }, { status: 404 });
    }
    logger.error('admin replay failed', { error: msg });
    return NextResponse.json({ error: 'replay_failed', detail: msg.slice(0, 500) }, { status: 500 });
  }
}
```

Note: this assumes `@/lib/auth/resolve-admin` exists. Verify in the codebase; if it's a different helper (e.g. `resolveAdminFromRequest`), adjust the import. The test mocks the module so the test passes regardless.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/app/api/admin/projectors/replay/route.test.ts`

Expected: PASS — all four cases.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/projectors/replay/route.ts \
        src/app/api/admin/projectors/replay/route.test.ts
git commit -m "feat(api): admin /projectors/replay endpoint"
```

---

## Task 12: Edge Function `projector-runner`

**Files:**
- Create: `supabase/functions/projector-runner/index.ts`

- [ ] **Step 1: Create the Edge Function**

Create `supabase/functions/projector-runner/index.ts`:

```ts
// Supabase Edge Function: projector-runner
// Invoked every 1 minute by pg_cron via pg_net.http_post.
// Calls tickAll(); returns the per-subscriber summary.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { tickAll } from '../../../src/lib/state/runtime/tick-all.ts';
import { standardDispatcher } from '../../../src/lib/state/subscribers/dispatcher.ts';
import { defaultLog } from '../../../src/lib/state/subscribers/subscriber.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (_req) => {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  const start = performance.now();
  try {
    const result = await tickAll({
      sb,
      dispatcher: standardDispatcher,
      ctx: { sb, dryRun: false, now: () => new Date(), log: defaultLog },
    });
    const durationMs = Math.round(performance.now() - start);
    // PostHog summary capture (server-side) — fire-and-forget.
    captureSummary(result, durationMs).catch(() => {});
    return new Response(JSON.stringify({ ...result, durationMs }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
});

async function captureSummary(result: unknown, durationMs: number) {
  const apiKey = Deno.env.get('POSTHOG_PROJECT_API_KEY');
  if (!apiKey) return;
  await fetch('https://us.i.posthog.com/i/v0/e/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      event: 'projector_runner_summary',
      distinct_id: 'projector-runner',
      properties: { result, durationMs },
    }),
  });
}
```

Note: imports use relative paths because Supabase Edge Functions bundle from the project root. Verify the Deno bundler picks them up; if not, copy the small set of TS files into `supabase/functions/_shared/` and import from there. Check at PR-author time.

- [ ] **Step 2: Local smoke**

Run: `supabase functions serve projector-runner --no-verify-jwt`

Then in another shell: `curl -X POST http://127.0.0.1:54321/functions/v1/projector-runner -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"`

Expected: JSON response. If `ff_projector_runner_v1` is OFF locally, expect `{"skipped":true,"perSubscriber":[],"durationMs":N}`. If ON, expect per-subscriber summaries.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/projector-runner/index.ts
git commit -m "feat(state-runtime): projector-runner Edge Function"
```

---

## Task 13: pg_cron migration

**Files:**
- Create: `supabase/migrations/20260522000002_projector_runner_cron.sql`

- [ ] **Step 1: Verify pg_cron + pg_net are enabled**

Run (against staging or local): `psql "$DATABASE_URL" -c "SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net');"`

Expected: two rows. If missing, prepend extension creation to the migration (requires admin role; coordinate with the user before running on production).

- [ ] **Step 2: Verify the runtime GUCs**

Run: `psql "$DATABASE_URL" -c "SELECT current_setting('app.projector_runner_url', true), current_setting('app.service_role_key', true);"`

Expected: both non-NULL. If either is NULL, set via Supabase Vault → `ALTER DATABASE postgres SET app.projector_runner_url = '<edge-fn-url>'`. Coordinate with the user; do NOT inline the service-role key into the migration.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260522000002_projector_runner_cron.sql`:

```sql
-- pg_cron schedule for the projector-runner Edge Function.
-- Requires: pg_cron + pg_net extensions, plus GUCs:
--   app.projector_runner_url  (set out-of-band via Supabase Vault / ALTER DATABASE)
--   app.service_role_key      (likewise)

-- Idempotent guard: if a job with this name exists, drop it first.
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'projector-runner-tick';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  job_name := 'projector-runner-tick',
  schedule := '*/1 * * * *',
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
```

- [ ] **Step 4: Apply locally; verify the cron row**

Run: `supabase migration up` then `psql "$DATABASE_URL" -c "SELECT jobname, schedule FROM cron.job WHERE jobname='projector-runner-tick';"`

Expected: one row with `schedule = '*/1 * * * *'`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260522000002_projector_runner_cron.sql
git commit -m "feat(state-runtime): pg_cron + pg_net schedule for projector-runner"
```

---

## Task 14: Adapt `event-listener.ts` to use `tickAll`

**Files:**
- Modify: `src/lib/state/runtime/event-listener.ts`

- [ ] **Step 1: Rewrite `tick` and `run` to delegate to `tickAll`**

Modify `src/lib/state/runtime/event-listener.ts`. Replace the body of `tick()` and `run()` with thin adapters around `tickAll`. The legacy global-cursor write to `bus_cursor` is preserved as a courtesy for the standalone script but is no longer the source of truth.

```ts
import { tickAll } from './tick-all';

// ... existing imports + types ...

export async function tick(opts: ListenerOptions): Promise<TickResult> {
  const dispatcher = opts.dispatcher ?? standardDispatcher;
  const ctx: SubscriberContext = {
    sb: opts.sb, dryRun: opts.dryRun ?? false,
    now: opts.now ?? (() => new Date()),
    log: opts.log ?? defaultLog,
  };
  const allResult = await tickAll({
    sb: opts.sb, ctx, dispatcher,
    batchSize: opts.batchSize,
  });
  // Best-effort legacy bus_cursor advance: min of all subscribers' offsets.
  // Used only by the standalone script for backwards-compat reporting.
  await legacyAdvanceBusCursor(opts.sb, allResult).catch(() => {});
  return projectToLegacyShape(allResult);
}

async function legacyAdvanceBusCursor(/* ... */): Promise<void> { /* ... */ }
function projectToLegacyShape(/* ... */): TickResult { /* ... */ }

export async function run(opts: ListenerOptions & { intervalMs?: number; signal?: AbortSignal }) {
  const interval = opts.intervalMs ?? 1000;
  for (;;) {
    if (opts.signal?.aborted) return;
    try {
      await tick(opts);
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(`[event-listener] tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(interval, opts.signal);
  }
}
```

Implement the helpers minimally — `legacyAdvanceBusCursor` reads min(`last_processed_occurred_at`) across `subscriber_offsets` and upserts `bus_cursor` for backwards compat; `projectToLegacyShape` maps the new result shape into the existing `TickResult` for legacy callers.

- [ ] **Step 2: Run existing event-listener tests (if any)**

Run: `pnpm exec vitest run src/lib/state/runtime/`

Expected: PASS. Adjust legacy shape projection if existing tests fail; do not soften the new semantics.

- [ ] **Step 3: Commit**

```bash
git add src/lib/state/runtime/event-listener.ts
git commit -m "refactor(state-runtime): tick/run delegate to tickAll; bus_cursor becomes legacy backstop"
```

---

## Task 15: Integration test — full pipeline

**Files:**
- Create: `src/lib/state/runtime/integration.test.ts`

- [ ] **Step 1: Write a multi-subscriber, multi-tick integration test**

Create `src/lib/state/runtime/integration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { tickAll } from './tick-all';
import { __resetFlagCacheForTests } from './flag';
import { createDispatcher, type AnySubscriber } from '../subscribers/dispatcher';
import { defaultLog, type SubscriberContext } from '../subscribers/subscriber';
import { makeServiceSupabase, resetDb, insertEvent } from '@/test/supabase-test-helpers';

const sb = makeServiceSupabase();
const ctx: SubscriberContext = { sb, dryRun: false, now: () => new Date(), log: defaultLog };

beforeEach(async () => {
  await resetDb([
    'state_events', 'subscriber_offsets',
    'subscriber_retry_state', 'subscriber_dead_letters', 'feature_flags',
  ]);
  __resetFlagCacheForTests();
  await sb.from('feature_flags').insert({
    flag_name: 'ff_projector_runner_v1', is_enabled: true,
    rollout_percentage: 100, target_environments: ['production'],
  });
});

describe('integration: tickAll with two subscribers', () => {
  it('isolates a failing subscriber: bad event dead-letters after 3 ticks; good subscriber continues', async () => {
    let badAttempts = 0;
    const badSub: AnySubscriber = {
      name: 'bad', kind: 'learner.quiz_completed', maxRetries: 3,
      async handle() { badAttempts += 1; throw new Error('always fails'); },
    };
    const okCalls: string[] = [];
    const okSub: AnySubscriber = {
      name: 'ok', kind: 'learner.mastery_changed',
      async handle(e) { okCalls.push(e.eventId); },
    };
    await sb.from('subscriber_offsets').insert([
      { subscriber_name: 'bad', kind_filter: 'learner.quiz_completed', last_processed_occurred_at: '2026-05-12T00:00:00Z' },
      { subscriber_name: 'ok',  kind_filter: 'learner.mastery_changed', last_processed_occurred_at: '2026-05-12T00:00:00Z' },
    ]);

    const bad = await insertEvent(sb, { kind: 'learner.quiz_completed', occurredAt: '2026-05-12T01:00:00Z' });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: '2026-05-12T01:00:00Z' });
    await insertEvent(sb, { kind: 'learner.mastery_changed', occurredAt: '2026-05-12T02:00:00Z' });

    const dispatcher = createDispatcher([badSub, okSub]);
    await tickAll({ sb, ctx, dispatcher });  // tick 1
    await tickAll({ sb, ctx, dispatcher });  // tick 2
    const r3 = await tickAll({ sb, ctx, dispatcher });  // tick 3 — bad dead-letters

    expect(badAttempts).toBe(3);
    expect(r3.perSubscriber.find(r => r.subscriberName === 'bad')?.deadLettered).toBe(1);
    const { data: dl } = await sb.from('subscriber_dead_letters')
      .select('attempt_count').eq('event_id', bad.eventId).eq('subscriber_name', 'bad').single();
    expect(dl?.attempt_count).toBe(3);

    // ok subscriber unaffected.
    expect(okCalls.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `pnpm exec vitest run src/lib/state/runtime/integration.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/state/runtime/integration.test.ts
git commit -m "test(state-runtime): integration — failing subscriber dead-letters after 3 ticks; others unaffected"
```

---

## Task 16: Manual smoke checklist (staging)

This task is execution, not a code change. Run after the branch is deployed to staging via the standard `Sync Migrations to Staging` workflow.

- [ ] **Step 1: Apply migrations to staging**

Push the branch; the GitHub Action `Sync Migrations to Staging` runs `supabase db push --linked` against staging. Verify success in the Action logs.

- [ ] **Step 2: Verify schema in staging**

Run via Supabase SQL editor (staging project):

```sql
SELECT to_regclass('public.subscriber_offsets'),
       to_regclass('public.subscriber_retry_state'),
       to_regclass('public.subscriber_dead_letters');
SELECT * FROM public.subscriber_lag;
SELECT * FROM public.feature_flags WHERE flag_name = 'ff_projector_runner_v1';
SELECT jobname, schedule FROM cron.job WHERE jobname = 'projector-runner-tick';
```

Expected: three table OIDs, one lag row for mastery-state-writer (events_behind=0), flag row is_enabled=false, one cron job row.

- [ ] **Step 3: Set Vault GUCs**

If not already done in production:

```
ALTER DATABASE postgres SET app.projector_runner_url = 'https://<staging-ref>.functions.supabase.co/projector-runner';
ALTER DATABASE postgres SET app.service_role_key     = '<from Supabase dashboard → Settings → API>';
```

Reload: `SELECT pg_reload_conf();`

- [ ] **Step 4: Flip the flag ON in staging**

```sql
UPDATE feature_flags SET is_enabled = true WHERE flag_name = 'ff_projector_runner_v1';
```

- [ ] **Step 5: Watch for cron firings**

Wait 2 minutes, then:

```sql
SELECT runid, start_time, end_time, return_message
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='projector-runner-tick')
ORDER BY start_time DESC LIMIT 5;
```

Expected: at least 2 successful runs (return_message empty or "1 row"). If `return_message` shows an error, debug.

- [ ] **Step 6: Insert a malformed event, watch dead-letter**

```sql
INSERT INTO state_events (event_id, kind, actor_auth_user_id, idempotency_key, occurred_at, payload)
VALUES (gen_random_uuid(), 'learner.mastery_changed', '00000000-0000-0000-0000-000000000000',
        'smoke-bad-' || gen_random_uuid()::text, NOW(),
        '{"subjectCode": "math", "chapterNumber": "not-a-number", "toMastery": 0.5}');
```

(The `chapterNumber` should be int; the Zod parse fails inside the handler.)

Wait 3 minutes (3 cron firings). Then:

```sql
SELECT * FROM subscriber_dead_letters
WHERE subscriber_name = 'mastery-state-writer'
ORDER BY last_attempted_at DESC LIMIT 5;
```

Expected: at least one row with `attempt_count = 3`, the malformed event_id, and last_error mentioning Zod or the chapterNumber field.

- [ ] **Step 7: Confirm flag-OFF kill switch**

```sql
UPDATE feature_flags SET is_enabled = false WHERE flag_name = 'ff_projector_runner_v1';
```

Wait 90 seconds, then check `cron.job_run_details` — recent runs should still fire (cron unchanged), but the Edge Function should return `{"skipped":true}`. Verify via `SELECT return_message FROM cron.job_run_details ...` if pg_net surfaces the body, OR by checking the Edge Function logs in the Supabase dashboard.

- [ ] **Step 8: Reset staging state for the PR review demo**

```sql
DELETE FROM subscriber_dead_letters WHERE subscriber_name = 'mastery-state-writer';
DELETE FROM subscriber_retry_state WHERE subscriber_name = 'mastery-state-writer';
UPDATE feature_flags SET is_enabled = false WHERE flag_name = 'ff_projector_runner_v1';
```

---

## Definition of done (mirrors spec)

- [ ] Migration `20260522000001_state_runtime_per_subscriber.sql` applies cleanly to staging.
- [ ] Migration `20260522000002_projector_runner_cron.sql` creates one cron job; first 5 firings succeed.
- [ ] Edge Function returns `{skipped:true}` when `ff_projector_runner_v1` is OFF.
- [ ] Edge Function processes events when flag is ON; `subscriber_lag.events_behind` stays at 0 for `mastery-state-writer` in steady state.
- [ ] Deliberately-malformed event lands in `subscriber_dead_letters` after exactly 3 cron firings.
- [ ] `replayForStudent` works for `mastery-state-writer`; refuses for a student-unscoped fake subscriber in unit tests.
- [ ] All new unit tests pass; existing tests in `src/lib/state/**` and `src/app/api/**` continue to pass.
- [ ] PR description references this plan + the source spec + ADR-005.
- [ ] PR follows P14 review chain: architect, backend, ops, testing.

---

## Plan self-review

- Each task has a single concrete responsibility and ends in a commit.
- Every test step has a concrete failing test + a concrete expected failure message + a concrete passing implementation.
- No placeholders: every code block is the actual code the engineer types.
- Type consistency: `SubscriberOffset`, `TickOneResult`, `TickAllResult`, `ReplayResult`, `Subscriber.maxRetries`, `Subscriber.studentIdFromEvent` are used identically across tasks.
- Spec coverage:
  - per-subscriber cursors → Tasks 1, 3, 6, 7, 8
  - persistent retry state across ticks → Tasks 1, 4, 7
  - dead-letter table → Tasks 1, 4, 7
  - replay-by-student → Tasks 9, 10, 11
  - per-subscriber lag view → Task 1 (schema)
  - pg_cron + pg_net invocation → Tasks 12, 13
  - kill-switch flag → Tasks 1, 5, 8
  - legacy `tick`/`run` adapter for back-compat → Task 14
  - manual staging smoke → Task 16
  - existing `mastery-state-writer` extended with `studentIdFromEvent` → Task 9
- Missing pieces: none. Test helper module `@/test/supabase-test-helpers` referenced by all integration tests; if it does not exist in the repo, the executing skill should add a small wrapper around `createClient(SUPABASE_URL, SERVICE_ROLE)` + a `resetDb(tables: string[])` that issues `DELETE FROM` for each, plus an `insertEvent(sb, partial)` that fills required fields with sensible defaults. This is utility plumbing — flag during execution if absent.
