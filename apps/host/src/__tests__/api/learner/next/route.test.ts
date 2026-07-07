/**
 * GET /api/learner/next — H2b Stage 1 dual-write parity tests.
 *
 * Stage 1 has the route do BOTH (inside the `ff_scheduled_actions_v1 ON`
 * block):
 *   (a) an inline `supabaseAdmin.from('scheduled_actions').upsert(row)`, and
 *   (b) a best-effort `publishEvent(... 'learner.next_action_resolved' ...)`.
 *
 * The projector (`scheduled-actions-writer.ts`) later turns that event payload
 * back into the SAME row. Until these tests existed, the dual-write was
 * "parity by convention" — the route author and the projector author had to
 * agree on the column mapping by reading each other's code. These tests
 * convert it to "parity by assertion": we capture BOTH writes from one route
 * invocation and prove, byte-for-byte, that feeding the published event through
 * the REAL projector reproduces the inline upsert row exactly. That assertion
 * is the gating artifact that lets Stage 2 safely DELETE the inline write.
 *
 * Harness: every collaborator the route touches is mocked at its import
 * boundary (auth, feature flags, state builder, resolver, posthog, logger,
 * supabaseAdmin, publishEvent). The two pure bucket helpers
 * (`scheduled-actions.ts` dayBucketIst / expiresAtForHorizon) are NOT mocked —
 * the route and the published payload must compute identical bucket/expiry
 * values from the same `now`, and using the real functions is what proves it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StartQuizAction } from '@alfanumrik/lib/state/learner-loop/types';
import type { DomainEvent } from '@alfanumrik/lib/state/events/registry';
import { scheduledActionsWriter } from '@alfanumrik/lib/state/subscribers/scheduled-actions-writer';
import type { SubscriberContext } from '@alfanumrik/lib/state/subscribers/subscriber';

// ── Fixtures ─────────────────────────────────────────────────────────
const USER_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';

// The resolver's chosen action. A single shared reference so we can assert
// the jsonb `action_payload` is the SAME object on both write paths (identity,
// not just deep-equal) — the route and the event payload must both carry the
// resolver's body verbatim.
const RESOLVED_ACTION: StartQuizAction = {
  kind: 'start_quiz',
  url: '/quiz?subject=math&chapter=1',
  subjectCode: 'math',
  chapterNumber: 1,
  zpdBin: 2,
  reason: 'todays_zpd',
};

// ── Collaborator mocks ───────────────────────────────────────────────

// Auth: always a signed-in student.
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID } },
        error: null,
      })),
    },
  })),
}));

// Feature flags. ff_learner_loop_v1 is always ON (so the route runs the
// resolver); ff_scheduled_actions_v1 is controllable per test via the
// module-level `scheduledFlagOn` toggle.
let scheduledFlagOn = true;
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async (flag: string) => {
    if (flag === 'ff_learner_loop_v1') return true;
    if (flag === 'ff_scheduled_actions_v1') return scheduledFlagOn;
    return false;
  }),
}));

// State builder: returns a minimal StudentState with the two fields the route
// reads (studentId, mastery for telemetry).
vi.mock('@alfanumrik/lib/state/student-state-builder', () => ({
  createStudentStateBuilder: vi.fn(() =>
    vi.fn(async () => ({ studentId: STUDENT_ID, mastery: [] })),
  ),
}));

// Resolver + augmentation. Augmentation degrades to safe defaults; resolver
// returns the shared RESOLVED_ACTION reference.
vi.mock('@alfanumrik/lib/state/learner-loop/resolve-next-action', () => ({
  buildLoopAugmentation: vi.fn(async () => ({
    dueReviewCount: 0,
    attemptedQuizToday: false,
    inProgressLessons: [],
  })),
  resolveNextLearnerAction: vi.fn(() => RESOLVED_ACTION),
}));

// Telemetry + logger: inert.
vi.mock('@alfanumrik/lib/posthog/server', () => ({ capture: vi.fn(async () => {}) }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// supabaseAdmin: capture the inline upsert(row, opts) call. Returns
// `{ error: null }` so the route's success path runs.
const inlineUpsert = vi.fn(
  async (_row: Record<string, unknown>, _opts?: unknown) => ({ error: null }),
);
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table !== 'scheduled_actions') {
        throw new Error(`unexpected table: ${table}`);
      }
      return { upsert: inlineUpsert };
    }),
  },
}));

// publishEvent: capture the (client, event) call. Default resolves; individual
// tests can make it reject to exercise the bus-outage path.
const publishEvent = vi.fn(
  async (_sb: unknown, _event: DomainEvent) => ({ published: true }),
);
vi.mock('@alfanumrik/lib/state/events/publish', () => ({
  publishEvent: (sb: unknown, event: DomainEvent) => publishEvent(sb, event),
}));

// Import the route AFTER the mocks are registered.
import { GET } from '@/app/api/learner/next/route';

function mkReq(): Request {
  return new Request('http://localhost/api/learner/next', { method: 'GET' });
}

/**
 * Run the captured published event through the REAL projector and return the
 * row it would upsert. This is the projector's actual column mapping
 * (student_id←studentId, day_bucket←dayBucket, action_kind←actionKind,
 * source:'scheduler', …) — not a re-implementation of it in the test.
 */
