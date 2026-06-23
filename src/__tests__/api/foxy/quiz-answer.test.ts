import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POST /api/foxy/quiz-answer — PART B1 grade-endpoint CONTRACT (integrity-critical).
 *
 * This is the ONLY chat-side path that moves mastery, and it must do so ONLY
 * through the SERVER-ISSUED served item + tutor_commit_attempt (the sanctioned
 * BKT pipeline). The behavioral wall this suite pins:
 *
 *   - served-item not found / not this student   → 404 served_item_not_found
 *   - already-answered served item               → 409 already_answered
 *   - duplicate attempt_id (claim lost the race) → 409 already_answered
 *   - response_time_ms < 3000 (P3 anti-cheat)    → 422 too_fast, NO DB work
 *   - concept unresolvable at grade time          → 422 not_evidential
 *   - mastery pipeline flags OFF                   → 422 not_evidential
 *   - ZERO XP: never calls atomic_quiz_profile_update; xp_earned:0 on success
 *   - grades against the SERVER-HELD correct_index, never a client claim
 *
 * Mocking strategy (testing-agent rule 2 — mock the Supabase clients, not the
 * business logic): we mock @/lib/supabase-server (RLS read of students) and
 * @/lib/supabase-admin (served-item lookup + claim UPDATE + tutor_commit_attempt
 * RPC), plus the feature-flag gate. We record every .rpc(name) so we can assert
 * tutor_commit_attempt fires (and atomic_quiz_profile_update never does).
 */

// Valid v4 UUIDs (zod .uuid() validates the version + variant nibbles).
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SERVED_ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONCEPT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ATTEMPT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

// ── feature flags ─────────────────────────────────────────────────────────────
const _isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));
function setAllFlagsOn() {
  _isFeatureEnabled.mockResolvedValue(true);
}

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/posthog/server', () => ({ capture: vi.fn().mockResolvedValue(undefined) }));

// ── supabase-server: RLS auth + students row ──────────────────────────────────
let _user: { user: { id: string } | null };
let _studentRow: { data: unknown };
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: vi.fn(() => Promise.resolve({ data: _user })) },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve(_studentRow)) })),
        })),
      })),
    }),
  ),
}));

// ── supabaseAdmin: served-item read, claim, concept read, RPC ─────────────────
let _servedItem: { data: unknown; error: unknown };
let _conceptRow: { data: unknown; error: unknown };
let _claimRows: { data: unknown; error: unknown };
let _rpcResult: { data: unknown; error: unknown };
let rpcCalls: Array<{ name: string; args: unknown }> = [];

// Track which served-item op we're in: the FIRST .from('foxy_served_items') is
// the read (select→eq→eq→maybeSingle); the SECOND is the claim (update→eq→eq→is→select).
function makeAdminChain(table: string) {
  if (table === 'foxy_served_items') {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() => Promise.resolve(_servedItem));
    // The claim path: .update(...).eq().eq().is().select() resolves to claimRows.
    chain.update = vi.fn(() => {
      const claimChain: Record<string, unknown> = {};
      claimChain.eq = vi.fn(() => claimChain);
      claimChain.is = vi.fn(() => claimChain);
      claimChain.select = vi.fn(() => Promise.resolve(_claimRows));
      // release path (.update().eq().eq()) resolves to a thenable
      (claimChain as { then?: unknown }).then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(res);
      return claimChain;
    });
    return chain;
  }
  if (table === 'chapter_concepts') {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() => Promise.resolve(_conceptRow));
    return chain;
  }
  const generic: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is']) generic[m] = vi.fn(() => generic);
  generic.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return generic;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => makeAdminChain(table)),
    rpc: vi.fn((name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(_rpcResult);
    }),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: any;

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/foxy/quiz-answer', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function validBody(over: Record<string, unknown> = {}) {
  return {
    served_item_id: SERVED_ITEM_ID,
    chosen_index: 1,
    attempt_id: ATTEMPT_ID,
    response_time_ms: 8000,
    ...over,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  rpcCalls = [];
  setAllFlagsOn();
  _user = { user: { id: USER_ID } };
  _studentRow = { data: { id: STUDENT_ID } };
  // Default served item: unanswered, correct_index = 1 (so chosen_index 1 = correct).
  _servedItem = {
    data: {
      id: SERVED_ITEM_ID,
      session_id: 's-1',
      student_id: STUDENT_ID,
      concept_id: CONCEPT_ID,
      question_id: `${CONCEPT_ID}:evidential:v1`,
      correct_index: 1,
      answered_at: null,
    },
    error: null,
  };
  _conceptRow = {
    data: { id: CONCEPT_ID, subject: 'science', chapter_number: 4, difficulty: 2 },
    error: null,
  };
  _claimRows = { data: [{ id: SERVED_ITEM_ID }], error: null }; // claim succeeds
  _rpcResult = { data: [{ posterior_mastery_mean: 0.62, attempt_sequence: 3 }], error: null };
  const mod = await import('@/app/api/foxy/quiz-answer/route');
  POST = mod.POST;
});

