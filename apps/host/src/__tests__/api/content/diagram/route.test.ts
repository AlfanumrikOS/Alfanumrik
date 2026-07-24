/**
 * POST /api/content/diagram — student-facing Content Generation Agent route
 * contract (GenAI Phase 5c, REG-314). Flag-gate / student-self scope / read-only.
 *
 * This is the VERIFICATION GATE for the route's flag + auth + self-scope + body
 * validation pattern. It proves:
 *   - Flag OFF (default) → 404-style, BEFORE any auth / DB / memory / generation
 *     work (a true no-op; no diagram shape ever leaks).
 *   - Flag ON + student-self → resolves the CALLER'S OWN `auth.studentId`, reads
 *     grade via the RLS-scoped server client + the caller's own memory slice, and
 *     hands `generateDiagram` a `DiagramRequest` whose `studentId` is the caller's
 *     own (there is NO cross-student path).
 *   - POST body validation returns 4xx (never 500) for bad input.
 *   - An abstain envelope from the generator is a normal 200 (`abstained:true`).
 *   - Response carries `Cache-Control: private, no-store`.
 *   - Read-only: the route source contains no `.insert/.update/.upsert/.delete`
 *     and never imports the service-role/admin client or `canAccessStudent`.
 *
 * Only the route's collaborators (flag, rbac, supabase-server, generator, memory,
 * logger) are stubbed; the v2 envelope + the flag REGISTRY constant run REAL.
 * Mocking mirrors the Phase-5b lesson route test harness.
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
  mockGenerateDiagram: vi.fn(),
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

vi.mock('@alfanumrik/lib/diagram/generate-diagram', () => ({
  generateDiagram: (...a: unknown[]) => holders.mockGenerateDiagram(...a),
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

function post(body: unknown, opts: { raw?: string } = {}) {
  const init: RequestInit = {
    method: 'POST',
    headers: { Authorization: 'Bearer fake.jwt', 'Content-Type': 'application/json' },
    body: opts.raw !== undefined ? opts.raw : JSON.stringify(body),
  };
  return new Request('http://localhost/api/content/diagram', init) as unknown as import('next/server').NextRequest;
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

function memoryStub() {
  return {
    cognitive: { masteryLevel: 'medium' },
    preferences: { learningStyle: null },
  };
}

function happySpec() {
  return {
    abstained: false,
    mermaidCode: 'mindmap\n  root((Cell))',
    diagramKind: 'mindmap',
    titleEn: 'The Cell',
    titleHi: 'कोशिका',
    captionEn: 'Parts',
    captionHi: 'भाग',
    citations: [],
    meta: { confidence: 0.9 },
  };
}

function abstainSpec() {
  return {
    abstained: true,
    abstain: {
      reason: 'no_chunks_retrieved',
      suggestedAlternatives: [],
      messageEn: 'not ready',
      messageHi: 'तैयार नहीं',
    },
    mermaidCode: '',
    diagramKind: 'mindmap',
    titleEn: '',
    titleHi: '',
    captionEn: '',
    captionHi: '',
    citations: [],
    meta: {},
  };
}

const VALID_BODY = {
  subject: 'science',
  chapter: { chapterNumber: 3, chapterTitle: 'Cell Structure' },
};

beforeEach(() => {
  vi.clearAllMocks();
  holders.tables = {};
  holders.mockIsFeatureEnabled.mockResolvedValue(true);
  holders.mockCreateServerClient.mockResolvedValue(makeClient());
  holders.mockGetStudentMemory.mockResolvedValue(memoryStub());
  holders.mockGenerateDiagram.mockResolvedValue(happySpec());
});

async function loadPOST() {
  const mod = await import('@/app/api/content/diagram/route');
  return mod.POST;
}

// ════════════════════════════════════════════════════════════════════════════
// FLAG GATE (default OFF)
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/content/diagram — flag gate', () => {
  it('flag OFF → 404-style, and NO auth / DB / memory / generation work is done', async () => {
    holders.mockIsFeatureEnabled.mockResolvedValue(false);
    const POST = await loadPOST();
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
    expect(holders.mockAuthorize).not.toHaveBeenCalled();
    expect(holders.mockCreateServerClient).not.toHaveBeenCalled();
    expect(holders.mockGetStudentMemory).not.toHaveBeenCalled();
    expect(holders.mockGenerateDiagram).not.toHaveBeenCalled();
    // No diagram shape ever leaks.
    expect(JSON.stringify(body)).not.toContain('mermaidCode');
    expect(JSON.stringify(body)).not.toContain('diagramKind');
  });

  it('role-scoped flag OFF (global ON) → 404 after auth, still no generation', async () => {
    authOk();
    holders.mockIsFeatureEnabled.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const POST = await loadPOST();
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(404);
    expect(holders.mockGenerateDiagram).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SELF PATH — student-self scope only
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/content/diagram — student-self path', () => {
  it("flag ON + self → generates for the caller's OWN studentId and returns {success, data}", async () => {
    authOk();
    holders.tables.students = { grade: '8' };
    const POST = await loadPOST();

    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.schemaVersion).toBe(1);
    expect(body.data.abstained).toBe(false);
    expect(body.data.diagramKind).toBe('mindmap');

    // The generator is handed the caller's OWN studentId + the parsed WHAT + grade.
    expect(holders.mockGenerateDiagram).toHaveBeenCalledTimes(1);
    const diagramRequest = holders.mockGenerateDiagram.mock.calls[0][0];
    expect(diagramRequest.studentId).toBe(SELF_STUDENT);
    expect(diagramRequest.subject).toBe('science');
    expect(diagramRequest.grade).toBe('8'); // P5 STRING
    expect(diagramRequest.chapter).toEqual({ chapterNumber: 3, chapterTitle: 'Cell Structure' });
    expect(diagramRequest.artifactType).toBe('diagram');

    // Memory read for the caller's OWN id.
    expect(holders.mockGetStudentMemory).toHaveBeenCalledTimes(1);
    expect(holders.mockGetStudentMemory.mock.calls[0][0]).toBe(SELF_STUDENT);
    expect(holders.mockCreateServerClient).toHaveBeenCalledTimes(1);

    // Cache-Control no-store (per-student personalized, freshly generated).
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');

    // Success audit recorded (metadata only).
    const successAudit = holders.mockLogAudit.mock.calls.find((c) => c[1]?.status === 'success');
    expect(successAudit).toBeTruthy();
    expect(successAudit![1].details?.abstained).toBe(false);
  });

  it('an abstain envelope from the generator is a normal 200 (abstained:true)', async () => {
    authOk();
    holders.tables.students = { grade: '8' };
    holders.mockGenerateDiagram.mockResolvedValue(abstainSpec());
    const POST = await loadPOST();

    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.abstained).toBe(true);
    expect(body.data.abstain.reason).toBe('no_chunks_retrieved');
    const successAudit = holders.mockLogAudit.mock.calls.find((c) => c[1]?.status === 'success');
    expect(successAudit![1].details?.abstained).toBe(true);
  });

  it('a diagramType hint is passed through to the generator', async () => {
    authOk();
    holders.tables.students = { grade: '8' };
    const POST = await loadPOST();
    await POST(post({ ...VALID_BODY, diagramType: 'timeline' }));
    expect(holders.mockGenerateDiagram.mock.calls[0][0].diagramType).toBe('timeline');
  });

  it('no student profile on the account → 404 NO_STUDENT_PROFILE, no generation', async () => {
    authOk({ studentId: null });
    const POST = await loadPOST();
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NO_STUDENT_PROFILE');
    expect(holders.mockGenerateDiagram).not.toHaveBeenCalled();
  });

  it('unresolvable grade → 404 NO_GRADE, no generation', async () => {
    authOk();
    holders.tables.students = null;
    const POST = await loadPOST();
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NO_GRADE');
    expect(holders.mockGenerateDiagram).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// BODY VALIDATION (4xx, never 500)
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/content/diagram — body validation', () => {
  beforeEach(() => {
    authOk();
    holders.tables.students = { grade: '8' };
  });

  it('non-JSON body → 400 INVALID_BODY', async () => {
    const POST = await loadPOST();
    const res = await POST(post(null, { raw: 'not json at all {{{' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_BODY');
    expect(holders.mockGenerateDiagram).not.toHaveBeenCalled();
  });

  it('a JSON array body → 400 INVALID_BODY', async () => {
    const POST = await loadPOST();
    const res = await POST(post([1, 2, 3]));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_BODY');
  });

  it('missing subject → 400 SUBJECT_REQUIRED', async () => {
    const POST = await loadPOST();
    const res = await POST(post({ chapter: { chapterNumber: 3, chapterTitle: 'Cells' } }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('SUBJECT_REQUIRED');
    expect(holders.mockGenerateDiagram).not.toHaveBeenCalled();
  });

  it('missing chapter object → 400 CHAPTER_REQUIRED', async () => {
    const POST = await loadPOST();
    const res = await POST(post({ subject: 'science' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('CHAPTER_REQUIRED');
  });

  it('missing / non-positive chapterNumber → 400 CHAPTER_NUMBER_REQUIRED', async () => {
    const POST = await loadPOST();
    const res = await POST(post({ subject: 'science', chapter: { chapterTitle: 'Cells' } }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('CHAPTER_NUMBER_REQUIRED');
  });

  it('missing chapterTitle → 400 CHAPTER_TITLE_REQUIRED', async () => {
    const POST = await loadPOST();
    const res = await POST(post({ subject: 'science', chapter: { chapterNumber: 3 } }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('CHAPTER_TITLE_REQUIRED');
  });

  it('an invalid diagramType enum → 400 INVALID_DIAGRAM_TYPE', async () => {
    const POST = await loadPOST();
    const res = await POST(post({ ...VALID_BODY, diagramType: 'galactic' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_DIAGRAM_TYPE');
  });

  it('an invalid language enum → 400 INVALID_LANGUAGE', async () => {
    const POST = await loadPOST();
    const res = await POST(post({ ...VALID_BODY, language: 'fr' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_LANGUAGE');
  });

  it('an out-of-scope subject for the resolved grade → 400 INVALID_SUBJECT, no generation', async () => {
    // Grade 7 is a junior band — `physics` is only offered in grades 11–12.
    // The out-of-scope pair must be rejected BEFORE the grounded generator runs.
    holders.tables.students = { grade: '7' };
    const POST = await loadPOST();
    const res = await POST(post({ ...VALID_BODY, subject: 'physics' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_SUBJECT');
    expect(holders.mockGenerateDiagram).not.toHaveBeenCalled();
    // The learner-memory read is also short-circuited (cost/latency).
    expect(holders.mockGetStudentMemory).not.toHaveBeenCalled();
  });

  it('a senior subject IS in scope for grade 11 → guard passes, generator runs', async () => {
    // Confirms the guard is grade-aware (not a blanket physics ban).
    holders.tables.students = { grade: '11' };
    const POST = await loadPOST();
    const res = await POST(post({ ...VALID_BODY, subject: 'physics' }));
    expect(res.status).toBe(200);
    expect(holders.mockGenerateDiagram).toHaveBeenCalledTimes(1);
    expect(holders.mockGenerateDiagram.mock.calls[0][0].subject).toBe('physics');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// READ-ONLY (belt-and-suspenders static source scan)
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/content/diagram — read-only + self-scope source guarantee', () => {
  it('the route module source has no Supabase write methods and no admin/cross-student client', () => {
    const routePath = resolve(process.cwd(), 'src/app/api/content/diagram/route.ts');
    const source = readFileSync(routePath, 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/\.\s*insert\s*\(/);
    expect(code).not.toMatch(/\.\s*update\s*\(/);
    expect(code).not.toMatch(/\.\s*upsert\s*\(/);
    expect(code).not.toMatch(/\.\s*delete\s*\(/);

    expect(code).not.toContain('supabase-admin');
    expect(code).not.toContain('getSupabaseAdmin');
    expect(code).not.toContain('canAccessStudent');
  });
});
