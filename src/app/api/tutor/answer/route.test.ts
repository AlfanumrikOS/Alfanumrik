/**
 * POST /api/tutor/answer — ADR-004 Phase 2 Path C v2 behaviour.
 *
 * Pins the full flag matrix from the spec + every fallback branch:
 *   - 404 when ff_tutor_v1 is OFF.
 *   - 400 when ff_tutor_bkt_v1 ON but attempt_id missing.
 *   - All three flags ON, RPC succeeds → optimistic Path C response.
 *   - All three flags ON, RPC fails with 23505 → 409 already_answered.
 *   - All three flags ON, RPC fails otherwise → excluded marker + legacy fallback + PostHog.
 *   - ff_event_bus_v1 OFF (even with bkt+projector ON) → skip RPC, legacy path.
 *   - ff_tutor_bkt_v1 OFF entirely → legacy path (parity with Phase 0).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    isFeatureEnabled: vi.fn(),
    createSupabaseServerClient: vi.fn(),
    supabaseAdmin: {
      from: vi.fn(),
      rpc: vi.fn(),
    },
    capture: vi.fn(),
    loggerError: vi.fn(),
  },
}));

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => mocks.isFeatureEnabled(...args),
}));
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: () => mocks.createSupabaseServerClient(),
}));
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));
vi.mock('@/lib/posthog/server', () => ({
  capture: (...args: unknown[]) => mocks.capture(...args),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mocks.loggerError(...args),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { POST } from './route';

function setFlags(opts: { tutor: boolean; bkt: boolean; bus: boolean; projector: boolean }) {
  mocks.isFeatureEnabled.mockImplementation(async (flag: string) => {
    if (flag === 'ff_tutor_v1') return opts.tutor;
    if (flag === 'ff_tutor_bkt_v1') return opts.bkt;
    if (flag === 'ff_event_bus_v1') return opts.bus;
    if (flag === 'ff_projector_runner_v1') return opts.projector;
    return false;
  });
}

function setUser(userId: string) {
  mocks.createSupabaseServerClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    from(table: string) {
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 'student-1' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'chapter_concepts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'concept-1', subject: 'math', chapter_number: 1, difficulty: 2 },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected user-scoped table: ${table}`);
    },
  });
}

interface AdminTables {
  conceptMasteryExisting?: {
    mastery_mean: number;
    total_attempts: number;
    total_correct: number;
    streak_current: number;
  } | null;
  upsertResult?: { error: { message: string; code?: string } | null };
  conceptAttemptsInsertResult?: { error: { message: string; code?: string } | null };
}

function setAdmin(opts: AdminTables = {}) {
  const upsert = vi.fn().mockResolvedValue(opts.upsertResult ?? { error: null });
  const insert = vi.fn().mockResolvedValue(opts.conceptAttemptsInsertResult ?? { error: null });
  const select = vi.fn().mockReturnValue({
    eq: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: opts.conceptMasteryExisting ?? null, error: null }),
      }),
    }),
  });
  mocks.supabaseAdmin.from.mockImplementation((table: string) => {
    if (table === 'concept_mastery') return { upsert, select };
    if (table === 'concept_attempts') return { insert };
    throw new Error(`unexpected admin table: ${table}`);
  });
  return { upsert, insert };
}

const BODY_WITH_ATTEMPT = {
  attempt_id: '55555555-5555-4555-8555-555555555555',
  concept_id: '44444444-4444-4444-8444-444444444444',
  chosen_index: 0,
  correct: true,
  response_time_ms: 1200,
};

const BODY_WITHOUT_ATTEMPT = {
  concept_id: '44444444-4444-4444-8444-444444444444',
  chosen_index: 0,
  correct: true,
  response_time_ms: 1200,
};

async function postBody(body: unknown): Promise<Response> {
  return POST(
    new Request('http://localhost/api/tutor/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/tutor/answer — flag-gate gates', () => {
  it('404s when ff_tutor_v1 is OFF', async () => {
    setFlags({ tutor: false, bkt: false, bus: false, projector: false });
    setUser('user-1');

    const res = await postBody(BODY_WITHOUT_ATTEMPT);
    expect(res.status).toBe(404);
  });

  it('400s when ff_tutor_bkt_v1 ON but attempt_id is missing', async () => {
    setFlags({ tutor: true, bkt: true, bus: true, projector: true });
    setUser('user-1');

    const res = await postBody(BODY_WITHOUT_ATTEMPT);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.detail).toMatch(/attempt_id required/);
  });
});

describe('POST /api/tutor/answer — Path C v2 (all flags ON)', () => {
  it('calls RPC and returns optimistic posterior on success', async () => {
    setFlags({ tutor: true, bkt: true, bus: true, projector: true });
    setUser('user-1');
    setAdmin();
    mocks.supabaseAdmin.rpc.mockResolvedValue({
      data: [{
        attempt_sequence: 1,
        prior_mastery_mean: 0.30,
        posterior_mastery_mean: 0.693,
        event_id: 'event-1',
      }],
      error: null,
    });

    const res = await postBody(BODY_WITH_ATTEMPT);
    expect(res.status).toBe(200);
    expect(mocks.supabaseAdmin.rpc).toHaveBeenCalledWith(
      'tutor_commit_attempt',
      expect.objectContaining({
        p_attempt_id: BODY_WITH_ATTEMPT.attempt_id,
        p_concept_id: BODY_WITH_ATTEMPT.concept_id,
        p_correct: true,
        p_chosen_index: 0,
        p_response_time_ms: 1200,
        p_question_id: `${BODY_WITH_ATTEMPT.concept_id}:practice:v1`,
        p_subject_code: 'math',
        p_chapter_number: 1,
        p_idempotency_key: `tutor.answer.${BODY_WITH_ATTEMPT.attempt_id}`,
      }),
    );

    const json = await res.json();
    expect(json.optimistic).toBe(true);
    expect(json.path).toBe('c');
    expect(json.mastery.mastery_mean).toBeCloseTo(0.693, 2);
    expect(json.mastery.attempts).toBe(1);
    expect(json.mastery.mastered).toBe(false); // 0.693 < 0.85
  });

  it('marks mastered=true when optimistic posterior >= MASTERY_THRESHOLD', async () => {
    setFlags({ tutor: true, bkt: true, bus: true, projector: true });
    setUser('user-1');
    setAdmin();
    mocks.supabaseAdmin.rpc.mockResolvedValue({
      data: [{
        attempt_sequence: 2,
        prior_mastery_mean: 0.693,
        posterior_mastery_mean: 0.918,
        event_id: 'event-2',
      }],
      error: null,
    });

    const res = await postBody(BODY_WITH_ATTEMPT);
    const json = await res.json();
    expect(json.mastery.mastered).toBe(true);
  });

  it('409s on RPC UNIQUE violation (duplicate attempt_id)', async () => {
    setFlags({ tutor: true, bkt: true, bus: true, projector: true });
    setUser('user-1');
    setAdmin();
    mocks.supabaseAdmin.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'duplicate key value violates unique constraint "concept_attempts_pkey"',
        code: '23505',
      },
    });

    const res = await postBody(BODY_WITH_ATTEMPT);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('already_answered');
  });

  it('on RPC failure: inserts excluded marker, runs legacy upsert, emits PostHog fallback', async () => {
    setFlags({ tutor: true, bkt: true, bus: true, projector: true });
    setUser('user-1');
    const { upsert, insert } = setAdmin();
    mocks.supabaseAdmin.rpc.mockResolvedValue({
      data: null,
      error: { message: 'connection lost', code: 'XX000' },
    });

    const res = await postBody(BODY_WITH_ATTEMPT);
    expect(res.status).toBe(200);

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      attempt_id: BODY_WITH_ATTEMPT.attempt_id,
      status: 'excluded',
      correct: true,
      chosen_index: 0,
    }));
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith(
      'tutor_answer_path_c_fallback',
      'user-1',
      expect.objectContaining({ reason: 'rpc_error' }),
    );
    expect(mocks.loggerError).toHaveBeenCalled();

    const json = await res.json();
    expect(json.optimistic).toBe(false);
    expect(json.path).toBe('legacy');
  });
});

describe('POST /api/tutor/answer — legacy fallback paths', () => {
  it('ff_event_bus_v1 OFF: skips RPC, takes legacy path', async () => {
    setFlags({ tutor: true, bkt: true, bus: false, projector: true });
    setUser('user-1');
    const { upsert } = setAdmin();

    const res = await postBody(BODY_WITH_ATTEMPT);
    expect(res.status).toBe(200);
    expect(mocks.supabaseAdmin.rpc).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.path).toBe('legacy');
  });

  it('ff_projector_runner_v1 OFF: skips RPC, takes legacy path', async () => {
    setFlags({ tutor: true, bkt: true, bus: true, projector: false });
    setUser('user-1');
    const { upsert } = setAdmin();

    const res = await postBody(BODY_WITH_ATTEMPT);
    expect(mocks.supabaseAdmin.rpc).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.path).toBe('legacy');
  });

  it('ff_tutor_bkt_v1 OFF: Phase-0 parity — naive upsert only, no RPC, no attempt_id check', async () => {
    setFlags({ tutor: true, bkt: false, bus: true, projector: true });
    setUser('user-1');
    const { upsert, insert } = setAdmin();

    const res = await postBody(BODY_WITHOUT_ATTEMPT);
    expect(res.status).toBe(200);
    expect(mocks.supabaseAdmin.rpc).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);

    const json = await res.json();
    expect(json.optimistic).toBe(false);
    expect(json.path).toBe('legacy');
  });

  it('legacy path: streak_current=0 on wrong answer', async () => {
    setFlags({ tutor: true, bkt: false, bus: true, projector: true });
    setUser('user-1');
    const { upsert } = setAdmin({
      conceptMasteryExisting: {
        mastery_mean: 0.9,
        total_attempts: 3,
        total_correct: 3,
        streak_current: 3,
      },
    });

    const res = await postBody({ ...BODY_WITHOUT_ATTEMPT, correct: false });
    expect(res.status).toBe(200);
    const upsertCall = upsert.mock.calls[0][0];
    expect(upsertCall.streak_current).toBe(0);
    expect(upsertCall.total_correct).toBe(3);
  });

  it('500s when legacy upsert errors', async () => {
    setFlags({ tutor: true, bkt: false, bus: true, projector: true });
    setUser('user-1');
    setAdmin({ upsertResult: { error: { message: 'boom' } } });

    const res = await postBody(BODY_WITHOUT_ATTEMPT);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('mastery_write_failed');
  });
});
