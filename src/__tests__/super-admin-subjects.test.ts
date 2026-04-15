import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase E (Subject Governance) — Backend route smoke tests.
 *
 * Focus:
 *  - Each route exports the expected handler(s).
 *  - Each route returns 401 when authorizeAdmin denies.
 *  - Each mutation calls logAdminAudit when authorized + happy path.
 *
 * Per the agent contract: focus on authz + audit log call + status codes,
 * not DB internals. Supabase admin + REST fetch are mocked at the boundary.
 */

// ─── Shared mocks ────────────────────────────────────────────────────

const mockAuthorizeAdmin = vi.fn();
const mockLogAdminAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/admin-auth', async () => {
  const { NextResponse } = await import('next/server');
  return {
    authorizeAdmin: mockAuthorizeAdmin,
    logAdminAudit: mockLogAdminAudit,
    isValidUUID: (s: string) =>
      typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
    supabaseAdminHeaders: () => ({ apikey: 'k', Authorization: 'Bearer k' }),
    supabaseAdminUrl: (table: string, params?: string) =>
      `https://test.supabase.co/rest/v1/${table}${params ? `?${params}` : ''}`,
    NextResponse,
  };
});

// Mock supabase-admin (used by violations + students/[id]/subjects routes)
const mockRpc = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
  getSupabaseAdmin: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => fromMock(...args),
  }),
}));

// Stub the global fetch used by *Headers/*Url helpers
const originalFetch = global.fetch;

function setOkFetch(payload: unknown, status: number = 200) {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  ) as unknown as typeof fetch;
}

const AUTH_OK = {
  authorized: true as const,
  userId: '11111111-1111-1111-1111-111111111111',
  adminId: '22222222-2222-2222-2222-222222222222',
  email: 'admin@example.com',
  name: 'Test Admin',
  adminLevel: 'super',
};

const AUTH_DENIED = async () => {
  const { NextResponse } = await import('next/server');
  return {
    authorized: false as const,
    response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };
};

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = originalFetch;
});

// ─── 1. /api/super-admin/subjects (GET, POST) ────────────────────────

describe('super-admin/subjects route', () => {
  it('GET returns 401 when admin auth fails', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(await AUTH_DENIED());
    const { GET } = await import('@/app/api/super-admin/subjects/route');
    const res = await GET(jsonRequest('http://test/api/super-admin/subjects', 'GET') as any);
    expect(res.status).toBe(401);
  });

  it('POST creates a subject and writes audit log', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(AUTH_OK);
    // 1st fetch: uniqueness check (returns empty array — code free)
    // 2nd fetch: insert (returns the created row)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ code: 'physics', name: 'Physics' }]), { status: 201 })
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { POST } = await import('@/app/api/super-admin/subjects/route');
    const res = await POST(
      jsonRequest('http://test/api/super-admin/subjects', 'POST', {
        code: 'physics',
        name: 'Physics',
        subject_kind: 'core',
      }) as any
    );
    expect(res.status).toBe(201);
    expect(mockLogAdminAudit).toHaveBeenCalledWith(
      AUTH_OK,
      'subject.master.created',
      'subjects',
      'physics',
      expect.any(Object)
    );
  });

  it('POST rejects malformed snake_case', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/subjects/route');
    const res = await POST(
      jsonRequest('http://test/api/super-admin/subjects', 'POST', {
        code: 'NotSnakeCase',
        name: 'Bad',
      }) as any
    );
    expect(res.status).toBe(400);
  });
});

// ─── 2. /api/super-admin/subjects/[code] (PATCH, DELETE) ─────────────

describe('super-admin/subjects/[code] route', () => {
  it('PATCH returns 401 when admin auth fails', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(await AUTH_DENIED());
    const { PATCH } = await import('@/app/api/super-admin/subjects/[code]/route');
    const res = await PATCH(
      jsonRequest('http://test/api/super-admin/subjects/physics', 'PATCH', { name: 'X' }) as any,
      { params: Promise.resolve({ code: 'physics' }) }
    );
    expect(res.status).toBe(401);
  });

  it('DELETE soft-inactivates and writes subject.master.toggled audit', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(AUTH_OK);
    // 1st: fetch existing subject; 2nd: PATCH update
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ code: 'physics', name: 'Physics', is_active: true }]),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ code: 'physics', name: 'Physics', is_active: false }]),
          { status: 200 }
        )
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { DELETE } = await import('@/app/api/super-admin/subjects/[code]/route');
    const res = await DELETE(
      jsonRequest('http://test/api/super-admin/subjects/physics', 'DELETE') as any,
      { params: Promise.resolve({ code: 'physics' }) }
    );
    expect(res.status).toBe(200);
    expect(mockLogAdminAudit).toHaveBeenCalledWith(
      AUTH_OK,
      'subject.master.toggled',
      'subjects',
      'physics',
      expect.objectContaining({ to_active: false })
    );
  });
});

