/**
 * Contract tests for GET /api/v2/student/profile.
 * Pins: auth 401 + profile.view_own, 404 when no profile, envelope shape
 * (schemaVersion 1, P5 grade string), language/plan/stream passthrough.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _authorizeImpl = vi.fn();
vi.mock('@/lib/rbac', () => ({ authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const STUDENT_A = '11111111-1111-4111-8111-111111111111';

let _identity: { ok: boolean; data: unknown } = {
  ok: true,
  data: { id: STUDENT_A, name: 'Asha', grade: '9' },
};
vi.mock('@/lib/domains/identity', () => ({
  getStudentByAuthUserId: vi.fn().mockImplementation(() => Promise.resolve(_identity)),
}));

let _extra: { data: Record<string, unknown> | null } = {
  data: { board: 'CBSE', stream: 'science', subscription_plan: 'pro', preferred_language: 'hi' },
};
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) chain[m] = () => chain;
      chain.maybeSingle = () => Promise.resolve(_extra);
      return chain;
    },
  }),
}));

function setAuthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: true, userId: 'auth-user-1', studentId: STUDENT_A,
    roles: ['student'], permissions: ['profile.view_own'],
  });
}

const req = () => new Request('http://localhost/api/v2/student/profile', { method: 'GET' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: any;
beforeEach(async () => {
  vi.clearAllMocks();
  setAuthorized();
  _identity = { ok: true, data: { id: STUDENT_A, name: 'Asha', grade: '9' } };
  _extra = { data: { board: 'CBSE', stream: 'science', subscription_plan: 'pro', preferred_language: 'hi' } };
  GET = (await import('@/app/api/v2/student/profile/route')).GET;
});

describe('GET /api/v2/student/profile', () => {
  it('returns 401 when unauthenticated', async () => {
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false, userId: null,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    expect((await GET(req())).status).toBe(401);
  });

  it('uses profile.view_own with requireStudentId', async () => {
    await GET(req());
    expect(_authorizeImpl).toHaveBeenCalledWith(
      expect.anything(), 'profile.view_own', expect.objectContaining({ requireStudentId: true }),
    );
  });

  it('returns 404 when no student profile exists', async () => {
    _identity = { ok: true, data: null };
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NO_STUDENT_PROFILE');
  });

  it('returns the profile envelope with a string grade (P5) and passthrough fields', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.schemaVersion).toBe(1);
    expect(body.data.student_id).toBe(STUDENT_A);
    expect(body.data.name).toBe('Asha');
    expect(body.data.grade).toBe('9');
    expect(typeof body.data.grade).toBe('string');
    expect(body.data.board).toBe('CBSE');
    expect(body.data.stream).toBe('science');
    expect(body.data.plan).toBe('pro');
    expect(body.data.language).toBe('hi');
  });
});
