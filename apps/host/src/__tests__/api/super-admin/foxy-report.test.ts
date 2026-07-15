/**
 * GET /api/super-admin/foxy-report/[studentId] — unit tests.
 *
 * Pins the contract for the read-only Foxy Learning Report route:
 *   - 401 / 403 auth gate via authorizeRequest('super_admin.access') (no new perm)
 *   - 400 on a non-UUID studentId (no table reads)
 *   - 404 when the student doesn't exist
 *   - 200 { success, data } shape on the happy path
 *   - dark ledger (state_events empty OR errored) degrades cleanly — never 500s
 *   - P13: the free-text student_misconceptions columns are NEVER selected
 *
 * Mocking pattern mirrors src/__tests__/api/super-admin/alfabot-stats.test.ts —
 * a chainable Supabase mock branching by table name, results set per test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── rbac mock ──────────────────────────────────────────────────────────────
const mockAuthorizeRequest = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => mockAuthorizeRequest(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── supabaseAdmin mock ───────────────────────────────────────────────────────
const tableResults: Record<string, { data?: unknown; error?: unknown; count?: number | null }> = {};
let fromCallsByTable: Record<string, number> = {};
let selectArgsByTable: Record<string, string[]> = {};

function resetTables() {
  for (const k of Object.keys(tableResults)) delete tableResults[k];
  fromCallsByTable = {};
  selectArgsByTable = {};
  // Sensible defaults: a valid student, everything else empty.
  tableResults.students = { data: { grade: '8', auth_user_id: 'auth-1' }, error: null };
  tableResults.foxy_sessions = { data: [], error: null };
  tableResults.foxy_served_items = { data: [], error: null };
  tableResults.concept_mastery = { data: [], error: null };
  tableResults.concept_attempts = { data: [], error: null };
  tableResults.student_misconceptions = { data: [], error: null };
  tableResults.foxy_chat_messages = { count: 0, data: null, error: null };
  tableResults.state_events = { data: [], error: null };
  tableResults.chapter_concepts = { data: [], error: null };
  tableResults.question_misconceptions = { data: [], error: null };
}

function makeChain(table: string) {
  const result = () => tableResults[table] ?? { data: [], error: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  chain.select = vi.fn((cols?: string) => {
    if (typeof cols === 'string') {
      selectArgsByTable[table] = [...(selectArgsByTable[table] ?? []), cols];
    }
    return chain;
  });
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.gte = vi.fn(() => chain);
  chain.lte = vi.fn(() => chain);
  chain.lt = vi.fn(() => chain);
  chain.not = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve(result()));
  chain.single = vi.fn(() => Promise.resolve(result()));
  chain.then = (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      fromCallsByTable[table] = (fromCallsByTable[table] ?? 0) + 1;
      return makeChain(table);
    }),
  },
}));

// ─── Auth helpers ─────────────────────────────────────────────────────────────
const AUTH_OK = {
  authorized: true as const,
  userId: 'admin-1',
  studentId: null,
  roles: ['super_admin'],
  permissions: ['super_admin.access'],
};

const AUTH_DENIED = (status: number) => ({
  authorized: false as const,
  userId: status === 403 ? 'student-1' : null,
  studentId: null,
  roles: [],
  permissions: [],
  errorResponse: new Response(JSON.stringify({ error: 'denied' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
});

const VALID_STUDENT_ID = '11111111-1111-1111-1111-111111111111';

function buildRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/super-admin/foxy-report/${VALID_STUDENT_ID}`,
  );
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ studentId: id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTables();
});

// ─── Auth gate ────────────────────────────────────────────────────────────────

describe('GET /api/super-admin/foxy-report: auth', () => {
  it('returns 401 when unauthorized, without reading any table', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED(401));
    const { GET } = await import('@/app/api/super-admin/foxy-report/[studentId]/route');
    const res = await GET(buildRequest(), paramsFor(VALID_STUDENT_ID));
    expect(res.status).toBe(401);
    expect(fromCallsByTable.students ?? 0).toBe(0);
  });

  it('returns 403 when authenticated but not an admin', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED(403));
    const { GET } = await import('@/app/api/super-admin/foxy-report/[studentId]/route');
    const res = await GET(buildRequest(), paramsFor(VALID_STUDENT_ID));
    expect(res.status).toBe(403);
    expect(fromCallsByTable.students ?? 0).toBe(0);
  });

  it('checks the existing super_admin.access permission (not a new perm code)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/foxy-report/[studentId]/route');
    await GET(buildRequest(), paramsFor(VALID_STUDENT_ID));
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(expect.anything(), 'super_admin.access');
  });
});

// ─── Input validation ─────────────────────────────────────────────────────────

describe('GET /api/super-admin/foxy-report: validation', () => {
  it('returns 400 on a non-UUID studentId, without reading any table', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/foxy-report/[studentId]/route');
    const res = await GET(buildRequest(), paramsFor('not-a-uuid'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(fromCallsByTable.students ?? 0).toBe(0);
  });

  it('returns 404 when the student does not exist', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    tableResults.students = { data: null, error: null };
    const { GET } = await import('@/app/api/super-admin/foxy-report/[studentId]/route');
    const res = await GET(buildRequest(), paramsFor(VALID_STUDENT_ID));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});

// ─── Happy path shape ─────────────────────────────────────────────────────────

describe('GET /api/super-admin/foxy-report: happy path', () => {
  it('200 { success, data } with all report sections when everything is empty', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/foxy-report/[studentId]/route');
    const res = await GET(buildRequest(), paramsFor(VALID_STUDENT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.studentId).toBe(VALID_STUDENT_ID);
    expect(body.data.grade).toBe('8'); // P5 string passthrough
    expect(body.data.ledgerAvailable).toBe(false);
    expect(body.data.engagement.sessionCount).toBe(0);
    expect(body.data.evidentialPractice.accuracyPct).toBeNull();
    expect(body.data.masteryMovement.conceptsPracticed).toBe(0);
    expect(body.data.misconceptions.total).toBe(0);
    expect(body.data.lessonProgress).toBeNull();
    expect(body.data.struggleSignals.available).toBe(false);
    expect(typeof body.data.generatedAt).toBe('string');
    // Private cache header is set.
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=30');
  });

  it('wires the live evidential rows into the report', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const CONCEPT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const ATTEMPT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    tableResults.foxy_sessions = {
      data: [
        {
          id: 'sess-1',
          subject: 'Science',
          grade: '8',
          chapter: 'Force and Pressure',
          mode: 'learn',
          last_active_at: '2026-07-15T11:00:00.000Z',
          created_at: '2026-07-15T10:00:00.000Z',
          lesson_step: 'active_recall',
          lesson_objective_concept_id: CONCEPT,
        },
      ],
      error: null,
    };
    tableResults.foxy_served_items = {
      data: [
        {
          id: 'si-1',
          session_id: 'sess-1',
          concept_id: CONCEPT,
          question_id: `${CONCEPT}:evidential:v1`,
          served_at: '2026-07-15T11:05:00.000Z',
          answered_at: '2026-07-15T11:06:00.000Z',
          attempt_id: ATTEMPT,
        },
      ],
      error: null,
    };
    tableResults.concept_attempts = {
      data: [
        {
          attempt_id: ATTEMPT,
          concept_id: CONCEPT,
          correct: true,
          answered_at: '2026-07-15T11:06:00.000Z',
          prior_mastery_mean: 0.4,
          posterior_mastery_mean: 0.6,
        },
      ],
      error: null,
    };
    tableResults.concept_mastery = {
      data: [
        {
          concept_id: CONCEPT,
          mastery_mean: 0.6,
          mastery_probability: 0.55,
          mastery_level: 'developing',
          updated_at: '2026-07-15T11:06:30.000Z',
        },
      ],
      error: null,
    };
    tableResults.chapter_concepts = {
      data: [{ id: CONCEPT, title: 'Pressure in liquids', chapter_number: 11, subject: 'Science' }],
      error: null,
    };
    tableResults.foxy_chat_messages = { count: 9, data: null, error: null };

    const { GET } = await import('@/app/api/super-admin/foxy-report/[studentId]/route');
    const res = await GET(buildRequest(), paramsFor(VALID_STUDENT_ID));
    const body = await res.json();

    expect(body.data.engagement.sessionCount).toBe(1);
    expect(body.data.engagement.turnCount).toBe(9);
    expect(body.data.engagement.subjects).toEqual(['Science']);
    expect(body.data.evidentialPractice).toEqual({
      served: 1,
      answered: 1,
      correct: 1,
      accuracyPct: 100,
    });
    expect(body.data.masteryMovement.conceptsPracticed).toBe(1);
    expect(body.data.masteryMovement.concepts[0].conceptName).toBe('Pressure in liquids');
    expect(body.data.masteryMovement.concepts[0].band).toBe('mid');
    expect(body.data.masteryMovement.concepts[0].recentDelta).toBeCloseTo(0.2, 5);
    expect(body.data.lessonProgress.lessonStep).toBe('active_recall');
    expect(body.data.lessonProgress.objectiveConceptName).toBe('Pressure in liquids');
  });
});

// ─── Ledger enrichment + degradation ─────────────────────────────────────────

describe('GET /api/super-admin/foxy-report: event ledger', () => {
  it('enriches struggle + misconceptions when the ledger is lit', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    tableResults.state_events = {
      data: [
        {
          kind: 'learner.struggle_observed',
          occurred_at: '2026-07-15T11:11:00.000Z',
          payload: { signalType: 'repeated_wrong', conceptId: null },
        },
        {
          kind: 'learner.turn_classified',
          occurred_at: '2026-07-15T11:12:00.000Z',
          payload: { misconceptionCode: 'off_by_one', struggleSignal: 'explicit_confusion' },
        },
      ],
      error: null,
    };
    const { GET } = await import('@/app/api/super-admin/foxy-report/[studentId]/route');
    const res = await GET(buildRequest(), paramsFor(VALID_STUDENT_ID));
    const body = await res.json();

    expect(body.data.ledgerAvailable).toBe(true);
    expect(body.data.struggleSignals.available).toBe(true);
    const signals = body.data.struggleSignals.signals.map((s: { signal: string }) => s.signal);
    expect(signals).toContain('repeated_wrong');
    expect(signals).toContain('explicit_confusion');
    const codes = body.data.misconceptions.items.map((i: { code: string }) => i.code);
    expect(codes).toContain('off_by_one');
  });

  it('degrades cleanly (200) when the ledger table errors (dark bus, e.g. 42P01)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    tableResults.state_events = { data: null, error: { code: '42P01', message: 'missing' } };
    const { GET } = await import('@/app/api/super-admin/foxy-report/[studentId]/route');
    const res = await GET(buildRequest(), paramsFor(VALID_STUDENT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.ledgerAvailable).toBe(false);
    expect(body.data.struggleSignals.available).toBe(false);
  });

  it('skips the ledger read entirely when the student has no auth_user_id', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    tableResults.students = { data: { grade: '7', auth_user_id: null }, error: null };
    const { GET } = await import('@/app/api/super-admin/foxy-report/[studentId]/route');
    const res = await GET(buildRequest(), paramsFor(VALID_STUDENT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.grade).toBe('7');
    expect(fromCallsByTable.state_events ?? 0).toBe(0);
  });
});

// ─── P13 ──────────────────────────────────────────────────────────────────────

describe('GET /api/super-admin/foxy-report: P13 privacy', () => {
  it('never selects the free-text student_misconceptions columns', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/foxy-report/[studentId]/route');
    await GET(buildRequest(), paramsFor(VALID_STUDENT_ID));
    const selects = (selectArgsByTable.student_misconceptions ?? []).join(' ');
    expect(selects).not.toMatch(/question_text/);
    expect(selects).not.toMatch(/student_answer/);
    expect(selects).not.toMatch(/correct_answer/);
    // It DOES select the code/status columns it needs.
    expect(selects).toMatch(/pattern_code/);
  });

  it('response body carries no PII-shaped keys', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { GET } = await import('@/app/api/super-admin/foxy-report/[studentId]/route');
    const res = await GET(buildRequest(), paramsFor(VALID_STUDENT_ID));
    const body = await res.json();
    const flat = JSON.stringify(body);
    expect(flat).not.toMatch(/"email"\s*:/);
    expect(flat).not.toMatch(/"phone"\s*:/);
    expect(flat).not.toMatch(/"name"\s*:\s*"/);
    expect(flat).not.toMatch(/"question_text"\s*:/);
  });
});
