import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Student Profile Proxy API tests
 *
 * Tests the /api/super-admin/students/[id]/profile route handler.
 */

// ─── Mocks ────────────────────────────────────────────────────

const mockAuthorizeAdmin = vi.fn();
const mockSupabaseFrom = vi.fn();

vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => mockAuthorizeAdmin(...args),
  logAdminAudit: vi.fn(),
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

const adminAuth = {
  authorized: true,
  userId: 'auth-user-1',
  adminId: '22222222-2222-2222-2222-222222222222',
  email: 'admin@test.com',
  name: 'Test Admin',
  adminLevel: 'super_admin',
};

function makeRequest(): Request {
  return new Request(
    `http://localhost/api/super-admin/students/${STUDENT_ID}/profile`,
    { method: 'GET' }
  );
}

const params = Promise.resolve({ id: STUDENT_ID });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('@/app/api/super-admin/students/[id]/profile/route');
  GET = mod.GET;
});

// ─── Chain builder for Supabase query mocks ──────────────────

function chainMock(resolveValue: { data: unknown; error: unknown }) {
  const chain: any = {};
  const methods = ['select', 'eq', 'neq', 'is', 'gt', 'not', 'order', 'limit', 'in', 'single'];
  for (const m of methods) {
    chain[m] = (..._args: unknown[]) => chain;
  }
  // Make it thenable so Promise.all resolves it
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(resolveValue).then(resolve, reject);
  return chain;
}

// ─── Tests ────────────────────────────────────────────────────

describe('GET /api/super-admin/students/[id]/profile', () => {
  it('returns 401 when not authorized', async () => {
    mockAuthorizeAdmin.mockResolvedValue({
      authorized: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });

    const res = await GET(makeRequest() as any, { params });
    expect(res.status).toBe(401);
  });

  it('returns 404 when student does not exist', async () => {
    mockAuthorizeAdmin.mockResolvedValue(adminAuth);

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'students') {
        return chainMock({ data: null, error: { message: 'Not found' } });
      }
      // All other tables return empty arrays
      return chainMock({ data: [], error: null });
    });

    const res = await GET(makeRequest() as any, { params });
    expect(res.status).toBe(404);
  });

  it('returns aggregated profile data for existing student', async () => {
    mockAuthorizeAdmin.mockResolvedValue(adminAuth);

    const mockStudent = {
      id: STUDENT_ID,
      name: 'Test Student',
      grade: '8',
      board: 'CBSE',
      xp_total: 1500,
      streak_days: 5,
    };

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'students') {
        return chainMock({ data: mockStudent, error: null });
      }
      if (table === 'concept_mastery') {
        return chainMock({
          data: [
            {
              topic_id: 't1',
              mastery_probability: 0.85,
              mastery_level: 'proficient',
              attempts: 10,
              correct_attempts: 8,
              updated_at: '2026-04-12T10:00:00Z',
              curriculum_topics: { title: 'Algebra', subject_id: 's1', subjects: { code: 'maths' } },
            },
          ],
          error: null,
        });
      }
      if (table === 'quiz_responses') {
        return chainMock({
          data: [
            { bloom_level: 'understand' },
            { bloom_level: 'apply' },
            { bloom_level: 'understand' },
          ],
          error: null,
        });
      }
      if (table === 'student_subscriptions') {
        return chainMock({
          data: [{ plan_code: 'starter', status: 'active' }],
          error: null,
        });
      }
      // Default: empty arrays
      return chainMock({ data: [], error: null });
    });

    const res = await GET(makeRequest() as any, { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.student.name).toBe('Test Student');
    expect(json.subjectMastery.maths.topics).toBe(1);
    expect(json.subjectMastery.maths.avgMastery).toBe(85);
    expect(json.bloomDistribution.understand).toBe(2);
    expect(json.bloomDistribution.apply).toBe(1);
    expect(json.subscription.plan_code).toBe('starter');
    expect(Array.isArray(json.recentQuizzes)).toBe(true);
    expect(Array.isArray(json.knowledgeGaps)).toBe(true);
    expect(Array.isArray(json.opsEvents)).toBe(true);
  });

  it('returns 400 for invalid UUID', async () => {
    mockAuthorizeAdmin.mockResolvedValue(adminAuth);

    const badParams = Promise.resolve({ id: 'not-a-uuid' });
    const res = await GET(makeRequest() as any, { params: badParams });
    expect(res.status).toBe(400);
  });
});