/**
 * GET /api/predict/outcome — read-only Outcome Prediction Agent route contract
 * (GenAI arch Phase 5a). P8 (IDOR) / P13 (no-PII) / flag-gate / read-only.
 *
 * This is the VERIFICATION GATE for the route's auth + read pattern. It proves:
 *   - Flag OFF (default) → 404-style, BEFORE any auth/DB work (a true no-op).
 *   - Flag ON + SELF → reads via the RLS-scoped server client; NEVER calls
 *     `canAccessStudent` and NEVER uses the service-role client.
 *   - Flag ON + CROSS-student → `canAccessStudent` is the HARD boundary FIRST;
 *     false → 403 with NO payload; true → service-role read + a prediction.
 *   - `subject` unresolvable → 400.
 *   - Fail-soft: a sub-read throwing does not 500 — the composer still returns.
 *   - Read-only: the route source contains no `.insert/.update/.upsert/.delete`.
 *
 * The PURE composer + cognitive-engine run REAL; only the route's collaborators
 * (flag, rbac, both supabase clients, memory, pulse-server, logger) are stubbed.
 * Mocking mirrors the sanctioned Pulse route pattern
 * (src/__tests__/api/pulse/pulse-authorization.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Hoisted, controllable mock holders ────────────────────────────────
const holders = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockAuthorize: vi.fn(),
  mockCanAccessStudent: vi.fn(),
  mockHasAnyPermission: vi.fn(),
  mockLogAudit: vi.fn(),
  mockCreateServerClient: vi.fn(),
  mockGetSupabaseAdmin: vi.fn(),
  mockGetStudentMemory: vi.fn(),
  mockBuildSinglePulse: vi.fn(),
  // per-table canned reads for the in-memory query builder
  tables: {} as Record<string, unknown>,
}));

vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => holders.mockIsFeatureEnabled(...a),
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
  canAccessStudent: (...a: unknown[]) => holders.mockCanAccessStudent(...a),
  hasAnyPermission: (...a: unknown[]) => holders.mockHasAnyPermission(...a),
  logAudit: (...a: unknown[]) => holders.mockLogAudit(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: (...a: unknown[]) => holders.mockCreateServerClient(...a),
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: (...a: unknown[]) => holders.mockGetSupabaseAdmin(...a),
}));

vi.mock('@alfanumrik/lib/pulse/pulse-server', () => ({
  buildSingleStudentPulse: (...a: unknown[]) => holders.mockBuildSinglePulse(...a),
}));

vi.mock('@/lib/memory/student-memory', () => ({
  getStudentMemory: (...a: unknown[]) => holders.mockGetStudentMemory(...a),
}));

// ── In-memory query builder (select-only; per-table canned data / errors) ─────
// `holders.tables[t]` may be: a plain {data} object, an array (for awaited
// list reads), or an Error instance (to simulate a throwing sub-read).
function makeClient() {
  return {
    from(table: string) {
      const canned = holders.tables[table];
      const isErr = canned instanceof Error;
      const settle = () =>
        isErr ? Promise.reject(canned) : Promise.resolve({ data: canned ?? null, error: null });
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => settle(),
        // thenable so `await db.from(x).select().eq()...` (list reads) resolves.
        then: (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => settle().then(onF, onR),
      };
      return builder;
    },
  };
}

// ── Fixture IDs (valid RFC4122 v4) ────────────────────────────────────
const CALLER_AUTH = '11111111-1111-4111-a111-111111111111';
const SELF_STUDENT = '22222222-2222-4222-a222-222222222222';
const SELF_AUTH = '11111111-1111-4111-a111-111111111111'; // caller == self student's auth
const OTHER_STUDENT = '33333333-3333-4333-a333-333333333333';
const OTHER_AUTH = '99999999-9999-4999-a999-999999999999';

function req(query = '') {
  return new Request(`http://localhost/api/predict/outcome${query}`, {
    headers: { Authorization: 'Bearer fake.jwt' },
  }) as unknown as import('next/server').NextRequest;
}

function authOk(over: Record<string, unknown> = {}) {
  holders.mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: CALLER_AUTH,
    studentId: SELF_STUDENT,
    roles: ['student'],
    permissions: [],
    ...over,
  });
}

/** A board row that makes the composer land on tier-1 for a happy path. */
function boardRow() {
  return {
    subject_code: 'math',
    grade: '10',
    predicted_pct: 72,
    confidence_band_low: 62,
    confidence_band_high: 82,
    coverage_pct: 85,
    recovery_plan: [],
    max_score: 80,
    score_date: '2026-01-01',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.tables = {};
  holders.mockIsFeatureEnabled.mockResolvedValue(true);
  holders.mockHasAnyPermission.mockResolvedValue(true);
  holders.mockCanAccessStudent.mockResolvedValue(true);
  holders.mockCreateServerClient.mockResolvedValue(makeClient());
  holders.mockGetSupabaseAdmin.mockReturnValue(makeClient());
  holders.mockGetStudentMemory.mockResolvedValue({
    cognitive: { weakTopics: [], knowledgeGaps: [] },
  });
  holders.mockBuildSinglePulse.mockResolvedValue({ signals: null });
});

