import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * School Admin API Routes — Unit Tests
 *
 * Tests key behaviors of school admin API routes with mocked DB calls.
 * Covers:
 *   - Reports (analytics scoped to schoolId, 401 for unauth)
 *   - Classes (GET with grade filter P5, POST validation, PATCH whitelisted fields)
 *   - Content (POST validates P6 question quality, grade as string P5)
 *
 * All Supabase calls are mocked -- never hits real DB.
 */

// ── Mock authorizeSchoolAdmin ─────────────────────────────────────────────────

const mockAuthorizeSchoolAdmin = vi.fn();
vi.mock('@/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...args: unknown[]) => mockAuthorizeSchoolAdmin(...args),
}));

// ── Mock Supabase admin ───────────────────────────────────────────────────────

// Deeply chainable mock: every non-terminal method returns the chain itself,
// terminal methods resolve with default empty data.
function createDeepChainMock(terminalValue: unknown = { data: [], error: null, count: 0 }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const chainMethods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'is', 'in', 'not', 'or', 'filter',
    'order', 'limit', 'offset',
  ];
  for (const m of chainMethods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.range = vi.fn().mockResolvedValue(terminalValue);
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

const mockFrom = vi.fn();

function resetMockChain() {
  mockFrom.mockImplementation(() => createDeepChainMock());
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

// ── Mock logger ───────────────────────────────────────────────────────────────

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const SCHOOL_ID = 'school-test-001';
const USER_ID = 'user-admin-001';

function mockAuthorized() {
  mockAuthorizeSchoolAdmin.mockResolvedValue({
    authorized: true,
    userId: USER_ID,
    schoolId: SCHOOL_ID,
    schoolAdminId: 'admin-001',
    roles: ['institution_admin'],
    permissions: ['class.manage', 'institution.view_reports', 'school.manage_content'],
  });
}

function mockUnauthorized() {
  const { NextResponse } = require('next/server');
  mockAuthorizeSchoolAdmin.mockResolvedValue({
    authorized: false,
    errorResponse: NextResponse.json(
      { success: false, error: 'Unauthorized', code: 'AUTH_REQUIRED' },
      { status: 401 }
    ),
  });
}

function makeRequest(
  url: string,
  method = 'GET',
  body?: Record<string, unknown>
): NextRequest {
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(new URL(url, 'https://test.alfanumrik.com'), init);
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS ROUTE
// ═══════════════════════════════════════════════════════════════════════════════

describe('School Admin Reports API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resetMockChain();
  });

  it('returns 401 for unauthenticated requests', async () => {
    mockUnauthorized();

    const { GET } = await import('@/app/api/school-admin/reports/route');
    const req = makeRequest('/api/school-admin/reports?type=school_overview');
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 400 for invalid report type', async () => {
    mockAuthorized();

    const { GET } = await import('@/app/api/school-admin/reports/route');
    const req = makeRequest('/api/school-admin/reports?type=invalid_type');
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid report type');
  });

  it('returns school_overview report with empty student data', async () => {
    mockAuthorized();

    // The schoolOverviewReport first queries students. If empty, returns early
    // with zero metrics. We make the chain awaitable by making it thenable.
    mockFrom.mockImplementation(() => {
      const chain = createDeepChainMock();
      // Make the chain itself thenable for direct await resolution
      Object.defineProperty(chain, 'then', {
        value: (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 }),
        writable: true,
        configurable: true,
      });
      return chain;
    });

    const { GET } = await import('@/app/api/school-admin/reports/route');
    const req = makeRequest('/api/school-admin/reports?type=school_overview');
    const res = await GET(req);

    // Should succeed with empty data
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // When no students exist, the route returns zero metrics
    expect(body.data.total_students).toBe(0);
    expect(body.data.total_quizzes).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLASSES ROUTE
// ═══════════════════════════════════════════════════════════════════════════════

describe('School Admin Classes API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resetMockChain();
  });

  // ── GET ────────────────────────────────────────────────────────────────────

  describe('GET /api/school-admin/classes', () => {
    it('returns 401 for unauthenticated requests', async () => {
      mockUnauthorized();

      const { GET } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes');
      const res = await GET(req);

      expect(res.status).toBe(401);
    });

    it('calls from("classes") when filtering by grade (P5)', async () => {
      mockAuthorized();

      // Build chain that supports .select().eq().is().order().order().range()
      const classesChain = createDeepChainMock();
      (classesChain.range as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: [{ id: 'cls-1', name: '8A', grade: '8', section: 'A', is_active: true }],
        error: null,
        count: 1,
      });
      const enrollmentsChain = createDeepChainMock();
      // Make enrollments chain thenable for the .eq('is_active', true) await
      Object.defineProperty(enrollmentsChain, 'then', {
        value: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
        writable: true,
        configurable: true,
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'classes') return classesChain;
        if (table === 'class_enrollments') return enrollmentsChain;
        return createDeepChainMock();
      });

      const { GET } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes?grade=8');
      const res = await GET(req);

      expect(mockFrom).toHaveBeenCalledWith('classes');
    });
  });

  // ── POST ───────────────────────────────────────────────────────────────────

  describe('POST /api/school-admin/classes', () => {
    it('rejects when name is missing', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes', 'POST', {
        grade: '8',
        // name intentionally omitted
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      // Actual: "Class name is required"
      expect(body.error).toContain('name');
      expect(body.error).toContain('required');
    });

    it('rejects when grade and section are missing', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes', 'POST', {
        name: 'Class 8A',
        // grade and section intentionally omitted
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('required');
    });

    it('rejects out-of-range grade "5" (P5: must be "6"-"12")', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes', 'POST', {
        name: 'Class 5A',
        grade: '5',
        section: 'A',
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      // Actual: 'Grade must be "6" through "12"'
      expect(body.error).toContain('Grade');
    });

    it('accepts valid class creation with grade as string', async () => {
      mockAuthorized();

      // Mock successful insert chain: .insert().select().single()
      const classesChain = createDeepChainMock();
      (classesChain.single as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: {
          id: 'cls-new',
          name: 'Class 8A',
          grade: '8',
          section: 'A',
          is_active: true,
          created_at: '2026-04-16T00:00:00Z',
        },
        error: null,
      });
      mockFrom.mockImplementation(() => classesChain);

      const { POST } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes', 'POST', {
        name: 'Class 8A',
        grade: '8',
        section: 'A',
      });
      const res = await POST(req);

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });

  // ── PATCH ──────────────────────────────────────────────────────────────────

  describe('PATCH /api/school-admin/classes', () => {
    it('rejects when all update fields are non-whitelisted', async () => {
      mockAuthorized();

      const { PATCH } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes', 'PATCH', {
        id: 'cls-1',
        updates: {
          school_id: 'hacker-school', // not in whitelist -- stripped
          grade: '10', // not in whitelist -- stripped
        },
      });
      const res = await PATCH(req);

      // Route checks for empty sanitizedUpdates after stripping and returns 400
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Allowed fields');
    });

    it('allows whitelisted fields: name, section, subject, is_active, max_students, academic_year', async () => {
      mockAuthorized();
      mockFrom.mockImplementation(() => createDeepChainMock());

      const { PATCH } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes', 'PATCH', {
        id: 'cls-1',
        updates: {
          name: 'Updated Name',
        },
      });
      const res = await PATCH(req);

      expect(res.status).not.toBe(400);
    });

    it('requires class ID', async () => {
      mockAuthorized();

      const { PATCH } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes', 'PATCH', {
        updates: { name: 'New Name' },
      });
      const res = await PATCH(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      // Actual: "Class ID is required"
      expect(body.error).toContain('Class ID');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONTENT ROUTE — P6 Question Quality Validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('School Admin Content API — P6 Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resetMockChain();
  });

  const validQuestion = {
    subject: 'Mathematics',
    grade: '8',
    topic: 'Algebra',
    question_text: 'What is the value of x in the equation 2x + 5 = 15?',
    options: ['5', '10', '15', '20'],
    correct_answer_index: 0,
    explanation: 'Solving 2x + 5 = 15: subtract 5 from both sides to get 2x = 10, then divide by 2 to get x = 5.',
    difficulty: 'medium',
    bloom_level: 'apply',
  };

  describe('POST /api/school-admin/content', () => {
    it('returns 401 for unauthenticated requests', async () => {
      mockUnauthorized();

      const { POST } = await import('@/app/api/school-admin/content/route');
      const req = makeRequest('/api/school-admin/content', 'POST', validQuestion);
      const res = await POST(req);

      expect(res.status).toBe(401);
    });

    it('rejects empty question_text (P6)', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/content/route');
      const req = makeRequest('/api/school-admin/content', 'POST', {
        ...validQuestion,
        question_text: '',
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.validation_errors).toBeDefined();
      expect(body.validation_errors.some((e: { field: string }) => e.field === 'question_text')).toBe(true);
    });

    it('rejects question_text containing {{ template markers (P6)', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/content/route');
      const req = makeRequest('/api/school-admin/content', 'POST', {
        ...validQuestion,
        question_text: 'What is the value of {{variable}} in the equation?',
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.validation_errors.some((e: { field: string }) => e.field === 'question_text')).toBe(true);
    });

    it('rejects question_text containing [BLANK] placeholder (P6)', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/content/route');
      const req = makeRequest('/api/school-admin/content', 'POST', {
        ...validQuestion,
        question_text: 'Fill in the [BLANK] for the following equation to be valid.',
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.validation_errors.some((e: { field: string }) => e.field === 'question_text')).toBe(true);
    });

    it('rejects options with fewer than 4 items (P6)', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/content/route');
      const req = makeRequest('/api/school-admin/content', 'POST', {
        ...validQuestion,
        options: ['A', 'B', 'C'], // only 3
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.validation_errors.some((e: { field: string }) => e.field === 'options')).toBe(true);
    });

    it('rejects options with empty strings (P6)', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/content/route');
      const req = makeRequest('/api/school-admin/content', 'POST', {
        ...validQuestion,
        options: ['A', '', 'C', 'D'],
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.validation_errors.some((e: { field: string }) => e.field === 'options')).toBe(true);
    });

    it('rejects options with duplicate values (P6)', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/content/route');
      const req = makeRequest('/api/school-admin/content', 'POST', {
        ...validQuestion,
        options: ['5', '5', '10', '15'], // duplicate '5'
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.validation_errors.some((e: { field: string }) => e.field === 'options')).toBe(true);
    });

    it('rejects correct_answer_index outside 0-3 (P6)', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/content/route');
      const req = makeRequest('/api/school-admin/content', 'POST', {
        ...validQuestion,
        correct_answer_index: 4,
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.validation_errors.some((e: { field: string }) => e.field === 'correct_answer_index')).toBe(true);
    });

    it('rejects empty explanation (P6)', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/content/route');
      const req = makeRequest('/api/school-admin/content', 'POST', {
        ...validQuestion,
        explanation: '',
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.validation_errors.some((e: { field: string }) => e.field === 'explanation')).toBe(true);
    });

    it('rejects invalid difficulty (P6)', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/content/route');
      const req = makeRequest('/api/school-admin/content', 'POST', {
        ...validQuestion,
        difficulty: 'super_hard', // not in easy/medium/hard
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.validation_errors.some((e: { field: string }) => e.field === 'difficulty')).toBe(true);
    });

    it('rejects invalid bloom_level (P6)', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/content/route');
      const req = makeRequest('/api/school-admin/content', 'POST', {
        ...validQuestion,
        bloom_level: 'memorize', // not in valid bloom levels
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.validation_errors.some((e: { field: string }) => e.field === 'bloom_level')).toBe(true);
    });

    it('rejects invalid grade format (P5: must be string "6"-"12")', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/content/route');
      const req = makeRequest('/api/school-admin/content', 'POST', {
        ...validQuestion,
        grade: '5', // below range
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.validation_errors.some((e: { field: string }) => e.field === 'grade')).toBe(true);
    });

    it('rejects grade "13" (P5: out of range)', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/content/route');
      const req = makeRequest('/api/school-admin/content', 'POST', {
        ...validQuestion,
        grade: '13',
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.validation_errors.some((e: { field: string }) => e.field === 'grade')).toBe(true);
    });

    it('accepts a valid question with all required fields (P5+P6)', async () => {
      mockAuthorized();

      // Mock: .from('school_questions').insert(rows).select(...) resolves
      const contentChain = createDeepChainMock();
      // The route awaits the .select() result (no .single()), so make the
      // chain thenable after .select()
      Object.defineProperty(contentChain, 'then', {
        value: (resolve: (v: unknown) => void) => resolve({
          data: [{ id: 'q-new', ...validQuestion, approved: false }],
          error: null,
        }),
        writable: true,
        configurable: true,
      });
      mockFrom.mockImplementation(() => contentChain);

      const { POST } = await import('@/app/api/school-admin/content/route');
      const req = makeRequest('/api/school-admin/content', 'POST', validQuestion);
      const res = await POST(req);

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.created_count).toBe(1);
    });

    it('rejects bulk upload exceeding 100 questions', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/content/route');
      const questions = Array.from({ length: 101 }, () => validQuestion);
      const req = makeRequest('/api/school-admin/content', 'POST', { questions });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('100');
    });
  });
});
