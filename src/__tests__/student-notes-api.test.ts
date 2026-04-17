import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Student Support Notes API tests
 *
 * Tests the /api/super-admin/students/[id]/notes route handlers.
 * Uses mocks since the route depends on Supabase service role and admin auth.
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

function makeRequest(method: string, body?: unknown): Request {
  const url = `http://localhost/api/super-admin/students/${STUDENT_ID}/notes`;
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  return new Request(url, init);
}

const params = Promise.resolve({ id: STUDENT_ID });

// ─── Import route handlers ───────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: any;

beforeEach(async () => {
  vi.clearAllMocks();
  // Dynamic import to pick up mocks
  const mod = await import('@/app/api/super-admin/students/[id]/notes/route');
  GET = mod.GET;
  POST = mod.POST;
});

// ─── Tests ────────────────────────────────────────────────────

describe('GET /api/super-admin/students/[id]/notes', () => {
  it('returns 401 when admin is not authorized', async () => {
    mockAuthorizeAdmin.mockResolvedValue({
      authorized: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });

    const res = await GET(makeRequest('GET') as any, { params });
    expect(res.status).toBe(401);
  });

  it('returns notes array for authorized admin', async () => {
    mockAuthorizeAdmin.mockResolvedValue(adminAuth);

    const mockNotes = [
      {
        id: 'note-1',
        student_id: STUDENT_ID,
        admin_id: ADMIN_ID,
        category: 'observation',
        content: 'Student struggling with fractions',
        created_at: '2026-04-12T10:00:00Z',
      },
    ];

    // Mock notes query
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'admin_support_notes') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: mockNotes, error: null }),
            }),
          }),
        };
      }
      if (table === 'admin_users') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [{ id: ADMIN_ID, name: 'Test Admin' }],
                error: null,
              }),
          }),
        };
      }
      return { select: () => ({}) };
    });

    const res = await GET(makeRequest('GET') as any, { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.notes).toHaveLength(1);
    expect(json.notes[0].admin_name).toBe('Test Admin');
    expect(json.notes[0].content).toBe('Student struggling with fractions');
  });
});

describe('POST /api/super-admin/students/[id]/notes', () => {
  it('rejects missing content with 400', async () => {
    mockAuthorizeAdmin.mockResolvedValue(adminAuth);

    const res = await POST(makeRequest('POST', { category: 'observation' }) as any, {
      params,
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/content/i);
  });

  it('rejects invalid category with 400', async () => {
    mockAuthorizeAdmin.mockResolvedValue(adminAuth);

    const res = await POST(
      makeRequest('POST', { content: 'test note', category: 'invalid-cat' }) as any,
      { params }
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/category/i);
  });

  it('creates note and returns 201', async () => {
    mockAuthorizeAdmin.mockResolvedValue(adminAuth);

    const createdNote = {
      id: 'note-new',
      student_id: STUDENT_ID,
      admin_id: ADMIN_ID,
      category: 'support-call',
      content: 'Called parent about attendance',
      created_at: '2026-04-12T11:00:00Z',
    };

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { id: STUDENT_ID }, error: null }),
            }),
          }),
        };
      }
      if (table === 'admin_support_notes') {
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: createdNote, error: null }),
            }),
          }),
        };
      }
      return { select: () => ({}) };
    });

    const res = await POST(
      makeRequest('POST', {
        content: 'Called parent about attendance',
        category: 'support-call',
      }) as any,
      { params }
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.note.content).toBe('Called parent about attendance');
    expect(json.note.admin_name).toBe('Test Admin');
    expect(mockLogAdminAudit).toHaveBeenCalledOnce();
  });
});