import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Student Impersonation Session API tests
 *
 * Tests the /api/super-admin/students/[id]/impersonate route handlers
 * for session creation, validation, and termination.
 */

// ─── Mocks ────────────────────────────────────────────────────

const mockAuthorizeAdmin = vi.fn();
const mockLogAdminAudit = vi.fn();
const mockSupabaseFrom = vi.fn();

vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => mockAuthorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => mockLogAdminAudit(...args),
  isValidUUID: (str: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str),
}));

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────

const STUDENT_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_ID = '22222222-2222-2222-2222-222222222222';

const adminAuth = {
  authorized: true,
  userId: 'auth-user-1',
  adminId: ADMIN_ID,
  email: 'admin@test.com',
  name: 'Test Admin',
  adminLevel: 'super_admin',
};

function makeRequest(method: string): Request {
  const url = `http://localhost/api/super-admin/students/${STUDENT_ID}/impersonate`;
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
  });
}

const params = Promise.resolve({ id: STUDENT_ID });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PATCH: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import(
    '@/app/api/super-admin/students/[id]/impersonate/route'
  );
  GET = mod.GET;
  POST = mod.POST;
  PATCH = mod.PATCH;
});

// ─── Tests ────────────────────────────────────────────────────

describe('GET /api/super-admin/students/[id]/impersonate', () => {
  it('returns 401 when not authorized', async () => {
    mockAuthorizeAdmin.mockResolvedValue({
      authorized: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });

    const res = await GET(makeRequest('GET') as any, { params });
    expect(res.status).toBe(401);
  });

  it('returns active:false when no session exists', async () => {
    mockAuthorizeAdmin.mockResolvedValue(adminAuth);

    mockSupabaseFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              gt: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeRequest('GET') as any, { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.active).toBe(false);
    expect(json.session).toBeNull();
    expect(json.remainingSeconds).toBe(0);
  });

  it('returns active session with remaining seconds', async () => {
    mockAuthorizeAdmin.mockResolvedValue(adminAuth);

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min from now
    const mockSession = {
      id: 'session-1',
      admin_id: ADMIN_ID,
      student_id: STUDENT_ID,
      started_at: new Date().toISOString(),
      expires_at: expiresAt,
      pages_viewed: ['profile'],
      ip_address: '127.0.0.1',
    };

    mockSupabaseFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              gt: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: [mockSession], error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeRequest('GET') as any, { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.active).toBe(true);
    expect(json.session.id).toBe('session-1');
    expect(json.remainingSeconds).toBeGreaterThan(0);
    expect(json.remainingSeconds).toBeLessThanOrEqual(900);
  });
});

describe('POST /api/super-admin/students/[id]/impersonate', () => {
  it('creates a new impersonation session (201)', async () => {
    mockAuthorizeAdmin.mockResolvedValue(adminAuth);

    const mockSession = {
      id: 'session-new',
      admin_id: ADMIN_ID,
      student_id: STUDENT_ID,
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      pages_viewed: [],
      ip_address: null,
    };

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: { id: STUDENT_ID }, error: null }),
            }),
          }),
        };
      }
      if (table === 'admin_impersonation_sessions') {
        return {
          // For the "end existing" update call
          update: () => ({
            eq: () => ({
              is: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          // For the insert call
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: mockSession, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    const res = await POST(makeRequest('POST') as any, { params });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.session.id).toBe('session-new');
    expect(mockLogAdminAudit).toHaveBeenCalledOnce();
    const auditArgs = mockLogAdminAudit.mock.calls[0];
    expect(auditArgs[0].adminId).toBe(ADMIN_ID);
    expect(auditArgs[1]).toBe('impersonation_started');
    expect(auditArgs[2]).toBe('student');
    expect(auditArgs[3]).toBe(STUDENT_ID);
  });
});

describe('PATCH /api/super-admin/students/[id]/impersonate', () => {
  it('ends session and returns ok', async () => {
    mockAuthorizeAdmin.mockResolvedValue(adminAuth);

    mockSupabaseFrom.mockReturnValue({
      update: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              select: () =>
                Promise.resolve({
                  data: [{ id: 'session-1' }],
                  error: null,
                }),
            }),
          }),
        }),
      }),
    });

    const res = await PATCH(makeRequest('PATCH') as any, { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(mockLogAdminAudit).toHaveBeenCalledOnce();
    const auditArgs = mockLogAdminAudit.mock.calls[0];
    expect(auditArgs[0].adminId).toBe(ADMIN_ID);
    expect(auditArgs[1]).toBe('impersonation_ended');
    expect(auditArgs[2]).toBe('student');
    expect(auditArgs[3]).toBe(STUDENT_ID);
  });
});