// ─── 3. /api/super-admin/subjects/grade-map (GET, PUT, DELETE) ───────

describe('super-admin/subjects/grade-map route', () => {
  it('GET returns 401 when admin auth fails', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(await AUTH_DENIED());
    const { GET } = await import('@/app/api/super-admin/subjects/grade-map/route');
    const res = await GET(
      jsonRequest('http://test/api/super-admin/subjects/grade-map', 'GET') as any
    );
    expect(res.status).toBe(401);
  });

  it('PUT upserts a row and writes audit log', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(AUTH_OK);
    // 1st: subject existence check; 2nd: upsert
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ code: 'physics' }]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: 'aaaa1111-1111-1111-1111-111111111111', grade: '11', subject_code: 'physics' }]),
          { status: 200 }
        )
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { PUT } = await import('@/app/api/super-admin/subjects/grade-map/route');
    const res = await PUT(
      jsonRequest('http://test/api/super-admin/subjects/grade-map', 'PUT', {
        grade: '11',
        subject_code: 'physics',
        stream: 'science',
        is_core: true,
        min_questions_seeded: 50,
      }) as any
    );
    expect(res.status).toBe(200);
    expect(mockLogAdminAudit).toHaveBeenCalledWith(
      AUTH_OK,
      'grade_subject_map.upserted',
      'grade_subject_map',
      expect.any(String),
      expect.any(Object)
    );
  });
});

// ─── 4. /api/super-admin/subjects/plan-access (GET, PUT, DELETE) ─────

describe('super-admin/subjects/plan-access route', () => {
  it('GET returns 401 when admin auth fails', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(await AUTH_DENIED());
    const { GET } = await import('@/app/api/super-admin/subjects/plan-access/route');
    const res = await GET(
      jsonRequest('http://test/api/super-admin/subjects/plan-access', 'GET') as any
    );
    expect(res.status).toBe(401);
  });

  it('PUT cap action updates plan max_subjects and audits', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(AUTH_OK);
    // 1st: planExists check; 2nd: PATCH update
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ plan_code: 'pro' }]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ plan_code: 'pro', max_subjects: 5 }]), { status: 200 })
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { PUT } = await import('@/app/api/super-admin/subjects/plan-access/route');
    const res = await PUT(
      jsonRequest('http://test/api/super-admin/subjects/plan-access', 'PUT', {
        action: 'cap',
        plan_code: 'pro',
        max_subjects: 5,
      }) as any
    );
    expect(res.status).toBe(200);
    expect(mockLogAdminAudit).toHaveBeenCalledWith(
      AUTH_OK,
      'subscription_plans.cap_updated',
      'subscription_plans',
      'pro',
      expect.objectContaining({ max_subjects: 5 })
    );
  });
});

// ─── 5. /api/super-admin/subjects/violations (GET) ───────────────────

describe('super-admin/subjects/violations route', () => {
  it('GET returns 401 when admin auth fails', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(await AUTH_DENIED());
    const { GET } = await import('@/app/api/super-admin/subjects/violations/route');
    const res = await GET(
      jsonRequest('http://test/api/super-admin/subjects/violations', 'GET') as any
    );
    expect(res.status).toBe(401);
  });

  it('GET returns JSON shape on happy path (RPC fallback empty)', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(AUTH_OK);
    // exec_admin_query: error so it falls back to per-student loop
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'no exec helper' } });
    // students table: empty list
    fromMock.mockReturnValueOnce({
      select: () => ({
        order: () => ({
          range: async () => ({ data: [] }),
          eq: () => ({ range: async () => ({ data: [] }) }),
        }),
      }),
    });

    const { GET } = await import('@/app/api/super-admin/subjects/violations/route');
    const res = await GET(
      jsonRequest('http://test/api/super-admin/subjects/violations?format=json', 'GET') as any
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('violations');
    expect(body).toHaveProperty('count');
    expect(Array.isArray(body.violations)).toBe(true);
  });
});

// ─── 6. /api/super-admin/students/[id]/subjects (PATCH) ──────────────