describe('POST /api/foxy/quiz-answer — auth + flag gating', () => {
  it('401 when unauthenticated', async () => {
    _user = { user: null };
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(401);
  });

  it('404 not_found when the tutor flag is OFF (endpoint does not exist)', async () => {
    _isFeatureEnabled.mockImplementation((flag: string) =>
      Promise.resolve(flag !== 'ff_tutor_v1'),
    );
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not_found');
  });

  it('422 not_evidential when a downstream pipeline flag is OFF (no naive mastery write)', async () => {
    _isFeatureEnabled.mockImplementation((flag: string) =>
      Promise.resolve(flag !== 'ff_tutor_bkt_v1'),
    );
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('not_evidential');
    // Never committed.
    expect(rpcCalls.find((c) => c.name === 'tutor_commit_attempt')).toBeUndefined();
  });
});

describe('POST /api/foxy/quiz-answer — P3 anti-cheat (too_fast)', () => {
  it('422 too_fast when response_time_ms < 3000, BEFORE any served-item DB read', async () => {
    const res = await POST(makeReq(validBody({ response_time_ms: 1500 })));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('too_fast');
    // No grading work happened.
    expect(rpcCalls.find((c) => c.name === 'tutor_commit_attempt')).toBeUndefined();
  });

  it('exactly 3000ms is accepted (boundary, not below the floor)', async () => {
    const res = await POST(makeReq(validBody({ response_time_ms: 3000 })));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/foxy/quiz-answer — served-item verification (anti mastery-injection)', () => {
  it('404 served_item_not_found when the row is missing / belongs to another student', async () => {
    _servedItem = { data: null, error: null };
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('served_item_not_found');
    expect(rpcCalls.find((c) => c.name === 'tutor_commit_attempt')).toBeUndefined();
  });

  it('409 already_answered when the served item is already stamped', async () => {
    _servedItem = {
      data: { ...(_servedItem.data as object), answered_at: '2026-06-23T10:00:00.000Z' },
      error: null,
    };
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('already_answered');
    expect(rpcCalls.find((c) => c.name === 'tutor_commit_attempt')).toBeUndefined();
  });

  it('409 already_answered when the atomic CLAIM finds the row already taken (race)', async () => {
    _claimRows = { data: [], error: null }; // conditional UPDATE matched 0 rows
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('already_answered');
    // Lost the claim race → never commits.
    expect(rpcCalls.find((c) => c.name === 'tutor_commit_attempt')).toBeUndefined();
  });

  it('409 already_answered when tutor_commit_attempt returns a 23505 duplicate', async () => {
    _rpcResult = { data: null, error: { code: '23505', message: 'duplicate key' } };
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('already_answered');
  });

  it('422 not_evidential when the concept row vanished between serve and grade', async () => {
    _conceptRow = { data: null, error: null };
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('not_evidential');
    expect(rpcCalls.find((c) => c.name === 'tutor_commit_attempt')).toBeUndefined();
  });
});

describe('POST /api/foxy/quiz-answer — valid evidential commit (XP + grading contract)', () => {
  it('commits through tutor_commit_attempt and NEVER calls atomic_quiz_profile_update', async () => {
    const res = await POST(makeReq(validBody()));
    expect(res.status).toBe(200);
    expect(rpcCalls.find((c) => c.name === 'tutor_commit_attempt')).toBeTruthy();
    // ZERO XP: the quiz-XP authority RPC is never invoked from this path.
    expect(rpcCalls.find((c) => c.name === 'atomic_quiz_profile_update')).toBeUndefined();
  });

  it('awards 0 XP on the wire (xp_earned: 0) and reports mastery from the RPC posterior', async () => {
    const res = await POST(makeReq(validBody()));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.evidential).toBe(true);
    expect(body.xp_earned).toBe(0);
    expect(body.mastery.mastery_mean).toBe(0.62);
    expect(body.mastery.attempts).toBe(3);
    // mastered flag is posterior >= MASTERY_THRESHOLD (0.85); 0.62 < 0.85 → false.
    expect(body.mastery.mastered).toBe(false);
  });

  it('grades against the SERVER-HELD correct_index, not a client claim', async () => {
    // correct_index is 1 on the served item; pick 1 → correct.
    const correctRes = await POST(makeReq(validBody({ chosen_index: 1 })));
    const correctBody = await correctRes.json();
    expect(correctBody.correct).toBe(true);
    expect(correctBody.correct_index).toBe(1);
    let commit = rpcCalls.find((c) => c.name === 'tutor_commit_attempt');
    expect((commit!.args as { p_correct: boolean }).p_correct).toBe(true);

    // Reset call log; pick 0 → wrong (against server key 1) regardless of any
    // client-supplied "correct" field, which the schema does not even accept.
    rpcCalls = [];
    const wrongRes = await POST(makeReq(validBody({ chosen_index: 0 })));
    const wrongBody = await wrongRes.json();
    expect(wrongBody.correct).toBe(false);
    commit = rpcCalls.find((c) => c.name === 'tutor_commit_attempt');
    expect((commit!.args as { p_correct: boolean }).p_correct).toBe(false);
  });

  it('400 bad_request for a malformed body (chosen_index out of 0..3)', async () => {
    const res = await POST(makeReq(validBody({ chosen_index: 9 })));
    expect(res.status).toBe(400);
  });
});
