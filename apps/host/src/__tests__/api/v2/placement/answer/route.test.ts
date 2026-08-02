/**
 * Contract tests for POST /api/v2/placement/answer (Wave B placement check).
 *
 * Pins the 4 explicitly-flagged regression risks for this route plus the
 * standard auth/flag/validation contract:
 *
 *   1. IDEMPOTENCY RACE: a 23505 unique-violation from the INSERT (naming the
 *      learning_events_placement_probe_idempotency_uniq index in its
 *      message/details/hint) is caught and translated into the SAME
 *      `{ accepted: true, duplicate: true }` 200 response as the fast-path
 *      SELECT-before-insert hit — proving the route does not rely SOLELY on
 *      the racy select-then-insert fast path for correctness. An unrelated
 *      23505 (different constraint) is NOT swallowed — it 500s.
 *   2. topicId: null MUST flow through to the insert payload verbatim — never
 *      defaulted/coerced to the question id or any other value.
 *   3. unseen/optionId mutual exclusivity: rejects when both are set, and
 *      when neither is set (both null/false).
 *   4. RBAC: uses study_plan.create (a WRITE permission), NOT study_plan.view
 *      (the sibling GET routes' permission).
 *   5. Flag gate: 404 when ff_placement_v1 is off, checked before body
 *      parsing/validation.
 *   6. occurredAt clamping: future timestamps clamp to now; timestamps more
 *      than 48h in the past clamp to (now - 48h).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const holders = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
}));
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => holders.mockIsFeatureEnabled(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Mock Supabase server client ─────────────────────────────────────────────
// The route does: .from('learning_events').select('id').eq(...).contains(...).limit(1)
// (fast-path lookup) then, if empty, .from('learning_events').insert({...}).
interface FastPathState {
  data: Array<{ id: string }> | null;
  error: null;
}
interface InsertState {
  error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null;
}

let fastPath: FastPathState = { data: [], error: null };
let insertResult: InsertState = { error: null };
let lastInsertPayload: Record<string, unknown> | null = null;
let insertCallCount = 0;
let fastPathCallCount = 0;

vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    from: (table: string) => {
      if (table !== 'learning_events') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            contains: () => ({
              limit: () => {
                fastPathCallCount++;
                return Promise.resolve(fastPath);
              },
            }),
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          insertCallCount++;
          lastInsertPayload = payload;
          return Promise.resolve(insertResult);
        },
      };
    },
  }),
}));

const AUTH_USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const STUDENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const QUESTION_ID = '22222222-2222-4222-8222-222222222222';
const TOPIC_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';

function authOk() {
  holders.mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: AUTH_USER_ID,
    studentId: STUDENT_ID,
    roles: ['student'],
    permissions: ['study_plan.create'],
  });
}

function authDenied403() {
  holders.mockAuthorize.mockResolvedValue({
    authorized: false,
    userId: null,
    errorResponse: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
  });
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: SESSION_ID,
    questionId: QUESTION_ID,
    topicId: TOPIC_ID,
    optionId: '2',
    unseen: false,
    idempotencyKey: IDEMPOTENCY_KEY,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v2/placement/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authOk();
  holders.mockIsFeatureEnabled.mockResolvedValue(true);
  fastPath = { data: [], error: null };
  insertResult = { error: null };
  lastInsertPayload = null;
  insertCallCount = 0;
  fastPathCallCount = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/v2/placement/answer — auth gate', () => {
  it('returns the authorizeRequest errorResponse verbatim when not authorized', async () => {
    authDenied403();
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const res = await POST(makeRequest(baseBody()) as never);
    expect(res.status).toBe(403);
  });

  it('uses study_plan.create (a WRITE permission) — NOT study_plan.view', async () => {
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    await POST(makeRequest(baseBody()) as never);
    expect(holders.mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      'study_plan.create',
      expect.objectContaining({ requireStudentId: true }),
    );
    expect(holders.mockAuthorize).not.toHaveBeenCalledWith(
      expect.anything(),
      'study_plan.view',
      expect.anything(),
    );
  });
});

describe('POST /api/v2/placement/answer — flag gate', () => {
  it('returns 404 when ff_placement_v1 is off, before body parsing', async () => {
    holders.mockIsFeatureEnabled.mockResolvedValue(false);
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    // Malformed JSON body — if the flag check runs first, we never even try
    // to parse it, so this should still 404, not 400.
    const req = new Request('http://localhost/api/v2/placement/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    const res = await POST(req as never);
    expect(res.status).toBe(404);
    expect(insertCallCount).toBe(0);
  });
});

describe('POST /api/v2/placement/answer — body validation', () => {
  it('returns 400 on malformed JSON', async () => {
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const req = new Request('http://localhost/api/v2/placement/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when a required field is missing (sessionId)', async () => {
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const body = baseBody() as Record<string, unknown>;
    delete body.sessionId;
    const res = await POST(makeRequest(body) as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when idempotencyKey is not a UUID', async () => {
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const res = await POST(makeRequest(baseBody({ idempotencyKey: 'not-a-uuid' })) as never);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v2/placement/answer — unseen/optionId mutual exclusivity', () => {
  it('rejects when BOTH unseen=true and optionId is set', async () => {
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const res = await POST(makeRequest(baseBody({ unseen: true, optionId: '1' })) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.error).toMatch(/mutually exclusive/i);
    expect(insertCallCount).toBe(0);
  });

  it('rejects when NEITHER unseen nor optionId is set (unseen=false, optionId=null)', async () => {
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const res = await POST(makeRequest(baseBody({ unseen: false, optionId: null })) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/mutually exclusive/i);
    expect(insertCallCount).toBe(0);
  });

  it('accepts unseen=true with optionId=null (the "haven\'t done this yet" answer)', async () => {
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const res = await POST(makeRequest(baseBody({ unseen: true, optionId: null })) as never);
    expect(res.status).toBe(200);
    expect(lastInsertPayload?.result).toEqual({ optionId: null, unseen: true });
  });

  it('accepts unseen=false with a non-null optionId (a normal answer)', async () => {
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const res = await POST(makeRequest(baseBody({ unseen: false, optionId: '3' })) as never);
    expect(res.status).toBe(200);
    expect(lastInsertPayload?.result).toEqual({ optionId: '3', unseen: false });
  });
});

describe('POST /api/v2/placement/answer — topicId: null passthrough (fabricated-id bug fix)', () => {
  it('passes topicId: null straight through to the insert payload — never defaults to questionId', async () => {
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const res = await POST(makeRequest(baseBody({ topicId: null })) as never);
    expect(res.status).toBe(200);
    expect(lastInsertPayload?.topic_id).toBeNull();
    expect(lastInsertPayload?.topic_id).not.toBe(QUESTION_ID);
  });

  it('passes a real topicId through unchanged', async () => {
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    await POST(makeRequest(baseBody({ topicId: TOPIC_ID })) as never);
    expect(lastInsertPayload?.topic_id).toBe(TOPIC_ID);
  });
});

describe('POST /api/v2/placement/answer — idempotency (race-condition fix)', () => {
  it('fast path: an existing row for the same idempotencyKey short-circuits to a duplicate response without inserting', async () => {
    fastPath = { data: [{ id: 'existing-row' }], error: null };
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const res = await POST(makeRequest(baseBody()) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ accepted: true, duplicate: true });
    expect(insertCallCount).toBe(0);
  });

  it('DB race backstop: a 23505 naming the idempotency index on INSERT (fast path missed) translates to the SAME duplicate response, not a 500', async () => {
    // Fast path found nothing (simulating two concurrent requests racing past
    // the SELECT before either has inserted) — the INSERT itself then hits
    // the unique index.
    fastPath = { data: [], error: null };
    insertResult = {
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "learning_events_placement_probe_idempotency_uniq"',
        details: null,
        hint: null,
      },
    };
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const res = await POST(makeRequest(baseBody()) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ accepted: true, duplicate: true });
    // Proves the route actually attempted the insert (raced past the fast
    // path) rather than the fast path alone preventing the duplicate.
    expect(insertCallCount).toBe(1);
  });

  it('a 23505 on an UNRELATED constraint is NOT swallowed as a duplicate — still 500s', async () => {
    fastPath = { data: [], error: null };
    insertResult = {
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "some_other_unique_index"',
        details: null,
        hint: null,
      },
    };
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const res = await POST(makeRequest(baseBody()) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('INTERNAL_ERROR');
  });

  it('a non-23505 insert error still 500s (handling is not widened beyond the named index)', async () => {
    fastPath = { data: [], error: null };
    insertResult = { error: { code: '23514', message: 'check constraint violated' } };
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const res = await POST(makeRequest(baseBody()) as never);
    expect(res.status).toBe(500);
  });

  it('matches the 23505 index name via `details` as well as `message`', async () => {
    fastPath = { data: [], error: null };
    insertResult = {
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
        details: 'Key (student_id, (context ->> \'idempotencyKey\'::text))=(...) already exists for learning_events_placement_probe_idempotency_uniq.',
        hint: null,
      },
    };
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const res = await POST(makeRequest(baseBody()) as never);
    expect(res.status).toBe(200);
    expect((await res.json()).data.duplicate).toBe(true);
  });

  it('a successful (non-duplicate) insert returns { accepted: true, duplicate: false }', async () => {
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const res = await POST(makeRequest(baseBody()) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ accepted: true, duplicate: false });
    expect(insertCallCount).toBe(1);
  });
});

describe('POST /api/v2/placement/answer — insert payload shape', () => {
  it('writes event_type=placement_probe with student_id from auth.uid(), not the body', async () => {
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    await POST(makeRequest(baseBody()) as never);
    expect(lastInsertPayload).toMatchObject({
      student_id: AUTH_USER_ID,
      event_type: 'placement_probe',
      object_type: 'placement_probe',
      session_id: SESSION_ID,
      question_id: QUESTION_ID,
    });
    expect(lastInsertPayload?.context).toEqual({ source: 'placement', idempotencyKey: IDEMPOTENCY_KEY });
  });

  it('sets verb to "declared-unseen" for an unseen answer and "answered" otherwise', async () => {
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    await POST(makeRequest(baseBody({ unseen: true, optionId: null })) as never);
    expect(lastInsertPayload?.verb).toBe('declared-unseen');

    await POST(makeRequest(baseBody({ unseen: false, optionId: '1' })) as never);
    expect(lastInsertPayload?.verb).toBe('answered');
  });
});

describe('POST /api/v2/placement/answer — occurredAt clamping', () => {
  it('clamps a future occurredAt to now', async () => {
    vi.setSystemTime(new Date('2026-08-02T09:00:00.000Z'));
    const future = '2026-08-02T10:00:00.000Z';
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    await POST(makeRequest(baseBody({ occurredAt: future })) as never);
    expect(lastInsertPayload?.occurred_at).toBe('2026-08-02T09:00:00.000Z');
  });

  it('clamps a >48h-old occurredAt to (now - 48h)', async () => {
    vi.setSystemTime(new Date('2026-08-02T09:00:00.000Z'));
    const tooOld = '2026-07-01T00:00:00.000Z';
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    await POST(makeRequest(baseBody({ occurredAt: tooOld })) as never);
    expect(lastInsertPayload?.occurred_at).toBe('2026-07-31T09:00:00.000Z');
  });

  it('passes through a valid recent occurredAt unchanged', async () => {
    vi.setSystemTime(new Date('2026-08-02T09:00:00.000Z'));
    const recent = '2026-08-02T08:00:00.000Z';
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    await POST(makeRequest(baseBody({ occurredAt: recent })) as never);
    expect(lastInsertPayload?.occurred_at).toBe(recent);
  });
});

describe('POST /api/v2/placement/answer — unexpected failures', () => {
  it('returns 500 INTERNAL_ERROR without leaking raw error text when supabase throws', async () => {
    const { createSupabaseServerClient } = await import('@alfanumrik/lib/supabase-server');
    (createSupabaseServerClient as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom: connection string leaked'),
    );
    const { POST } = await import('@/app/api/v2/placement/answer/route');
    const res = await POST(makeRequest(baseBody()) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toMatch(/leaked/);
  });
});
