/**
 * Contract tests for GET /api/v2/curriculum-version — the cheap curriculum
 * freshness poll the mobile Learn cache anchors on.
 *
 * WHAT THIS PINS
 * ==============
 *  1. AUTH IS THE ONLY REJECTION (P9) — `study_plan.view` + requireStudentId.
 *     A deny returns the RBAC errorResponse VERBATIM (401/403); nothing else in
 *     this route may produce a non-200.
 *  2. VERBATIM PASSTHROUGH — the `get_curriculum_versions` jsonb is returned
 *     byte-for-byte inside the /v2 envelope. NO `schemaVersion` is injected (the
 *     contract is frozen and this is a version poll, not a versioned payload).
 *     The mobile CurriculumVersionRepository parses `body['scopes']` directly, so
 *     any re-shaping here silently breaks every device's staleness decision.
 *  3. NEVER 500s — a bad/absent grade, an RPC error, or a thrown exception ALL
 *     degrade to `{ as_of, scopes: {} }` + HTTP 200 + `no-store`. This matters
 *     because of how the client reads a failure: the repository maps ANY poll
 *     failure to `null` -> "version unknown" -> serve-stale-within-TTL / refuse.
 *     A 5xx here would push every device onto the offline path. `no-store` is
 *     what makes the next poll re-attempt immediately instead of caching the
 *     degraded answer for 30s.
 *  4. P13 — the logged fields carry an opaque event name + message + route ONLY.
 *     Never the studentId, never the grade, never PII.
 *  5. P5 — the grade reaches the RPC as a STRING, and `p_subject_codes` is
 *     OMITTED so the SQL DEFAULT (NULL -> all-subjects-with-content) applies.
 *
 * Lane: CI unit step (`npm test` -> vitest). Fully mocked — no DB, no network.
 * The RPC's own monotonicity/delete-safety is a live-DB concern and is pinned by
 * `src/__tests__/migrations/curriculum-version-monotonicity.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a),
}));

const _loggerError = vi.fn();
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: (...a: unknown[]) => _loggerError(...a),
  },
}));

const STUDENT_A = '11111111-1111-4111-8111-111111111111';

let _student: { data: { grade: unknown } | null } = { data: { grade: '9' } };
const _rpcImpl = vi.fn();

// P8: the route reads through the RLS-SCOPED client, NOT the service-role
// client (`@alfanumrik/lib/supabase-admin`). The admin-client footprint is frozen
// by `api-admin-client-allowlist.test.ts` and may only ratchet down, and this
// route provably doesn't need RLS-bypassing rights: the grade read is the
// caller's OWN students row (`students_select_merged`), and
// `get_curriculum_versions` is SECURITY DEFINER + GRANTed to `authenticated`.
// Mocking the scoped client keeps this suite fully offline (no DB, no network)
// while pinning the same behavioural contract as before.
vi.mock('@/app/api/v2/curriculum-version/_scoped-client', () => ({
  createCurriculumVersionClient: () =>
    Promise.resolve({
      from: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ['select', 'eq']) chain[m] = () => chain;
        chain.maybeSingle = () => Promise.resolve(_student);
        return chain;
      },
      rpc: (...a: unknown[]) => _rpcImpl(...a),
    }),
}));

/** The exact header literals the route ships. Pinned, not recomputed. */
const OK_CACHE = 'private, max-age=30, stale-while-revalidate=60';
const DEGRADED_CACHE = 'no-store';

/** A realistic frozen-contract RPC payload. */
const RPC_JSONB = {
  as_of: '2026-07-17T10:00:00Z',
  scopes: { 'math-9': 1752750000, 'science-9': 1752740000 },
};

const url = () =>
  new Request('http://localhost/api/v2/curriculum-version', { method: 'GET' });

function setAuthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: STUDENT_A,
    roles: ['student'],
    permissions: ['study_plan.view'],
  });
}

/**
 * The contract's degraded answer. Asserted identically on EVERY failure branch
 * so "never break the poll" is one shared, unambiguous shape.
 */
async function expectDegraded(res: Response) {
  expect(res.status, 'a version poll must NEVER return a non-200').toBe(200);
  expect(
    res.headers.get('Cache-Control'),
    'a degraded answer must be no-store so the next poll re-attempts immediately',
  ).toBe(DEGRADED_CACHE);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.data.scopes).toEqual({});
  expect(typeof body.data.as_of).toBe('string');
  expect(Number.isNaN(Date.parse(body.data.as_of))).toBe(false);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: any;
