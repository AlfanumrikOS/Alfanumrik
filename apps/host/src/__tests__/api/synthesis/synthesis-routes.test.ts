/**
 * Tests for Pedagogy v2 Wave 3 synthesis routes.
 *
 * Covers:
 *   GET  /api/synthesis/state       — lazy-fills bilingual summary on first view
 *   POST /api/synthesis/parent-share — sends synthesis to WhatsApp guardian
 *
 * Both routes:
 *   - Use createSupabaseServerClient + supabase.auth.getUser() for auth
 *   - Are gated by ff_pedagogy_v2_monthly_synthesis
 *   - Return 401 when unauthenticated, 404 when flag off
 *
 * state route additionally calls callClaude for lazy-fill and uses supabaseAdmin
 * for the UPDATE write (no UPDATE RLS for end users on monthly_synthesis_runs).
 *
 * parent-share additionally calls the whatsapp-notify Edge Function via fetch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mutable holders ───────────────────────────────────────────────────
const holders = vi.hoisted(() => ({
  // Auth
  mockGetUser: vi.fn(),
  mockAuthorizeRequest: vi.fn(),

  // Feature flag
  mockIsFeatureEnabled: vi.fn(),

  // Server-client DB responses (chainable builder results)
  studentRow: null as Record<string, unknown> | null,
  studentError: null as { message: string } | null,
  synthesisRow: null as Record<string, unknown> | null,
  synthesisError: null as { message: string } | null,

  // Argument-sensitive mock instrumentation: records every .eq(col, val) call
  // made against the `students` and `monthly_synthesis_runs` tables so tests
  // can assert the route queries the CORRECT column (regression guard for the
  // students.id vs students.auth_user_id bug).
  studentEqCalls: [] as Array<[string, unknown]>,
  synthesisEqCalls: [] as Array<[string, unknown]>,

  // Admin-client DB responses (supabaseAdmin.from())
  adminFromMock: vi.fn(),

  // parent-share: admin from calls for multi-table
  adminSelectResult: null as Record<string, unknown> | null,
  adminSelectError: null as { message: string } | null,
  adminLinkRows: null as Array<Record<string, unknown>> | null,
  adminGuardianRow: null as Record<string, unknown> | null,

  // Claude mock
  mockCallClaude: vi.fn(),

  // fetch mock (WhatsApp)
  mockFetch: vi.fn(),
}));

// ── mock: supabase-server ─────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      getUser: (...args: unknown[]) => holders.mockGetUser(...args),
    },
    from: (table: string) => {
      if (table === 'students') {
        return {
          select: () => ({
            // Argument-sensitive: only the CORRECT column (auth_user_id) can
            // ever resolve a row. If the route regresses to
            // `.eq('id', authUid)` (the CRITICAL bug this suite guards
            // against), this mock returns no row and every dependent
            // assertion downstream (state:'ready', synthesisEqCalls, etc.)
            // fails loudly instead of silently matching the wrong student.
            eq: (col: string, val: unknown) => {
              holders.studentEqCalls.push([col, val]);
              const isCorrectQuery = col === 'auth_user_id';
              return {
                maybeSingle: () =>
                  Promise.resolve(
                    isCorrectQuery
                      ? { data: holders.studentRow, error: holders.studentError }
                      : { data: null, error: null },
                  ),
              };
            },
          }),
        };
      }
      if (table === 'monthly_synthesis_runs') {
        return {
          select: () => ({
            // Argument-sensitive: only resolves when queried by the
            // resolved surrogate student_id (never the raw auth uid).
            eq: (col: string, val: unknown) => {
              holders.synthesisEqCalls.push([col, val]);
              const isCorrectQuery = col === 'student_id';
              return {
                order: () => ({
                  limit: () => ({
                    maybeSingle: () =>
                      Promise.resolve(
                        isCorrectQuery
                          ? { data: holders.synthesisRow, error: holders.synthesisError }
                          : { data: null, error: null },
                      ),
                  }),
                }),
              };
            },
          }),
        };
      }
      return {};
    },
  })),
}));

// ── mock: rbac (authorizeRequest) ─────────────────────────────────────────────
// parent-share gained a house-convention authorizeRequest() gate (2026-07-20,
// parent-dashboard RCA Task 1.5) as the FIRST check, ahead of the route's own
// supabase.auth.getUser() call. Wired via authedAs() below so the two auth
// checks stay in lockstep for every test scenario.
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => holders.mockAuthorizeRequest(...args),
}));

// ── mock: supabase-admin ──────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => holders.adminFromMock(...args),
  },
}));

// ── mock: feature-flags ───────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => holders.mockIsFeatureEnabled(...args),
  PEDAGOGY_V2_FLAGS: {
    MONTHLY_SYNTHESIS: 'ff_pedagogy_v2_monthly_synthesis',
  },
}));

// ── mock: callClaude ──────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/ai/clients/claude', () => ({
  callClaude: (...args: unknown[]) => holders.mockCallClaude(...args),
}));

// ── mock: synthesis-summary helpers ──────────────────────────────────────────
vi.mock('@alfanumrik/lib/ai/workflows/synthesis-summary', () => ({
  buildSynthesisSummaryPrompt: vi.fn(() => 'mock-system-prompt'),
  parseSynthesisSummaryReply: vi.fn(() => ({
    textEn: 'Great month, Asha!',
    textHi: 'बहुत अच्छा महीना, आशा!',
  })),
}));

// ── mock: monthly-synthesis-orchestrator (type import only) ──────────────────
vi.mock('@alfanumrik/lib/learn/monthly-synthesis-orchestrator', () => ({}));

// ── mock: internal-caller-signing ────────────────────────────────────────────
vi.mock('@alfanumrik/lib/security/internal-caller-signing', () => ({
  buildInternalCallerHeaders: vi.fn(() => ({ 'x-internal-caller': 'test' })),
}));

// ── mock: logger ──────────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── stub global fetch (WhatsApp calls from parent-share) ─────────────────────
vi.stubGlobal('fetch', (...args: unknown[]) => holders.mockFetch(...args));

// ── lazy imports after mocks are in place ────────────────────────────────────
import { GET } from '@/app/api/synthesis/state/route';
import { POST } from '@/app/api/synthesis/parent-share/route';
// Item 4.2/4.5 (2026-07-21): the real (unmocked) oracle module. Its pure
// fabrication/word-cap/fallback/circuit-breaker logic is exercised for real
// through these routes — only `synthesisClaudeCircuitBreaker` needs a reset
// between tests since it is a module-level singleton shared across every
// `it()` in this file (see beforeEach below).
import { synthesisClaudeCircuitBreaker } from '@alfanumrik/lib/ai/validation/synthesis-oracle';

// ── constants ─────────────────────────────────────────────────────────────────
const USER_ID   = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const ROW_ID    = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const STUDENT_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

/** Minimal synthesis run row returned by the server-client SELECT. */
const SYNTHESIS_ROW = {
  id: ROW_ID,
  synthesis_month: '2026-06',
  bundle: { topicsReviewed: 3 },
  summary_text_en: 'Good month overall.',
  summary_text_hi: 'अच्छा महीना।',
  parent_share_status: 'pending',
  parent_share_sent_at: null,
  created_at: '2026-07-01T00:00:00Z',
};

