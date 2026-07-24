/**
 * GET /api/lesson — student-facing Lesson Generation Agent route contract
 * (GenAI Phase 5b, REG-313). Flag-gate / student-self scope / read-only.
 *
 * This is the VERIFICATION GATE for the route's flag + auth + self-scope pattern.
 * It proves:
 *   - Flag OFF (default) → 404-style, BEFORE any auth / DB / memory / generation
 *     work (a true no-op; no lesson shape ever leaks).
 *   - Flag ON + student-self → resolves the CALLER'S OWN `auth.studentId`, reads
 *     grade via the RLS-scoped server client + the caller's own memory slice, and
 *     hands the generator a `LessonRequest` whose `studentId` is the caller's own
 *     (never a `?studentId` from the query — there is NO cross-student path).
 *   - Missing subject / chapter params → 400 validation.
 *   - An abstain envelope from the generator is a normal 200 (`abstained:true`).
 *   - Read-only: the route source contains no `.insert/.update/.upsert/.delete`
 *     and never imports the service-role/admin client or `canAccessStudent`.
 *
 * Only the route's collaborators (flag, rbac, supabase-server, generator, memory,
 * logger) are stubbed; the v2 envelope, the flag REGISTRY constant, and the Bloom
 * validator run REAL. Mocking mirrors the sanctioned outcome-route pattern
 * (src/__tests__/api/predict/outcome-route.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Hoisted, controllable mock holders ────────────────────────────────
const holders = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockAuthorize: vi.fn(),
  mockLogAudit: vi.fn(),
  mockCreateServerClient: vi.fn(),
  mockGetStudentMemory: vi.fn(),
  mockGenerateLessonNotes: vi.fn(),
  tables: {} as Record<string, unknown>,
}));

vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => holders.mockIsFeatureEnabled(...a),
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
  logAudit: (...a: unknown[]) => holders.mockLogAudit(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: (...a: unknown[]) => holders.mockCreateServerClient(...a),
}));

vi.mock('@alfanumrik/lib/lesson/generate-lesson', () => ({
  generateLessonNotes: (...a: unknown[]) => holders.mockGenerateLessonNotes(...a),
}));

vi.mock('@/lib/memory/student-memory', () => ({
  getStudentMemory: (...a: unknown[]) => holders.mockGetStudentMemory(...a),
}));

// ── In-memory select-only query builder (per-table canned data) ───────────────
function makeClient() {
  return {
    from(table: string) {
      const canned = holders.tables[table];
      const settle = () => Promise.resolve({ data: canned ?? null, error: null });
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => settle(),
        then: (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => settle().then(onF, onR),
      };
      return builder;
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────
const CALLER_AUTH = '11111111-1111-4111-a111-111111111111';
const SELF_STUDENT = '22222222-2222-4222-a222-222222222222';
const OTHER_STUDENT = '33333333-3333-4333-a333-333333333333';

function req(query = '') {
  return new Request(`http://localhost/api/lesson${query}`, {
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

/** A minimal StudentMemory shape that `toLessonMemoryInput` can project. */
function memoryStub() {
  return {
    cognitive: {
      masteryLevel: 'medium',
      recentMisconceptions: [],
      weakTopics: [],
      knowledgeGaps: [],
    },
    preferences: { learningStyle: null, preferredExplanationDepth: null },
  };
}

function happyNotes() {
  return {
    abstained: false,
    sections: [
      {
        kind: 'hook',
        headingEn: 'Hook',
        headingHi: 'हुक',
        bodyEn: 'body',
        bodyHi: 'शरीर',
        citations: [],
        bloomLevel: 'remember',
      },
    ],
    adaptationApplied: ['scaffolding:moderate'],
    citationsAll: [],
    meta: { confidence: 0.9 },
  };
}

function abstainNotes() {
  return {
    abstained: true,
    abstain: {
      reason: 'no_chunks_retrieved',
      suggestedAlternatives: [],
      messageEn: 'not ready',
      messageHi: 'तैयार नहीं',
    },
    sections: [],
    adaptationApplied: [],
    citationsAll: [],
    meta: {},
  };
}

