/**
 * Unit tests for Pedagogy v2 weekly Curiosity Dive API routes.
 *
 * Covers:
 *   POST /api/dive/start    — resolves picker option to dive topic
 *   POST /api/dive/artifact — saves student's dive artifact
 *   GET  /api/dive/state    — returns weekly dive state for current ISO week
 *   GET  /api/dive/history  — returns past dive artifacts
 *
 * For each route:
 *   1. Unauthenticated → 401
 *   2. Feature flag off → 404
 *   3. Happy path → 200 with correct shape
 *   4. Route-specific error (400 for invalid POST body; 500 for DB errors on GETs)
 *
 * Additional for /api/dive/artifact:
 *   5. Duplicate insert (PG 23505) → 409 { error: 'already_saved_this_week' }
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (must appear before route imports) ────────────────────────

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn(),
  PEDAGOGY_V2_FLAGS: {
    WEEKLY_DIVE: 'ff_pedagogy_v2_weekly_dive',
    MONTHLY_SYNTHESIS: 'ff_pedagogy_v2_monthly_synthesis',
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// cacheFetchAsync: call through to the fetcher so dive/state tests exercise
// real buildDiveState logic with mocked Supabase responses.
vi.mock('@/lib/cache', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/cache')>();
  return {
    ...real,
    cacheFetchAsync: vi.fn(async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) =>
      fetcher(),
    ),
  };
});

// weekly-dive-orchestrator: keep isoWeekOf real; stub planWeeklyDive to a
// known deterministic output so dive/state tests don't depend on calendar.
vi.mock('@/lib/learn/weekly-dive-orchestrator', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/learn/weekly-dive-orchestrator')>();
  return {
    ...real,
    planWeeklyDive: vi.fn(() => ({
      state: 'open' as const,
      defaultPicker: 'own_topic' as const,
      showWeakTopicOption: false,
      showPhenomenonOption: false,
      showOwnTopicOption: true,
    })),
  };
});

// weekly-streak: keep real algorithm — the tests supply concrete iso_week arrays.
// No mock needed.

// ── Imports ────────────────────────────────────────────────────────────────

import { POST as startPOST } from '@/app/api/dive/start/route';
import { POST as artifactPOST } from '@/app/api/dive/artifact/route';
import { GET as stateGET } from '@/app/api/dive/state/route';
import { GET as historyGET } from '@/app/api/dive/history/route';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isFeatureEnabled } from '@/lib/feature-flags';

// ── Shared mock helpers ────────────────────────────────────────────────────

const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STUDENT_DB_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ARTIFACT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

/** Returns a Supabase-client mock whose `.from()` chain resolves to the
 *  provided result for the LAST call in the chain (.maybeSingle / .single). */
function makeChain(singleResult: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const chainMethods = ['select', 'insert', 'eq', 'order', 'limit', 'update', 'upsert'];
  for (const m of chainMethods) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve(singleResult);
  chain.single = () => Promise.resolve(singleResult);
  return chain;
}

/**
 * Returns a Supabase chain that is directly awaitable (without calling
 * .single() / .maybeSingle()). Every property access that is not a
 * Promise-protocol key (then/catch/finally) returns a function that returns
 * the PROXY itself, so the chain stays thenable through every method call:
 *   await supabase.from('t').select(...).eq(...).order(...).limit(...)
 */
function makeThenable(result: { data: unknown; error: unknown }) {
  // proxy is declared first so the closure inside `get` can reference it.
  const proxy: Record<string, unknown> = new Proxy(
    {} as Record<string, unknown>,
    {
      get(_target, prop: string | symbol) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          const p = Promise.resolve(result);
          return (p[prop as 'then'] as (...a: unknown[]) => unknown).bind(p);
        }
        // Any other method (select, eq, insert, order, limit…) returns itself
        // so subsequent calls in the chain still see the thenable proxy.
        return () => proxy;
      },
    },
  );
  return proxy;
}

/** Build a mock Supabase client where from() calls resolve via the factory. */
function buildSupabaseMock(
  fromFactory: (table: string) => Record<string, unknown>,
  rpcResult: { data: unknown; error: unknown } = { data: [], error: null },
) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => fromFactory(table)),
    rpc: vi.fn().mockResolvedValue(rpcResult),
  };
}