beforeEach(async () => {
  vi.clearAllMocks();
  setAuthorized();
  _student = { data: { grade: '9' } };
  _rpcImpl.mockResolvedValue({ data: RPC_JSONB, error: null });
  GET = (await import('@/app/api/v2/curriculum-version/route')).GET;
});

describe('GET /api/v2/curriculum-version — auth boundary (P9)', () => {
  it('uses study_plan.view with requireStudentId', async () => {
    await GET(url());
    expect(_authorizeImpl).toHaveBeenCalledWith(
      expect.anything(),
      'study_plan.view',
      expect.objectContaining({ requireStudentId: true }),
    );
  });

  it('returns 401 when unauthenticated', async () => {
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false,
      userId: null,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    const res = await GET(url());
    expect(res.status).toBe(401);
    expect(_rpcImpl, 'a denied caller must never reach the RPC').not.toHaveBeenCalled();
  });

  it('returns the RBAC errorResponse verbatim when permission is denied (403)', async () => {
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false,
      userId: 'auth-user-1',
      errorResponse: new Response(JSON.stringify({ error: 'Forbidden', code: 'FORBIDDEN' }), {
        status: 403,
      }),
    });
    const res = await GET(url());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FORBIDDEN');
    expect(_rpcImpl, 'a denied caller must never reach the RPC').not.toHaveBeenCalled();
  });

  it('denies when authorized but userId is missing (fail-closed)', async () => {
    _authorizeImpl.mockResolvedValueOnce({
      authorized: true,
      userId: null,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    expect((await GET(url())).status).toBe(401);
  });
});

describe('GET /api/v2/curriculum-version — happy path (verbatim passthrough)', () => {
  it('returns the RPC jsonb VERBATIM inside the /v2 envelope', async () => {
    const res = await GET(url());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // Deep equality, not a subset: the frozen contract is `{ as_of, scopes }`
    // and the mobile client reads `scopes` straight off this object.
    expect(body.data).toEqual(RPC_JSONB);
  });

  it('does NOT inject schemaVersion into the version-poll payload', async () => {
    const body = await (await GET(url())).json();
    expect(
      body.data,
      'the curriculum-version contract is frozen — unlike the other /v2 payloads it ' +
        'carries no schemaVersion, and adding one breaks the mobile parser',
    ).not.toHaveProperty('schemaVersion');
    expect(Object.keys(body.data).sort()).toEqual(['as_of', 'scopes']);
  });

  it('sets the private short-lived cache header on a successful poll', async () => {
    const res = await GET(url());
    expect(
      res.headers.get('Cache-Control'),
      'grade-scoped data must be `private` — never a shared/CDN cache',
    ).toBe(OK_CACHE);
  });

  it('calls get_curriculum_versions with p_grade only, so p_subject_codes takes the SQL DEFAULT', async () => {
    await GET(url());
    expect(_rpcImpl).toHaveBeenCalledTimes(1);
    expect(
      _rpcImpl,
      'omitting p_subject_codes is what makes this poll <1 KB (all subjects with ' +
        'content for the grade, empties omitted). Passing an explicit NULL/array changes that.',
    ).toHaveBeenCalledWith('get_curriculum_versions', { p_grade: '9' });
  });

  it('passes an empty scope map through with a 200 when the RPC reports no content', async () => {
    // An out-of-range grade is handled INSIDE the RPC, which answers `{as_of, scopes:{}}`.
    // That is a SUCCESSFUL poll — it passes through with the OK cache header, not `no-store`.
    const empty = { as_of: '2026-07-17T10:00:00Z', scopes: {} };
    _rpcImpl.mockResolvedValueOnce({ data: empty, error: null });
    const res = await GET(url());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(empty);
    expect(res.headers.get('Cache-Control')).toBe(OK_CACHE);
  });
});

describe('GET /api/v2/curriculum-version — P5 grade contract', () => {
  it('sends the grade to the RPC as a string', async () => {
    _student = { data: { grade: '11' } };
    await GET(url());
    expect(_rpcImpl).toHaveBeenCalledWith('get_curriculum_versions', { p_grade: '11' });
  });

  it('coerces a drifted integer grade to a string before the RPC', async () => {
    // P5: grades are strings everywhere. A legacy/drifted row holding an int must
    // not reach the RPC as a number (the RPC signature is `p_grade text`).
    _student = { data: { grade: 9 } };
    await GET(url());
    const [, params] = _rpcImpl.mock.calls[0];
    expect(params.p_grade).toBe('9');
    expect(typeof params.p_grade).toBe('string');
  });
});