const VALID_QUERY = '?subject=science&chapterNumber=3&chapterTitle=Cell%20Structure';

beforeEach(() => {
  vi.clearAllMocks();
  holders.tables = {};
  holders.mockIsFeatureEnabled.mockResolvedValue(true);
  holders.mockCreateServerClient.mockResolvedValue(makeClient());
  holders.mockGetStudentMemory.mockResolvedValue(memoryStub());
  holders.mockGenerateLessonNotes.mockResolvedValue(happyNotes());
});

async function loadGET() {
  const mod = await import('@/app/api/lesson/route');
  return mod.GET;
}

// ════════════════════════════════════════════════════════════════════════════
// FLAG GATE (default OFF)
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/lesson — flag gate', () => {
  it('flag OFF → 404-style, and NO auth / DB / memory / generation work is done', async () => {
    holders.mockIsFeatureEnabled.mockResolvedValue(false);
    const GET = await loadGET();
    const res = await GET(req(VALID_QUERY));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
    // Short-circuits BEFORE any downstream work.
    expect(holders.mockAuthorize).not.toHaveBeenCalled();
    expect(holders.mockCreateServerClient).not.toHaveBeenCalled();
    expect(holders.mockGetStudentMemory).not.toHaveBeenCalled();
    expect(holders.mockGenerateLessonNotes).not.toHaveBeenCalled();
    // No lesson shape ever leaks.
    expect(JSON.stringify(body)).not.toContain('sections');
    expect(JSON.stringify(body)).not.toContain('adaptationApplied');
  });

  it('role-scoped flag OFF (global ON) → 404 after auth, still no generation', async () => {
    authOk();
    // First (global) read ON, second (role/user-scoped) read OFF.
    holders.mockIsFeatureEnabled.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const GET = await loadGET();
    const res = await GET(req(VALID_QUERY));
    expect(res.status).toBe(404);
    expect(holders.mockGenerateLessonNotes).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SELF PATH — student-self scope only
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/lesson — student-self path', () => {
  it('flag ON + self → generates for the caller\'s OWN studentId and returns {success, data}', async () => {
    authOk();
    holders.tables.students = { grade: '8' };
    const GET = await loadGET();

    const res = await GET(req(VALID_QUERY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.schemaVersion).toBe(1);
    expect(body.data.abstained).toBe(false);
    expect(Array.isArray(body.data.sections)).toBe(true);

    // The generator is handed the caller's OWN studentId + the parsed WHAT + grade.
    expect(holders.mockGenerateLessonNotes).toHaveBeenCalledTimes(1);
    const lessonRequest = holders.mockGenerateLessonNotes.mock.calls[0][0];
    expect(lessonRequest.studentId).toBe(SELF_STUDENT);
    expect(lessonRequest.subject).toBe('science');
    expect(lessonRequest.grade).toBe('8'); // P5 STRING
    expect(lessonRequest.chapter).toEqual({ chapterNumber: 3, chapterTitle: 'Cell Structure' });

    // Memory read is for the caller's OWN id (RLS-scoped, self only).
    expect(holders.mockGetStudentMemory).toHaveBeenCalledTimes(1);
    expect(holders.mockGetStudentMemory.mock.calls[0][0]).toBe(SELF_STUDENT);
    // RLS server client used for the grade read.
    expect(holders.mockCreateServerClient).toHaveBeenCalledTimes(1);
    // Success audit recorded (metadata only).
    const successAudit = holders.mockLogAudit.mock.calls.find((c) => c[1]?.status === 'success');
    expect(successAudit).toBeTruthy();
    expect(successAudit![1].details?.abstained).toBe(false);
  });

  it('a ?studentId for another learner is IGNORED — still serves the caller\'s own lesson', async () => {
    authOk();
    holders.tables.students = { grade: '8' };
    const GET = await loadGET();

    const res = await GET(req(`${VALID_QUERY}&studentId=${OTHER_STUDENT}`));
    expect(res.status).toBe(200);
    // The generator is STILL called with the caller's own studentId (no cross-student path).
    const lessonRequest = holders.mockGenerateLessonNotes.mock.calls[0][0];
    expect(lessonRequest.studentId).toBe(SELF_STUDENT);
    expect(lessonRequest.studentId).not.toBe(OTHER_STUDENT);
    expect(holders.mockGetStudentMemory.mock.calls[0][0]).toBe(SELF_STUDENT);
  });

  it('an abstain envelope from the generator is a normal 200 (abstained:true)', async () => {
    authOk();
    holders.tables.students = { grade: '8' };
    holders.mockGenerateLessonNotes.mockResolvedValue(abstainNotes());
    const GET = await loadGET();

    const res = await GET(req(VALID_QUERY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.abstained).toBe(true);
    expect(body.data.abstain.reason).toBe('no_chunks_retrieved');
    // The success audit records the abstain outcome.
    const successAudit = holders.mockLogAudit.mock.calls.find((c) => c[1]?.status === 'success');
    expect(successAudit![1].details?.abstained).toBe(true);
  });

  it('no student profile on the account → 404 NO_STUDENT_PROFILE, no generation', async () => {
    authOk({ studentId: null });
    const GET = await loadGET();
    const res = await GET(req(VALID_QUERY));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NO_STUDENT_PROFILE');
    expect(holders.mockGenerateLessonNotes).not.toHaveBeenCalled();
  });

  it('unresolvable grade → 404 NO_GRADE, no generation', async () => {
    authOk();
    holders.tables.students = null; // no student row → no grade
    const GET = await loadGET();
    const res = await GET(req(VALID_QUERY));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NO_GRADE');
    expect(holders.mockGenerateLessonNotes).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PARAM VALIDATION
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/lesson — WHAT validation', () => {
  beforeEach(() => {
    authOk();
    holders.tables.students = { grade: '8' };
  });

  it('missing subject → 400 SUBJECT_REQUIRED', async () => {
    const GET = await loadGET();
    const res = await GET(req('?chapterNumber=3&chapterTitle=Cells'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('SUBJECT_REQUIRED');
    expect(holders.mockGenerateLessonNotes).not.toHaveBeenCalled();
  });

  it('missing / non-positive chapterNumber → 400 CHAPTER_NUMBER_REQUIRED', async () => {
    const GET = await loadGET();
    const res = await GET(req('?subject=science&chapterTitle=Cells'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('CHAPTER_NUMBER_REQUIRED');
  });

  it('missing chapterTitle → 400 CHAPTER_TITLE_REQUIRED', async () => {
    const GET = await loadGET();
    const res = await GET(req('?subject=science&chapterNumber=3'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('CHAPTER_TITLE_REQUIRED');
  });

  it('an invalid depth enum → 400 INVALID_DEPTH', async () => {
    const GET = await loadGET();
    const res = await GET(req(`${VALID_QUERY}&depth=galactic`));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_DEPTH');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// READ-ONLY (belt-and-suspenders static source scan)
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/lesson — read-only + self-scope source guarantee', () => {
  it('the route module source has no Supabase write methods and no admin/cross-student client', () => {
    const routePath = resolve(process.cwd(), 'src/app/api/lesson/route.ts');
    const source = readFileSync(routePath, 'utf8');
    // Strip block + line comments so documented mentions can never fail the scan.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/\.\s*insert\s*\(/);
    expect(code).not.toMatch(/\.\s*update\s*\(/);
    expect(code).not.toMatch(/\.\s*upsert\s*\(/);
    expect(code).not.toMatch(/\.\s*delete\s*\(/);

    // No service-role/admin client and no cross-student boundary in the actual code.
    expect(code).not.toContain('supabase-admin');
    expect(code).not.toContain('getSupabaseAdmin');
    expect(code).not.toContain('canAccessStudent');
  });
});