/** Auth error mock — simulates expired/missing session. */
function buildUnauthMock() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: { message: 'JWT expired' },
      }),
    },
    from: vi.fn(),
    rpc: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: authenticated, flag on.
  (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
    buildSupabaseMock(() => makeChain({ data: null, error: null })),
  );
  (isFeatureEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/dive/start
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/dive/start', () => {
  function req(body: unknown) {
    return new Request('http://localhost/api/dive/start', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('returns 401 when unauthenticated', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildUnauthMock(),
    );
    const res = await startPOST(req({ pickerOption: 'own_topic', ownTopic: 'Gravity' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthenticated');
  });

  it('returns 404 when feature flag is off', async () => {
    (isFeatureEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await startPOST(req({ pickerOption: 'own_topic', ownTopic: 'Gravity' }));
    expect(res.status).toBe(404);
  });

  it('happy path own_topic: returns diveTopic, empty diveSubjects, null phenomenonSlug', async () => {
    const res = await startPOST(req({ pickerOption: 'own_topic', ownTopic: 'Black Holes' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.diveTopic).toBe('Black Holes');
    expect(body.diveSubjects).toEqual([]);
    expect(body.phenomenonSlug).toBeNull();
  });

  it('happy path phenomenon: resolves title and subjects from phenomena table', async () => {
    const phenomenonRow = {
      slug: 'why-sky-is-blue',
      title_en: 'Why is the Sky Blue?',
      subjects: ['physics', 'chemistry'],
    };
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildSupabaseMock(() => makeChain({ data: phenomenonRow, error: null })),
    );
    const res = await startPOST(
      req({ pickerOption: 'phenomenon', phenomenonSlug: 'why-sky-is-blue' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.diveTopic).toBe('Why is the Sky Blue?');
    expect(body.diveSubjects).toEqual(['physics', 'chemistry']);
    expect(body.phenomenonSlug).toBe('why-sky-is-blue');
  });

  it('phenomenon not found → 404', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildSupabaseMock(() => makeChain({ data: null, error: null })),
    );
    const res = await startPOST(
      req({ pickerOption: 'phenomenon', phenomenonSlug: 'nonexistent-slug' }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('phenomenon_not_found');
  });

  it('happy path weak_topic: resolves topic title from get_due_reviews RPC', async () => {
    const dueRows = [
      { topic_id: 'topic-abc', title: 'Newton Laws', subject_code: 'physics', mastery_probability: 0.3 },
    ];
    const mock = buildSupabaseMock(
      (table) => makeChain(table === 'students' ? { data: { id: STUDENT_DB_ID }, error: null } : { data: null, error: null }),
      { data: dueRows, error: null },
    );
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const res = await startPOST(
      req({ pickerOption: 'weak_topic', weakTopicId: 'topic-abc' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.diveTopic).toBe('Newton Laws');
    expect(body.diveSubjects).toEqual(['physics']);
    expect(body.phenomenonSlug).toBeNull();
  });

  it('returns 400 for missing pickerOption (invalid body)', async () => {
    const res = await startPOST(req({ foo: 'bar' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_picker_payload');
  });

  it('returns 400 for own_topic with empty string', async () => {
    const res = await startPOST(req({ pickerOption: 'own_topic', ownTopic: '   ' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const badReq = new Request('http://localhost/api/dive/start', {
      method: 'POST',
      body: '{not-json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await startPOST(badReq);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/dive/artifact
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/dive/artifact', () => {
  const VALID_BODY = {
    pickerOption: 'own_topic',
    diveTopic: 'Black Holes',
    diveSubjects: [],
    phenomenonSlug: null,
    title: 'My Dive on Black Holes',
    keyConcepts: ['event horizon', 'singularity'],
    studentVoice: 'I learned that black holes bend spacetime.',
  };

  function req(body: unknown) {
    return new Request('http://localhost/api/dive/artifact', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Build a mock that handles the three sequential from() calls the artifact
   *  route makes: students → dive_artifacts(insert) → dive_artifacts(streak). */
  function buildArtifactMock(insertResult: { data: unknown; error: unknown }) {
    let diveArtifactCallCount = 0;
    return buildSupabaseMock((table) => {
      if (table === 'students') {
        return makeChain({ data: { id: STUDENT_DB_ID }, error: null });
      }
      if (table === 'dive_artifacts') {
        diveArtifactCallCount++;
        if (diveArtifactCallCount === 1) {
          // Insert chain — final call is .insert().select('id').single()
          // makeChain is sufficient: .single() explicitly returns a Promise.
          return makeChain(insertResult);
        }
        // Second call = streak history read, awaited directly (no .single()).
        // Must be a Proxy that remains thenable through every chained method.
        return makeThenable({ data: [{ iso_week: '2026-W27' }], error: null });
      }
      return makeChain({ data: null, error: null });
    });
  }

  it('returns 401 when unauthenticated', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildUnauthMock(),
    );
    const res = await artifactPOST(req(VALID_BODY));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthenticated');
  });

  it('returns 404 when feature flag is off', async () => {
    (isFeatureEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await artifactPOST(req(VALID_BODY));
    expect(res.status).toBe(404);
  });

  it('happy path: returns artifactId, weeklyStreakCount, isoWeek', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildArtifactMock({ data: { id: ARTIFACT_ID }, error: null }),
    );
    const res = await artifactPOST(req(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifactId).toBe(ARTIFACT_ID);
    expect(typeof body.weeklyStreakCount).toBe('number');
    expect(body.weeklyStreakCount).toBeGreaterThanOrEqual(1);
    expect(typeof body.isoWeek).toBe('string');
    expect(body.isoWeek).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('returns 400 when title is missing', async () => {
    const res = await artifactPOST(req({ ...VALID_BODY, title: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_title');
  });

  it('returns 400 when studentVoice is missing', async () => {
    const res = await artifactPOST(req({ ...VALID_BODY, studentVoice: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_student_voice');
  });

  it('returns 400 for invalid pickerOption', async () => {
    const res = await artifactPOST(req({ ...VALID_BODY, pickerOption: 'invalid_option' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_picker_option');
  });

  it('returns 400 for malformed JSON', async () => {
    const badReq = new Request('http://localhost/api/dive/artifact', {
      method: 'POST',
      body: '{bad json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await artifactPOST(badReq);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
  });

  it('returns 404 when student profile is missing', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildSupabaseMock(() => makeChain({ data: null, error: null })),
    );
    const res = await artifactPOST(req(VALID_BODY));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('student_profile_not_found');
  });

  it('returns 409 with already_saved_this_week on duplicate insert (PG 23505)', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildArtifactMock({ data: null, error: { code: '23505', message: 'unique violation' } }),
    );
    const res = await artifactPOST(req(VALID_BODY));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('already_saved_this_week');
  });

  it('returns 500 on unexpected DB insert error', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildArtifactMock({ data: null, error: { code: '42P01', message: 'relation does not exist' } }),
    );
    const res = await artifactPOST(req(VALID_BODY));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('artifact_save_failed');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/dive/state
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/dive/state', () => {
  function req() {
    return new Request('http://localhost/api/dive/state', { method: 'GET' });
  }

  /** Build a mock covering all three from() tables the state route reads:
   *  students, dive_artifacts, phenomena. The rpc mock handles get_due_reviews. */
  function buildStateMock(opts: {
    studentRow?: { id: string; grade: string; academic_goal: string | null } | null;
    artifactRows?: Array<{ iso_week: string }>;
    phenomenaRows?: Array<Record<string, unknown>>;
    rpcRows?: Array<Record<string, unknown>>;
    artifactErr?: { message: string } | null;
    studentErr?: { message: string } | null;
  } = {}) {
    const {
      studentRow = { id: STUDENT_DB_ID, grade: '9', academic_goal: null },
      artifactRows = [],
      phenomenaRows = [],
      rpcRows = [],
      artifactErr = null,
      studentErr = null,
    } = opts;

    return buildSupabaseMock((table) => {
      if (table === 'students') {
        // Final call is .maybeSingle() — makeChain handles it.
        return makeChain({ data: studentRow, error: studentErr });
      }
      if (table === 'dive_artifacts') {
        // Route awaits the chain directly: .select().eq().order().limit()
        // makeThenable keeps the proxy through every method call.
        return makeThenable({ data: artifactRows, error: artifactErr });
      }
      if (table === 'phenomena') {
        // Same pattern: awaited directly after .select().eq().order().limit()
        return makeThenable({ data: phenomenaRows, error: null });
      }
      return makeChain({ data: null, error: null });
    }, { data: rpcRows, error: null });
  }

  it('returns 401 when unauthenticated', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildUnauthMock(),
    );
    const res = await stateGET(req());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthenticated');
  });

  it('returns 404 when feature flag is off', async () => {
    (isFeatureEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await stateGET(req());
    expect(res.status).toBe(404);
  });

  it('happy path: returns state open, currentIsoWeek, weeklyStreakCount 0, and picker plan', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildStateMock({ artifactRows: [] }),
    );
    const res = await stateGET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe('open');
    expect(typeof body.currentIsoWeek).toBe('string');
    expect(body.currentIsoWeek).toMatch(/^\d{4}-W\d{2}$/);
    expect(body.weeklyStreakCount).toBe(0);
    expect(typeof body.defaultPicker).toBe('string');
    expect(typeof body.showOwnTopicOption).toBe('boolean');
    expect(Array.isArray(body.eligiblePhenomena)).toBe(true);
    expect(Array.isArray(body.weakTopics)).toBe(true);
  });

  it('state is completed when artifact exists for current ISO week', async () => {
    // The route computes currentIsoWeek via isoWeekOf(new Date()).
    // We need to supply an artifact for that same week. Since isoWeekOf is real,
    // compute it here as well.
    const { isoWeekOf } = await import('@/lib/learn/weekly-dive-orchestrator');
    const thisWeek = isoWeekOf(new Date());
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildStateMock({ artifactRows: [{ iso_week: thisWeek }] }),
    );
    const res = await stateGET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe('completed');
    expect(body.lastCompletedIsoWeek).toBe(thisWeek);
  });

  it('missing student profile: degrades gracefully → state open, streak 0, empty data', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildStateMock({ studentRow: null }),
    );
    const res = await stateGET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe('open');
    expect(body.weeklyStreakCount).toBe(0);
    expect(body.weakTopics).toEqual([]);
  });

  it('sets Cache-Control: private on response', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildStateMock(),
    );
    const res = await stateGET(req());
    expect(res.headers.get('Cache-Control')).toContain('private');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/dive/history
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/dive/history', () => {
  function req(limit?: number) {
    const url = limit
      ? `http://localhost/api/dive/history?limit=${limit}`
      : 'http://localhost/api/dive/history';
    return new Request(url, { method: 'GET' });
  }

  const ARTIFACT_ROW = {
    id: ARTIFACT_ID,
    iso_week: '2026-W26',
    picker_option: 'own_topic',
    dive_topic: 'Black Holes',
    dive_subjects: [],
    phenomenon_slug: null,
    title: 'My Dive',
    created_at: '2026-06-29T10:00:00Z',
  };

  /** Build a mock for the history route: students → dive_artifacts(select). */
  function buildHistoryMock(opts: {
    studentRow?: { id: string } | null;
    artifactRows?: Array<Record<string, unknown>>;
    artifactErr?: { message: string } | null;
  } = {}) {
    const {
      studentRow = { id: STUDENT_DB_ID },
      artifactRows = [ARTIFACT_ROW],
      artifactErr = null,
    } = opts;

    return buildSupabaseMock((table) => {
      if (table === 'students') {
        // Final call is .maybeSingle() — makeChain handles it.
        return makeChain({ data: studentRow, error: null });
      }
      if (table === 'dive_artifacts') {
        // Route awaits the full chain directly: .select(...).eq(...).order(...).limit(...)
        // makeThenable keeps the proxy thenable through every chained method call.
        return makeThenable({
          data: artifactErr ? null : artifactRows,
          error: artifactErr,
        });
      }
      return makeChain({ data: null, error: null });
    });
  }

  it('returns 401 when unauthenticated', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildUnauthMock(),
    );
    const res = await historyGET(req());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthenticated');
  });

  it('returns 404 when feature flag is off', async () => {
    (isFeatureEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await historyGET(req());
    expect(res.status).toBe(404);
  });

  it('happy path: returns artifacts array with camelCase keys', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildHistoryMock(),
    );
    const res = await historyGET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.artifacts)).toBe(true);
    expect(body.artifacts).toHaveLength(1);
    const a = body.artifacts[0];
    expect(a.id).toBe(ARTIFACT_ID);
    expect(a.isoWeek).toBe('2026-W26');
    expect(a.pickerOption).toBe('own_topic');
    expect(a.diveTopic).toBe('Black Holes');
    expect(a.title).toBe('My Dive');
    // Verify snake_case keys are NOT present.
    expect(a.iso_week).toBeUndefined();
    expect(a.picker_option).toBeUndefined();
  });

  it('missing student profile: returns empty artifacts array (not 500)', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildHistoryMock({ studentRow: null }),
    );
    const res = await historyGET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifacts).toEqual([]);
  });

  it('DB error on dive_artifacts fetch → 500', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildHistoryMock({ artifactErr: { message: 'connection refused' } }),
    );
    const res = await historyGET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('history_fetch_failed');
  });

  it('sets Cache-Control: private on response', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildHistoryMock(),
    );
    const res = await historyGET(req());
    expect(res.headers.get('Cache-Control')).toContain('private');
  });

  /**
   * Builds a mock whose `dive_artifacts` chain instruments the actual value
   * passed to `.limit()` so tests can assert on it directly, instead of
   * merely checking that the table was touched (which proves nothing about
   * the limit value the route actually computed).
   */
  function buildHistoryMockCapturingLimit(
    artifactRows: Array<Record<string, unknown>> = [ARTIFACT_ROW],
  ) {
    const limitSpy = vi.fn();
    const mock = buildSupabaseMock((table) => {
      if (table === 'students') {
        return makeChain({ data: { id: STUDENT_DB_ID }, error: null });
      }
      if (table === 'dive_artifacts') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: (n: number) => {
                  limitSpy(n);
                  return Promise.resolve({ data: artifactRows, error: null });
                },
              }),
            }),
          }),
        };
      }
      return makeChain({ data: null, error: null });
    });
    return { mock, limitSpy };
  }

  it('defaults limit to 20 when no ?limit query param is provided', async () => {
    const { mock, limitSpy } = buildHistoryMockCapturingLimit();
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const res = await historyGET(req());
    expect(res.status).toBe(200);
    expect(limitSpy).toHaveBeenCalledWith(20);
  });

  it('passes an explicit ?limit=5 straight through to .limit()', async () => {
    const { mock, limitSpy } = buildHistoryMockCapturingLimit();
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const res = await historyGET(req(5));
    expect(res.status).toBe(200);
    expect(limitSpy).toHaveBeenCalledWith(5);
  });

  it('falls back to the default (20) — NOT clamped to 60 — when ?limit exceeds the max', async () => {
    // The route's actual behavior (src/app/api/dive/history/route.ts): a
    // limit outside (0, MAX_LIMIT] is rejected wholesale and DEFAULT_LIMIT
    // is used instead. It does NOT clamp down to MAX_LIMIT. This test name
    // and assertion match that real behavior — do not "fix" this to expect
    // 60 without confirming the route was intentionally changed to clamp.
    const { mock, limitSpy } = buildHistoryMockCapturingLimit();
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const res = await historyGET(req(100));
    expect(res.status).toBe(200);
    expect(limitSpy).toHaveBeenCalledWith(20);
    expect(limitSpy).not.toHaveBeenCalledWith(60);
    expect(limitSpy).not.toHaveBeenCalledWith(100);
  });

  it('P13: unauthenticated denial response contains no PII keys', async () => {
    (createSupabaseServerClient as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildUnauthMock(),
    );
    const res = await historyGET(req());
    expect(res.status).toBe(401);
    const body = await res.json();
    const raw = JSON.stringify(body).toLowerCase();
    expect(raw).not.toMatch(/email/);
    expect(raw).not.toMatch(/phone/);
    expect(raw).not.toMatch(/"name"/);
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('phone');
    expect(body).not.toHaveProperty('name');
  });
});
