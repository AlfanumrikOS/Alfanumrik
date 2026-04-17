import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * GET /api/teacher/subjects — unit tests
 *
 * Covers:
 *   - 401 when unauthenticated
 *   - Happy path: subjects_taught=['math','science'] → returns 2 active subjects
 *   - Empty/null subjects_taught → returns { subjects: [] }
 *   - Stale code (not in active master) → silently dropped
 */

// ── Generic thenable chain proxy (same pattern as diagnostic-api.test.ts) ─────
function chain(resolveWith: unknown) {
  const p = Promise.resolve(resolveWith);
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_, prop: string) {
      if (prop === 'then')        return p.then.bind(p);
      if (prop === 'catch')       return p.catch.bind(p);
      if (prop === 'finally')     return p.finally.bind(p);
      if (prop === 'single')      return () => p;
      if (prop === 'maybeSingle') return () => p;
      return () => new Proxy({} as Record<string, unknown>, handler);
    },
  };
  return new Proxy({} as Record<string, unknown>, handler);
}

// ── RBAC mock ────────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

function setAuthorized(userId = 'auth-teacher-1') {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId,
    studentId: null,
    roles: ['teacher'],
    permissions: ['class.manage'],
  });
}

function setUnauthorized(status = 401, code = 'AUTH_REQUIRED') {
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response(
      JSON.stringify({ success: false, error: code, code }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

// ── supabaseAdmin mock ───────────────────────────────────────────────────────
let _tableResults: Map<string, unknown> = new Map();

function setFromResult(table: string, result: unknown) {
  _tableResults.set(table, result);
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: (table: string) => chain(_tableResults.get(table) ?? { data: null, error: null }),
  })),
  supabaseAdmin: {
    from: (table: string) => chain(_tableResults.get(table) ?? { data: null, error: null }),
  },
}));

// ── Logger mock ──────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/teacher/subjects', {
    method: 'GET',
    headers: { Authorization: 'Bearer test-token' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _tableResults = new Map();
  setUnauthorized();
});

// =============================================================================

describe('GET /api/teacher/subjects — authentication', () => {
  it('returns 401 when user is not authenticated', async () => {
    setUnauthorized(401, 'AUTH_REQUIRED');
    const { GET } = await import('@/app/api/teacher/subjects/route');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/teacher/subjects — happy path', () => {
  beforeEach(() => {
    setAuthorized('auth-teacher-1');
  });

  it("returns 2 subjects when teacher.subjects_taught=['math','science'] and both active", async () => {
    setFromResult('teachers', {
      data: { id: 'teacher-1', subjects_taught: ['math', 'science'] },
      error: null,
    });
    setFromResult('subjects', {
      data: [
        {
          code: 'math',
          name: 'Mathematics',
          name_hi: 'गणित',
          icon: '🧮',
          color: '#F97316',
          subject_kind: 'cbse_core',
          is_active: true,
          display_order: 1,
        },
        {
          code: 'science',
          name: 'Science',
          name_hi: 'विज्ञान',
          icon: '🔬',
          color: '#7C3AED',
          subject_kind: 'cbse_core',
          is_active: true,
          display_order: 2,
        },
      ],
      error: null,
    });

    const { GET } = await import('@/app/api/teacher/subjects/route');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.subjects)).toBe(true);
    expect(body.subjects).toHaveLength(2);

    const codes = body.subjects.map((s: { code: string }) => s.code).sort();
    expect(codes).toEqual(['math', 'science']);

    // Shape assertions (matches Subject in src/lib/subjects.types.ts)
    for (const s of body.subjects) {
      expect(s).toHaveProperty('code');
      expect(s).toHaveProperty('name');
      expect(s).toHaveProperty('nameHi');
      expect(s).toHaveProperty('icon');
      expect(s).toHaveProperty('color');
      expect(s).toHaveProperty('subjectKind');
      expect(s).toHaveProperty('isCore');
      expect(s).toHaveProperty('isLocked');
      // Teacher-specific invariants
      expect(s.isLocked).toBe(false);
      expect(s.isCore).toBe(true); // both seeded as cbse_core
    }
  });
});

describe('GET /api/teacher/subjects — empty subjects_taught', () => {
  beforeEach(() => {
    setAuthorized('auth-teacher-1');
  });

  it('returns { subjects: [] } when subjects_taught is empty array', async () => {
    setFromResult('teachers', {
      data: { id: 'teacher-1', subjects_taught: [] },
      error: null,
    });
    const { GET } = await import('@/app/api/teacher/subjects/route');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.subjects).toEqual([]);
  });

  it('returns { subjects: [] } when subjects_taught is null', async () => {
    setFromResult('teachers', {
      data: { id: 'teacher-1', subjects_taught: null },
      error: null,
    });
    const { GET } = await import('@/app/api/teacher/subjects/route');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.subjects).toEqual([]);
  });
});

describe('GET /api/teacher/subjects — stale codes', () => {
  beforeEach(() => {
    setAuthorized('auth-teacher-1');
  });

  it('drops stale codes not present in active subjects master', async () => {
    // Teacher claims to teach 3 subjects, but only 'math' is active.
    setFromResult('teachers', {
      data: {
        id: 'teacher-1',
        subjects_taught: ['math', 'retired_subject', 'removed_elective'],
      },
      error: null,
    });
    setFromResult('subjects', {
      data: [
        {
          code: 'math',
          name: 'Mathematics',
          name_hi: 'गणित',
          icon: '🧮',
          color: '#F97316',
          subject_kind: 'cbse_core',
          is_active: true,
          display_order: 1,
        },
      ],
      error: null,
    });

    const { GET } = await import('@/app/api/teacher/subjects/route');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.subjects).toHaveLength(1);
    expect(body.subjects[0].code).toBe('math');
  });
});