describe('GET /api/v2/curriculum-version — never breaks the poll (degrades, never 500s)', () => {
  it('degrades when the caller has no resolved student profile', async () => {
    _authorizeImpl.mockResolvedValueOnce({
      authorized: true,
      userId: 'auth-user-1',
      studentId: null,
      roles: ['parent'],
      permissions: ['study_plan.view'],
    });
    const res = await GET(url());
    await expectDegraded(res);
    expect(_rpcImpl, 'no studentId → no grade → the RPC must not be called').not.toHaveBeenCalled();
  });

  it('degrades when the student row is absent', async () => {
    _student = { data: null };
    await expectDegraded(await GET(url()));
    expect(_rpcImpl).not.toHaveBeenCalled();
  });

  it('degrades when the student row has a null grade', async () => {
    _student = { data: { grade: null } };
    await expectDegraded(await GET(url()));
    expect(_rpcImpl).not.toHaveBeenCalled();
  });

  it('degrades when the student row has an empty-string grade', async () => {
    // '' is falsy → `!student?.grade` short-circuits before the RPC.
    _student = { data: { grade: '' } };
    await expectDegraded(await GET(url()));
    expect(_rpcImpl).not.toHaveBeenCalled();
  });

  it('degrades when the RPC returns an error', async () => {
    _rpcImpl.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    await expectDegraded(await GET(url()));
  });

  it('degrades when the RPC returns an empty result with no error', async () => {
    _rpcImpl.mockResolvedValueOnce({ data: null, error: null });
    await expectDegraded(await GET(url()));
  });

  it('degrades when the RPC throws', async () => {
    _rpcImpl.mockRejectedValueOnce(new Error('connection reset'));
    await expectDegraded(await GET(url()));
  });

  it('degrades when authorizeRequest itself throws', async () => {
    _authorizeImpl.mockRejectedValueOnce(new Error('rbac exploded'));
    await expectDegraded(await GET(url()));
  });
});

describe('GET /api/v2/curriculum-version — P13 (no PII in logs)', () => {
  it('logs the RPC failure with an opaque event name, message and route only', async () => {
    _rpcImpl.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    await GET(url());

    expect(_loggerError).toHaveBeenCalledTimes(1);
    const [event, fields] = _loggerError.mock.calls[0];
    expect(event).toBe('v2_curriculum_version_rpc_failed');
    // Exact key set: adding a field here is how a studentId/grade leaks in.
    expect(Object.keys(fields).sort()).toEqual(['error', 'route']);
    expect(fields.route).toBe('/api/v2/curriculum-version');
    expect(fields.error).toBe('down');
  });

  it('names the empty-RPC-result cause without logging the grade', async () => {
    _student = { data: { grade: '11' } };
    _rpcImpl.mockResolvedValueOnce({ data: null, error: null });
    await GET(url());
    const [, fields] = _loggerError.mock.calls[0];
    expect(fields.error).toBe('empty_rpc_result');
    expect(Object.keys(fields).sort()).toEqual(['error', 'route']);
  });

  it('never logs the studentId, the grade, or any PII-shaped key', async () => {
    _student = { data: { grade: '11' } };
    _rpcImpl.mockRejectedValueOnce(new Error('connection reset'));
    await GET(url());

    expect(_loggerError).toHaveBeenCalledTimes(1);
    const [event, fields] = _loggerError.mock.calls[0];
    expect(event).toBe('v2_curriculum_version_failed');
    expect(Object.keys(fields).sort()).toEqual(['error', 'route']);

    // Sweep every logged value (Error objects serialize opaquely; the key-set
    // assertion above is the primary pin, this is the belt-and-braces sweep).
    const swept = JSON.stringify({
      ...fields,
      error: fields.error instanceof Error ? fields.error.message : fields.error,
    });
    expect(swept).not.toContain(STUDENT_A);
    expect(swept).not.toMatch(/\bgrade\b/i);
    expect(swept).not.toMatch(/name|email|phone/i);
  });

  it('logs nothing on the happy path', async () => {
    await GET(url());
    expect(_loggerError).not.toHaveBeenCalled();
  });
});