describe('super-admin/students/[id]/subjects route', () => {
  const STUDENT_ID = '33333333-3333-3333-3333-333333333333';

  it('PATCH returns 401 when admin auth fails', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(await AUTH_DENIED());
    const { PATCH } = await import('@/app/api/super-admin/students/[id]/subjects/route');
    const res = await PATCH(
      jsonRequest('http://test/api/super-admin/students/x/subjects', 'PATCH', {
        subjects: ['physics'],
        reason: 'long enough reason here',
      }) as any,
      { params: Promise.resolve({ id: STUDENT_ID }) }
    );
    expect(res.status).toBe(401);
  });

  it('PATCH rejects short reason with 400', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(AUTH_OK);
    const { PATCH } = await import('@/app/api/super-admin/students/[id]/subjects/route');
    const res = await PATCH(
      jsonRequest('http://test/api/super-admin/students/x/subjects', 'PATCH', {
        subjects: ['physics'],
        reason: 'too short',
      }) as any,
      { params: Promise.resolve({ id: STUDENT_ID }) }
    );
    expect(res.status).toBe(400);
  });

  it('PATCH happy path writes admin_edit audit', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(AUTH_OK);

    // Sequence of from() calls inside the route:
    //   1. subjects (verifySubjectsExist)
    //   2. students (.select.eq.maybeSingle)
    //   3. student_subject_enrollment (.select.eq) — before snapshot
    //   4. student_subject_enrollment (.delete.eq)  — fallback path
    //   5. student_subject_enrollment (.insert)     — fallback path
    //   6. students (.update.eq)                    — selected_subjects sync
    //   7. student_subject_enrollment (.select.eq) — after snapshot
    //
    // We force the rpc fallback by failing set_student_subjects.
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc missing' } });

    fromMock.mockImplementation((table: string) => {
      if (table === 'subjects') {
        return {
          select: () => ({
            in: async () => ({ data: [{ code: 'physics', is_active: true }] }),
          }),
        };
      }
      if (table === 'students') {
        // Returns either maybeSingle (student lookup) or update (sync)
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: STUDENT_ID,
                  grade: '11',
                  stream: 'science',
                  selected_subjects: [],
                  preferred_subject: null,
                },
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'student_subject_enrollment') {
        return {
          select: () => ({ eq: async () => ({ data: [] }) }),
          delete: () => ({ eq: async () => ({ error: null }) }),
          insert: async () => ({ error: null }),
        };
      }
      return { select: () => ({ eq: async () => ({ data: [] }) }) };
    });

    const { PATCH } = await import('@/app/api/super-admin/students/[id]/subjects/route');
    const res = await PATCH(
      jsonRequest('http://test/api/super-admin/students/x/subjects', 'PATCH', {
        subjects: ['physics'],
        preferred: 'physics',
        reason: 'student requested physics reinstatement after course change',
      }) as any,
      { params: Promise.resolve({ id: STUDENT_ID }) }
    );

    expect(res.status).toBe(200);
    expect(mockLogAdminAudit).toHaveBeenCalledWith(
      AUTH_OK,
      'subject_enrollment.admin_edit',
      'student_subject_enrollment',
      STUDENT_ID,
      expect.objectContaining({ reason: expect.any(String) })
    );
  });
});

// ─── 7. /api/super-admin/students/[id]/profile (additive subject fields) ─

describe('super-admin/students/[id]/profile route — Phase E additive fields', () => {
  const STUDENT_ID = '44444444-4444-4444-4444-444444444444';

  it('GET returns 401 when admin auth fails', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(await AUTH_DENIED());
    const { GET } = await import('@/app/api/super-admin/students/[id]/profile/route');
    const res = await GET(
      jsonRequest(`http://test/api/super-admin/students/${STUDENT_ID}/profile`, 'GET') as any,
      { params: Promise.resolve({ id: STUDENT_ID }) }
    );
    expect(res.status).toBe(401);
  });

  it('GET surfaces selected_subjects, preferred_subject, stream at top level', async () => {
    mockAuthorizeAdmin.mockResolvedValueOnce(AUTH_OK);

    // Minimal stubs for the 10 parallel queries in the route
    const studentRow = {
      id: STUDENT_ID,
      grade: '11',
      stream: 'science',
      selected_subjects: ['physics', 'chemistry'],
      preferred_subject: 'physics',
    };

    fromMock.mockImplementation((table: string) => {
      const empty = { data: [] };
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: studentRow }),
            }),
          }),
        };
      }
      if (table === 'quiz_responses') {
        return {
          select: () => ({
            eq: () => ({ not: async () => empty }),
          }),
        };
      }
      // Generic chainable that resolves to {data: []}
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        in: () => chain,
        neq: () => chain,
        then: (resolve: (v: typeof empty) => unknown) => Promise.resolve(empty).then(resolve),
      };
      return chain;
    });

    const { GET } = await import('@/app/api/super-admin/students/[id]/profile/route');
    const res = await GET(
      jsonRequest(`http://test/api/super-admin/students/${STUDENT_ID}/profile`, 'GET') as any,
      { params: Promise.resolve({ id: STUDENT_ID }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.selected_subjects).toEqual(['physics', 'chemistry']);
    expect(body.preferred_subject).toBe('physics');
    expect(body.stream).toBe('science');
  });
});