async function projectorRowFor(event: DomainEvent): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> | undefined;
  const ctx = {
    dryRun: false,
    now: () => new Date(),
    log: () => {},
    sb: {
      from(table: string) {
        if (table !== 'scheduled_actions') throw new Error(`unexpected table: ${table}`);
        return {
          upsert: (row: Record<string, unknown>) => {
            captured = row;
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  } as unknown as SubscriberContext;
  await scheduledActionsWriter.handle(
    event as Extract<DomainEvent, { kind: 'learner.next_action_resolved' }>,
    ctx,
  );
  if (!captured) throw new Error('projector did not upsert');
  return captured;
}

describe('GET /api/learner/next — H2b Stage 1 dual-write', () => {
  beforeEach(() => {
    scheduledFlagOn = true;
    inlineUpsert.mockClear();
    inlineUpsert.mockResolvedValue({ error: null });
    publishEvent.mockClear();
    publishEvent.mockResolvedValue({ published: true });
  });

  // ── Test 1: PARITY (the gating artifact) ───────────────────────────
  it('parity: the published event projects to a row BYTE-EQUAL to the inline upsert', async () => {
    const res = await GET(mkReq());
    expect(res.status).toBe(200);

    // Capture BOTH writes from the single invocation.
    expect(inlineUpsert).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledTimes(1);

    const inlineRow = inlineUpsert.mock.calls[0][0] as Record<string, unknown>;
    const inlineOpts = inlineUpsert.mock.calls[0][1];
    const publishedEvent = publishEvent.mock.calls[0][1] as DomainEvent;

    // Map the event payload through the projector's OWN column mapping.
    const projectedRow = await projectorRowFor(publishedEvent);

    // BYTE-EQUALITY: deep structural equality of the full row. Every column —
    // student_id, horizon, day_bucket, rank, action_kind, action_payload,
    // source, generated_at, expires_at — must match. This is the strong
    // assertion (not a key-subset or truthiness check) that lets Stage 2
    // delete the inline write knowing the projector reproduces it exactly.
    expect(projectedRow).toEqual(inlineRow);

    // Explicit coverage of the two columns most likely to silently diverge:
    //
    // (a) source='scheduler' is a LITERAL — it is deliberately NOT on the
    //     event payload (the projector hard-codes it). Assert both sides
    //     carry it so a future payload-shape change can't drop it.
    expect(inlineRow.source).toBe('scheduler');
    expect(projectedRow.source).toBe('scheduler');
    expect((publishedEvent as { payload: Record<string, unknown> }).payload.source).toBeUndefined();

    // (b) the jsonb action_payload is the resolver's body VERBATIM — the same
    //     object reference flows down both paths (identity, not a copy).
    expect(inlineRow.action_payload).toBe(RESOLVED_ACTION);
    expect(projectedRow.action_payload).toBe(RESOLVED_ACTION);
    expect(projectedRow.action_payload).toEqual(inlineRow.action_payload);

    // Conflict key parity is part of the contract too (overwrite-within-day).
    expect(inlineOpts).toEqual({ onConflict: 'student_id,horizon,day_bucket,rank' });
  });

  // ── Test 2: FLAG-GATE ──────────────────────────────────────────────
  it('flag ON → exactly one inline upsert AND one publishEvent', async () => {
    scheduledFlagOn = true;
    const res = await GET(mkReq());

    expect(res.status).toBe(200);
    expect(inlineUpsert).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledTimes(1);

    // Response is the resolver envelope regardless of the dual-write.
    const body = await res.json();
    expect(body.action).toEqual(RESOLVED_ACTION);
  });

  it('flag OFF → ZERO inline upserts and ZERO publishEvents, response unchanged', async () => {
    scheduledFlagOn = false;
    const res = await GET(mkReq());

    // Neither write fires when ff_scheduled_actions_v1 is OFF.
    expect(inlineUpsert).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();

    // The client still gets the identical resolved action — the dual-write is
    // a side effect, never part of the response contract.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schemaVersion).toBe(1);
    expect(body.action).toEqual(RESOLVED_ACTION);
    expect(body.meta.branch).toBe('start_quiz');
  });

  // ── Test 3: BUS-OUTAGE ISOLATION ───────────────────────────────────
  it('bus outage: publishEvent rejecting still returns 200 with the resolver payload', async () => {
    publishEvent.mockRejectedValueOnce(new Error('event bus unreachable'));

    const res = await GET(mkReq());

    // The `.catch(() => {})` + best-effort contract: a bus outage must NEVER
    // affect the response. The inline upsert still ran (synchronous rollback
    // target), and the client still gets its action.
    expect(res.status).toBe(200);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(inlineUpsert).toHaveBeenCalledTimes(1);

    const body = await res.json();
    expect(body.action).toEqual(RESOLVED_ACTION);
  });
});