async function loadGET() {
  const mod = await import('@/app/api/predict/outcome/route');
  return mod.GET;
}

// ════════════════════════════════════════════════════════════════════════════
// FLAG GATE (default OFF)
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/predict/outcome — flag gate', () => {
  it('flag OFF → 404-style, and NO auth / DB / memory work is done', async () => {
    holders.mockIsFeatureEnabled.mockResolvedValue(false);
    const GET = await loadGET();
    const res = await GET(req('?subject=math'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
    // Short-circuits BEFORE any auth/DB/memory work.
    expect(holders.mockAuthorize).not.toHaveBeenCalled();
    expect(holders.mockCanAccessStudent).not.toHaveBeenCalled();
    expect(holders.mockGetSupabaseAdmin).not.toHaveBeenCalled();
    expect(holders.mockCreateServerClient).not.toHaveBeenCalled();
    expect(holders.mockGetStudentMemory).not.toHaveBeenCalled();
    // No prediction ever leaks.
    expect(JSON.stringify(body)).not.toContain('boardScoreRange');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SELF PATH — RLS-scoped, never service-role, never canAccessStudent
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/predict/outcome — self path (RLS-scoped)', () => {
  it('studentId omitted → self read via RLS-scoped client; no canAccessStudent, no service role', async () => {
    authOk();
    holders.tables.students = { grade: '10', auth_user_id: SELF_AUTH };
    holders.tables.board_score_predictions = boardRow();
    const GET = await loadGET();

    const res = await GET(req('?subject=math'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.source).toBe('board_score_predictions');
    expect(body.data.subject).toBe('math');
    expect(body.data.grade).toBe('10');
    expect(body.data.schemaVersion).toBe(1);

    // SELF: RLS server client used; cross-student boundary + service role NEVER touched.
    expect(holders.mockCreateServerClient).toHaveBeenCalledTimes(1);
    expect(holders.mockCanAccessStudent).not.toHaveBeenCalled();
    expect(holders.mockGetSupabaseAdmin).not.toHaveBeenCalled();

    // Success view audit recorded (metadata only).
    const successAudit = holders.mockLogAudit.mock.calls.find((c) => c[1]?.status === 'success');
    expect(successAudit).toBeTruthy();
  });

  it('studentId explicitly equal to own → still the SELF path (no canAccessStudent)', async () => {
    authOk();
    holders.tables.students = { grade: '10', auth_user_id: SELF_AUTH };
    holders.tables.board_score_predictions = boardRow();
    const GET = await loadGET();
    const res = await GET(req(`?subject=math&studentId=${SELF_STUDENT}`));
    expect(res.status).toBe(200);
    expect(holders.mockCanAccessStudent).not.toHaveBeenCalled();
    expect(holders.mockGetSupabaseAdmin).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CROSS-STUDENT PATH — canAccessStudent FIRST, then service role
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/predict/outcome — cross-student path (IDOR boundary, P8/P13)', () => {
  it('canAccessStudent → false → 403 with NO payload; service role never used', async () => {
    authOk({ roles: ['teacher'] });
    holders.mockCanAccessStudent.mockResolvedValue(false);
    const GET = await loadGET();

    const res = await GET(req(`?subject=math&studentId=${OTHER_STUDENT}`));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
    // The boundary was consulted with (caller, target) and it was what denied.
    expect(holders.mockCanAccessStudent).toHaveBeenCalledWith(CALLER_AUTH, OTHER_STUDENT);
    // Deny short-circuits BEFORE any service-role read or memory build.
    expect(holders.mockGetSupabaseAdmin).not.toHaveBeenCalled();
    expect(holders.mockGetStudentMemory).not.toHaveBeenCalled();
    // Denial audited with the no_relationship reason.
    const denied = holders.mockLogAudit.mock.calls.find((c) => c[1]?.status === 'denied');
    expect(denied).toBeTruthy();
    expect(denied![1].details?.reason).toBe('no_relationship');
    // No prediction shape leaks on deny.
    expect(JSON.stringify(body)).not.toContain('boardScoreRange');
    expect(JSON.stringify(body)).not.toContain('passLikelihood');
  });

  it('canAccessStudent → true → service-role read + a prediction is returned', async () => {
    authOk({ roles: ['teacher'] });
    holders.mockCanAccessStudent.mockResolvedValue(true);
    holders.tables.students = { grade: '9', auth_user_id: OTHER_AUTH };
    holders.tables.board_score_predictions = { ...boardRow(), grade: '9' };
    const GET = await loadGET();

    const res = await GET(req(`?subject=math&studentId=${OTHER_STUDENT}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.source).toBe('board_score_predictions');
    expect(body.data.grade).toBe('9');
    // CROSS: boundary passed FIRST, then the service-role client is used (not RLS).
    expect(holders.mockCanAccessStudent).toHaveBeenCalledWith(CALLER_AUTH, OTHER_STUDENT);
    expect(holders.mockGetSupabaseAdmin).toHaveBeenCalledTimes(1);
    expect(holders.mockCreateServerClient).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SUBJECT RESOLUTION + FAIL-SOFT
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/predict/outcome — subject resolution & resilience', () => {
  it('no subject param and nothing to infer one from → 400', async () => {
    authOk();
    holders.tables.students = { grade: '10', auth_user_id: SELF_AUTH };
    holders.tables.board_score_predictions = null; // no row to infer subject from
    const GET = await loadGET();
    const res = await GET(req()); // no ?subject
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('SUBJECT_REQUIRED');
  });

  it('fail-soft: throwing sub-reads still yield a 200 (insufficient_data), never a 500', async () => {
    authOk();
    holders.tables.students = { grade: '10', auth_user_id: SELF_AUTH };
    // Every optional data source throws — the composer must degrade, not 500.
    holders.tables.board_score_predictions = new Error('board read blew up');
    holders.tables.cbse_chapter_weights = new Error('weights read blew up');
    holders.tables.cme_exam_readiness = new Error('cme read blew up');
    holders.mockGetStudentMemory.mockRejectedValue(new Error('memory blew up'));
    holders.mockBuildSinglePulse.mockRejectedValue(new Error('pulse blew up'));
    const GET = await loadGET();

    const res = await GET(req('?subject=math')); // subject supplied so we get past the 400
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.source).toBe('insufficient_data');
    expect(body.data.boardScoreRange).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// READ-ONLY (belt-and-suspenders static source scan)
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/predict/outcome — read-only source guarantee', () => {
  it('the route module source contains no Supabase write methods', () => {
    const routePath = resolve(
      process.cwd(),
      'src/app/api/predict/outcome/route.ts',
    );
    const source = readFileSync(routePath, 'utf8');
    // Strip line comments so a doc mention of a word can never fail the scan
    // (the route deliberately documents that it never writes).
    const code = source.replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\.\s*insert\s*\(/);
    expect(code).not.toMatch(/\.\s*update\s*\(/);
    expect(code).not.toMatch(/\.\s*upsert\s*\(/);
    expect(code).not.toMatch(/\.\s*delete\s*\(/);
  });
});