/** Synthesis row with empty summaries — triggers lazy-fill. */
const SYNTHESIS_ROW_EMPTY_SUMMARY = {
  ...SYNTHESIS_ROW,
  summary_text_en: '',
  summary_text_hi: '',
};

function makeGetRequest(): Request {
  return new Request('http://localhost/api/synthesis/state');
}

function makePostRequest(body: unknown): Request {
  return new Request('http://localhost/api/synthesis/parent-share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Helper: authenticate the mocked supabase user. */
function authedAs(userId: string | null) {
  if (userId === null) {
    holders.mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    // Mirrors the real authorizeRequest() 401 shape (packages/lib/src/rbac.ts)
    // for the parent-share route's new RBAC gate.
    holders.mockAuthorizeRequest.mockResolvedValue({
      authorized: false,
      userId: null,
      errorResponse: new Response(
        JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    });
  } else {
    holders.mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    holders.mockAuthorizeRequest.mockResolvedValue({ authorized: true, userId });
  }
}

/** Helper: feature flag on/off. */
function flagOn()  { holders.mockIsFeatureEnabled.mockResolvedValue(true);  }
function flagOff() { holders.mockIsFeatureEnabled.mockResolvedValue(false); }

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/synthesis/state
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/synthesis/state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holders.studentRow = null;
    holders.studentError = null;
    holders.synthesisRow = null;
    holders.synthesisError = null;
    holders.studentEqCalls = [];
    holders.synthesisEqCalls = [];
    // Default: admin update succeeds
    holders.adminFromMock.mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      // resolve to no error by default
    });
    holders.mockCallClaude.mockResolvedValue({
      content: 'EN: Great month!\nHI: बहुत अच्छा महीना!',
    });
    // Reset the real (unmocked) circuit-breaker singleton so a failure
    // recorded by one test can never leak into (and skip the Claude call
    // for) a later test in this file.
    synthesisClaudeCircuitBreaker.recordSuccess();
  });

  it('returns 401 when not authenticated', async () => {
    holders.mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthenticated');
  });

  it('returns 404 when feature flag is off', async () => {
    authedAs(USER_ID);
    flagOff();
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not_found');
  });

  it('returns 404 when student profile does not exist', async () => {
    authedAs(USER_ID);
    flagOn();
    holders.studentRow = null;
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('no_student_profile');
  });

  it('returns state: no_synthesis_yet when no row exists', async () => {
    authedAs(USER_ID);
    flagOn();
    holders.studentRow = { id: STUDENT_ID, name: 'Asha', grade: '9' };
    holders.synthesisRow = null;
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe('no_synthesis_yet');
  });

  it('returns 500 when synthesis row fetch errors', async () => {
    authedAs(USER_ID);
    flagOn();
    holders.studentRow = { id: STUDENT_ID, name: 'Asha', grade: '9' };
    holders.synthesisError = { message: 'DB timeout' };
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('state_fetch_failed');
  });

  it('happy path: returns state:ready with correct shape when summary already filled', async () => {
    authedAs(USER_ID);
    flagOn();
    holders.studentRow = { id: STUDENT_ID, name: 'Asha', grade: '9' };
    holders.synthesisRow = SYNTHESIS_ROW;
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe('ready');
    expect(body.row).toBeDefined();
    expect(body.row.id).toBe(ROW_ID);
    expect(body.row.synthesisMonth).toBe('2026-06');
    expect(body.row.summaryTextEn).toBe('Good month overall.');
    expect(body.row.summaryTextHi).toBe('अच्छा महीना।');
    expect(body.row.parentShareStatus).toBe('pending');
    // Response must include Cache-Control header (private, no caching)
    expect(res.headers.get('Cache-Control')).toMatch(/private/);
    // REGRESSION GUARD: the students lookup must resolve the surrogate id
    // via auth_user_id, and monthly_synthesis_runs must be filtered by that
    // resolved surrogate id — never by the raw auth uid.
    expect(holders.studentEqCalls).toContainEqual(['auth_user_id', USER_ID]);
    expect(holders.synthesisEqCalls).toContainEqual(['student_id', STUDENT_ID]);
  });

  it('REGRESSION: students lookup keys on auth_user_id, not id — reverting to .eq(\'id\', authUid) breaks resolution', async () => {
    authedAs(USER_ID);
    flagOn();
    holders.studentRow = { id: STUDENT_ID, name: 'Asha', grade: '9' };
    holders.synthesisRow = SYNTHESIS_ROW;

    const res = await GET(makeGetRequest());

    // Happy path proves the resolution chain works end-to-end.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe('ready');

    // The mock is argument-sensitive: it only returns a student row when
    // queried by `auth_user_id`. Confirm the route actually used that
    // column (never `id`) — if this ever reverts, the query would use the
    // wrong column, the argument-sensitive mock would return no row, and
    // the route would 404 with 'no_student_profile' instead of 200.
    expect(holders.studentEqCalls.length).toBeGreaterThan(0);
    expect(holders.studentEqCalls.every(([col]) => col === 'auth_user_id')).toBe(true);
    expect(holders.studentEqCalls.some(([col]) => col === 'id')).toBe(false);

    // Same guard for the downstream monthly_synthesis_runs query: it must
    // be filtered by the resolved surrogate student id, not the auth uid.
    expect(holders.synthesisEqCalls.every(([col]) => col === 'student_id')).toBe(true);
    expect(holders.synthesisEqCalls.some(([, val]) => val === USER_ID)).toBe(false);
    expect(holders.synthesisEqCalls.some(([, val]) => val === STUDENT_ID)).toBe(true);
  });

  it('P13: no_student_profile denial response contains no PII keys', async () => {
    authedAs(USER_ID);
    flagOn();
    holders.studentRow = null;
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(404);
    const body = await res.json();
    const raw = JSON.stringify(body).toLowerCase();
    expect(raw).not.toMatch(/email/);
    expect(raw).not.toMatch(/phone/);
    expect(raw).not.toMatch(/"name"/);
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('phone');
    expect(body).not.toHaveProperty('name');
  });

  it('lazy-fills empty summary via callClaude and persists via supabaseAdmin', async () => {
    authedAs(USER_ID);
    flagOn();
    holders.studentRow = { id: STUDENT_ID, name: 'Asha', grade: '9' };
    holders.synthesisRow = SYNTHESIS_ROW_EMPTY_SUMMARY;

    // Admin update chain for the lazy-fill persist
    const mockEq = vi.fn().mockResolvedValue({ error: null });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    holders.adminFromMock.mockReturnValue({ update: mockUpdate });

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe('ready');
    // parseSynthesisSummaryReply mock returns known values
    expect(body.row.summaryTextEn).toBe('Great month, Asha!');
    expect(body.row.summaryTextHi).toBe('बहुत अच्छा महीना, आशा!');
    // callClaude must have been invoked exactly once for the lazy-fill
    expect(holders.mockCallClaude).toHaveBeenCalledTimes(1);
    // supabaseAdmin.from() must have been called to persist the result
    expect(holders.adminFromMock).toHaveBeenCalledWith('monthly_synthesis_runs');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ summary_text_en: 'Great month, Asha!' }),
    );
  });

  it('item 4.2: falls back to a deterministic template (never empty) when callClaude fails', async () => {
    authedAs(USER_ID);
    flagOn();
    holders.studentRow = { id: STUDENT_ID, name: 'Asha', grade: '9' };
    holders.synthesisRow = SYNTHESIS_ROW_EMPTY_SUMMARY;
    holders.mockCallClaude.mockRejectedValue(new Error('Claude timeout'));

    const mockEq = vi.fn().mockResolvedValue({ error: null });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    holders.adminFromMock.mockReturnValue({ update: mockUpdate });

    const res = await GET(makeGetRequest());
    // Route falls back gracefully — still 200
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe('ready');
    // Item 4.2: the student/parent must NEVER see an empty summary — the
    // deterministic bundle-only template fills in instead of ''.
    expect(body.row.summaryTextEn).not.toBe('');
    expect(body.row.summaryTextHi).not.toBe('');
    expect(body.row.summaryTextEn).toContain('Asha');
    // The fallback template is persisted too, not just returned in-response.
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        summary_text_en: expect.stringContaining('Asha'),
      }),
    );
  });

  it('item 4.2: falls back to the template (never empty) when the oracle rejects a fabricated number', async () => {
    authedAs(USER_ID);
    flagOn();
    holders.studentRow = { id: STUDENT_ID, name: 'Asha', grade: '9' };
    holders.synthesisRow = SYNTHESIS_ROW_EMPTY_SUMMARY;
    // A number ("47") with no basis anywhere in the bundle ({ topicsReviewed: 3 }).
    const { parseSynthesisSummaryReply } = await import('@alfanumrik/lib/ai/workflows/synthesis-summary');
    (parseSynthesisSummaryReply as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      textEn: 'Asha mastered 47 new topics this month!',
      textHi: 'आशा ने इस महीने 47 नए विषयों में महारत हासिल की!',
    });

    const mockEq = vi.fn().mockResolvedValue({ error: null });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    holders.adminFromMock.mockReturnValue({ update: mockUpdate });

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    // The fabricated "47" must NEVER reach the response.
    expect(body.row.summaryTextEn).not.toContain('47');
    expect(body.row.summaryTextEn).not.toBe('');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        summary_text_en: expect.not.stringContaining('47'),
      }),
    );
  });

  it('item 4.2: circuit breaker OPEN skips the Claude call entirely and serves the template', async () => {
    authedAs(USER_ID);
    flagOn();
    holders.studentRow = { id: STUDENT_ID, name: 'Asha', grade: '9' };
    holders.synthesisRow = SYNTHESIS_ROW_EMPTY_SUMMARY;
    holders.adminFromMock.mockReturnValue({
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    });

    // Trip the breaker directly (5 failures — SYNTHESIS_CB_FAILURE_THRESHOLD).
    for (let i = 0; i < 5; i++) synthesisClaudeCircuitBreaker.recordFailure();
    expect(synthesisClaudeCircuitBreaker.canRequest()).toBe(false);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.row.summaryTextEn).not.toBe('');
    expect(body.row.summaryTextEn).toContain('Asha');
    // Claude was never called — the breaker short-circuited before the call.
    expect(holders.mockCallClaude).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/synthesis/parent-share
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/synthesis/parent-share', () => {
  /** Minimal synthesis+student join row returned by supabaseAdmin. */
  const SYNTHESIS_WITH_STUDENT = {
    id: ROW_ID,
    student_id: STUDENT_ID,
    synthesis_month: '2026-06',
    summary_text_en: 'Good month overall.',
    summary_text_hi: 'अच्छा महीना।',
    parent_share_status: 'pending',
    students: {
      id: STUDENT_ID,
      name: 'Asha',
      auth_user_id: USER_ID,
      grade: '9',
    },
  };

  const GUARDIAN_ID   = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
  const GUARDIAN_PHONE = '+919876543210';

  /** Helper: build a supabaseAdmin from() mock that returns the right data
   *  depending on which table is being queried. */
  function buildAdminFrom({
    synthesisData = SYNTHESIS_WITH_STUDENT as Record<string, unknown> | null,
    synthesisError = null as { message: string } | null,
    linkRows = [{ guardian_id: GUARDIAN_ID, status: 'approved' }] as Array<Record<string, unknown>> | null,
    guardianRow = {
      id: GUARDIAN_ID,
      phone: GUARDIAN_PHONE,
      preferred_language: 'en',
      monthly_synthesis_optin: true,
    } as Record<string, unknown> | null,
    updateResult = { error: null } as { error: { message: string } | null },
  } = {}) {
    holders.adminFromMock.mockImplementation((table: string) => {
      if (table === 'monthly_synthesis_runs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: synthesisData, error: synthesisError }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve(updateResult),
          }),
        };
      }
      if (table === 'guardian_student_links') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                limit: () =>
                  Promise.resolve({ data: linkRows, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'guardians') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: guardianRow, error: null }),
            }),
          }),
        };
      }
      // catch-all update (for opt-out / final status persist)
      return {
        update: () => ({
          eq: () => Promise.resolve(updateResult),
        }),
      };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Env vars are set by src/__tests__/setup.ts — no overrides needed here.
  });

  it('returns 401 (from the authorizeRequest RBAC gate) when not authenticated', async () => {
    // Since 2026-07-20 (parent-dashboard RCA Task 1.5), authorizeRequest()
    // is the FIRST check in this route -- ahead of the route's own
    // supabase.auth.getUser() call -- so an unauthenticated caller is now
    // rejected by the RBAC gate's own 401 shape (error:'Unauthorized',
    // code:'AUTH_REQUIRED'), matching every other parent-portal route's
    // convention, rather than the route's original bespoke
    // error:'unauthenticated' shape (which is now unreachable for a truly
    // unauthenticated caller, though it remains the route's own
    // defense-in-depth check for the theoretical case where
    // authorizeRequest and supabase.auth.getUser() disagree).
    authedAs(null);
    const res = await POST(makePostRequest({ synthesisRunId: ROW_ID }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('returns 401 with the route-own shape when authorizeRequest passes but supabase getUser still reports no session (defense-in-depth, theoretical)', async () => {
    holders.mockAuthorizeRequest.mockResolvedValue({ authorized: true, userId: USER_ID });
    holders.mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makePostRequest({ synthesisRunId: ROW_ID }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthenticated');
  });

  it('returns 404 when feature flag is off', async () => {
    authedAs(USER_ID);
    flagOff();
    const res = await POST(makePostRequest({ synthesisRunId: ROW_ID }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not_found');
  });

  it('returns 400 when synthesisRunId is missing', async () => {
    authedAs(USER_ID);
    flagOn();
    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_synthesis_run_id');
  });

  it('returns 400 when request body is not valid JSON', async () => {
    authedAs(USER_ID);
    flagOn();
    const req = new Request('http://localhost/api/synthesis/parent-share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
  });

  it('returns 500 when synthesis row fetch fails', async () => {
    authedAs(USER_ID);
    flagOn();
    buildAdminFrom({ synthesisData: null, synthesisError: { message: 'DB error' } });
    const res = await POST(makePostRequest({ synthesisRunId: ROW_ID }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('synthesis_lookup_failed');
  });

  it('returns 404 when synthesis row is not found', async () => {
    authedAs(USER_ID);
    flagOn();
    buildAdminFrom({ synthesisData: null });
    const res = await POST(makePostRequest({ synthesisRunId: ROW_ID }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('synthesis_not_found');
  });

  it('returns 403 when synthesis belongs to a different student', async () => {
    authedAs(USER_ID);
    flagOn();
    const foreignRow = {
      ...SYNTHESIS_WITH_STUDENT,
      students: { ...SYNTHESIS_WITH_STUDENT.students, auth_user_id: 'other-user-id' },
    };
    buildAdminFrom({ synthesisData: foreignRow });
    const res = await POST(makePostRequest({ synthesisRunId: ROW_ID }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('forbidden');
  });

  it('returns 200 alreadySent:true when status is already sent', async () => {
    authedAs(USER_ID);
    flagOn();
    const alreadySentRow = { ...SYNTHESIS_WITH_STUDENT, parent_share_status: 'sent' };
    buildAdminFrom({ synthesisData: alreadySentRow });
    const res = await POST(makePostRequest({ synthesisRunId: ROW_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.alreadySent).toBe(true);
  });

  it('returns 404 when no linked guardian is found', async () => {
    authedAs(USER_ID);
    flagOn();
    buildAdminFrom({ linkRows: [] });
    const res = await POST(makePostRequest({ synthesisRunId: ROW_ID }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('no_linked_guardian');
  });

  // ── Item 4.5 (2026-07-21): pre-send fabrication gate ──────────────────────
  it('item 4.5: flags (never sends) a summary with a fabricated number, and writes parent_share_status=flagged', async () => {
    authedAs(USER_ID);
    flagOn();
    const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const rowWithFabrication = {
      ...SYNTHESIS_WITH_STUDENT,
      bundle: { monthLabel: '2026-06', weeklyArtifactIds: [], masteryDelta: { chaptersTouched: [], topicsMastered: 0, topicsImproved: 0, topicsRegressed: 0 }, chapterMockSummary: null },
      summary_text_en: 'Asha completed 999 quizzes this month!',
    };
    holders.adminFromMock.mockImplementation((table: string) => {
      if (table === 'monthly_synthesis_runs') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: rowWithFabrication, error: null }) }) }),
          update: mockUpdate,
        };
      }
      if (table === 'guardian_student_links') {
        return { select: () => ({ eq: () => ({ in: () => ({ limit: () => Promise.resolve({ data: [{ guardian_id: GUARDIAN_ID }], error: null }) }) }) }) };
      }
      if (table === 'guardians') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: { id: GUARDIAN_ID, phone: GUARDIAN_PHONE, preferred_language: 'en', monthly_synthesis_optin: true },
                error: null,
              }),
            }),
          }),
        };
      }
      return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    });

    const res = await POST(makePostRequest({ synthesisRunId: ROW_ID }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('flagged_for_review');
    expect(mockUpdate).toHaveBeenCalledWith({ parent_share_status: 'flagged' });
    // The WhatsApp send must NEVER have been attempted.
    expect(holders.mockFetch).not.toHaveBeenCalled();
  });

  it('item 4.5: a clean, bundle-backed summary passes the pre-send gate and still sends', async () => {
    authedAs(USER_ID);
    flagOn();
    buildAdminFrom({
      synthesisData: {
        ...SYNTHESIS_WITH_STUDENT,
        bundle: { monthLabel: '2026-06', weeklyArtifactIds: [], masteryDelta: { chaptersTouched: ['Motion'], topicsMastered: 2, topicsImproved: 1, topicsRegressed: 0 }, chapterMockSummary: null },
        summary_text_en: 'Asha mastered 2 topics in Motion this month.',
      },
    });
    holders.mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ whatsapp_id: 'wa-msg-002' }),
      text: () => Promise.resolve(''),
    });
    const res = await POST(makePostRequest({ synthesisRunId: ROW_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 403 and updates status to opted_out when guardian has opted out', async () => {
    authedAs(USER_ID);
    flagOn();
    const mockUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });

    holders.adminFromMock.mockImplementation((table: string) => {
      if (table === 'monthly_synthesis_runs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: SYNTHESIS_WITH_STUDENT, error: null }),
            }),
          }),
          update: mockUpdate,
        };
      }
      if (table === 'guardian_student_links') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                limit: () =>
                  Promise.resolve({ data: [{ guardian_id: GUARDIAN_ID }], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'guardians') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: GUARDIAN_ID,
                    phone: GUARDIAN_PHONE,
                    preferred_language: 'en',
                    monthly_synthesis_optin: false, // opted out
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    });

    const res = await POST(makePostRequest({ synthesisRunId: ROW_ID }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('guardian_opted_out');
    // status must have been written to opted_out
    expect(mockUpdate).toHaveBeenCalledWith({ parent_share_status: 'opted_out' });
  });

  it('happy path: sends WhatsApp and returns ok:true with sentAt', async () => {
    authedAs(USER_ID);
    flagOn();
    buildAdminFrom();

    // WhatsApp call succeeds
    holders.mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ whatsapp_id: 'wa-msg-001' }),
      text: () => Promise.resolve(''),
    });

    const res = await POST(makePostRequest({ synthesisRunId: ROW_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.sentAt).toBe('string');
    expect(body.waId).toBe('wa-msg-001');
  });

  it('returns 502 when WhatsApp delivery fails', async () => {
    authedAs(USER_ID);
    flagOn();
    buildAdminFrom();

    // WhatsApp returns non-OK status
    holders.mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service unavailable'),
    });

    const res = await POST(makePostRequest({ synthesisRunId: ROW_ID }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('whatsapp_delivery_failed');
  });

  it('returns 502 when WhatsApp fetch throws a network error', async () => {
    authedAs(USER_ID);
    flagOn();
    buildAdminFrom();

    holders.mockFetch.mockRejectedValue(new Error('Network error'));

    const res = await POST(makePostRequest({ synthesisRunId: ROW_ID }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('whatsapp_delivery_failed');
  });
});
