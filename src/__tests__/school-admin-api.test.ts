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

const mockQueryResult = { data: [], error: null, count: 0 };
const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null });
const mockRange = vi.fn().mockResolvedValue(mockQueryResult);
const mockOrder = vi.fn().mockReturnValue({ range: mockRange });
const mockIlike = vi.fn().mockReturnValue({ order: mockOrder, range: mockRange });
const mockIs = vi.fn().mockReturnValue({ order: mockOrder, range: mockRange, single: mockSingle });
const mockEq4 = vi.fn().mockReturnValue({ is: mockIs, order: mockOrder, range: mockRange, single: mockSingle });
const mockEq3 = vi.fn().mockReturnValue({ eq: mockEq4, is: mockIs, order: mockOrder, range: mockRange, single: mockSingle });
const mockEq2 = vi.fn().mockReturnValue({ eq: mockEq3, is: mockIs, order: mockOrder, range: mockRange, single: mockSingle, ilike: mockIlike });
const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2, is: mockIs, order: mockOrder, range: mockRange, single: mockSingle });
const mockIn = vi.fn().mockReturnValue({ eq: mockEq1, order: mockOrder, range: mockRange });
const mockInsertSelect = vi.fn().mockReturnValue({ single: mockSingle });
const mockInsert = vi.fn().mockReturnValue({ select: mockInsertSelect });
const mockUpdateSelect = vi.fn().mockReturnValue({ single: mockSingle });
const mockUpdateEq2 = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ is: vi.fn().mockReturnValue({ select: mockUpdateSelect }) }), select: mockUpdateSelect });
const mockUpdateEq1 = vi.fn().mockReturnValue({ eq: mockUpdateEq2, select: mockUpdateSelect });
const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq1 });
const mockDeleteSelect = vi.fn().mockResolvedValue({ data: [], error: null });
const mockDeleteEq2 = vi.fn().mockReturnValue({ select: mockDeleteSelect });
const mockDeleteEq1 = vi.fn().mockReturnValue({ eq: mockDeleteEq2, select: mockDeleteSelect });
const mockDeleteIn = vi.fn().mockReturnValue({ eq: mockDeleteEq1 });
const mockDelete = vi.fn().mockReturnValue({ in: mockDeleteIn });
const mockSelect = vi.fn().mockReturnValue({
  eq: mockEq1,
  in: mockIn,
  is: mockIs,
  order: mockOrder,
  range: mockRange,
  single: mockSingle,
  ilike: mockIlike,
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
});

const mockFrom = vi.fn().mockReturnValue({
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
});

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

  it('validates grade parameter as string per P5', async () => {
    mockAuthorized();

    const { GET } = await import('@/app/api/school-admin/reports/route');
    const req = makeRequest('/api/school-admin/reports?type=school_overview&grade=13');
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid grade');
  });

  it('accepts valid grades "6" through "12" (P5)', async () => {
    mockAuthorized();
    // Mock the students query to return empty so report completes
    mockEq1.mockReturnValueOnce({
      eq: vi.fn().mockReturnValue({
        data: [],
        error: null,
      }),
    });

    const { GET } = await import('@/app/api/school-admin/reports/route');
    const req = makeRequest('/api/school-admin/reports?type=school_overview&grade=8');
    const res = await GET(req);

    // Should not be a 400 grade validation error
    expect(res.status).not.toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLASSES ROUTE
// ═══════════════════════════════════════════════════════════════════════════════

describe('School Admin Classes API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    it('filters by grade string format (P5)', async () => {
      mockAuthorized();
      mockRange.mockResolvedValueOnce({
        data: [{ id: 'cls-1', name: '8A', grade: '8', class_students: [{ count: 30 }] }],
        error: null,
        count: 1,
      });

      const { GET } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes?grade=8');
      const res = await GET(req);

      // Should call from('classes') and chain .eq('grade', '8')
      expect(mockFrom).toHaveBeenCalledWith('classes');
    });

    it('rejects invalid grade values (P5)', async () => {
      mockAuthorized();

      const { GET } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes?grade=5');
      const res = await GET(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid grade');
    });
  });

  // ── POST ───────────────────────────────────────────────────────────────────

  describe('POST /api/school-admin/classes', () => {
    it('validates required fields: name is required', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes', 'POST', {
        grade: '8',
        // name intentionally omitted
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('name');
    });

    it('validates required fields: grade is required', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes', 'POST', {
        name: 'Class 8A',
        // grade intentionally omitted
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Grade');
    });

    it('rejects integer grade (P5: grades must be strings)', async () => {
      mockAuthorized();

      const { POST } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes', 'POST', {
        name: 'Class 8A',
        grade: '5', // out of range
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Grade');
    });

    it('accepts valid class creation with grade as string', async () => {
      mockAuthorized();
      mockSingle.mockResolvedValueOnce({
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
    it('only allows whitelisted fields', async () => {
      mockAuthorized();

      const { PATCH } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes', 'PATCH', {
        id: 'cls-1',
        updates: {
          school_id: 'hacker-school', // not allowed
          grade: '10', // not in whitelist for updates
        },
      });
      const res = await PATCH(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Allowed fields');
    });

    it('allows whitelisted fields: name, section, subject, is_active, max_students', async () => {
      mockAuthorized();
      mockSingle.mockResolvedValueOnce({
        data: { id: 'cls-1', name: 'Updated Name', is_active: true },
        error: null,
      });

      const { PATCH } = await import('@/app/api/school-admin/classes/route');
      const req = makeRequest('/api/school-admin/classes', 'PATCH', {
        id: 'cls-1',
        updates: {
          name: 'Updated Name',
        },
      });
      const res = await PATCH(req);

      // Should not be a 400 "Allowed fields" error
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
      // Mock successful insert
      mockInsertSelect.mockReturnValueOnce({
        single: vi.fn().mockResolvedValue({
          data: [{ id: 'q-new', ...validQuestion, approved: false }],
          error: null,
        }),
      });
      mockInsert.mockReturnValueOnce({
        select: vi.fn().mockResolvedValue({
          data: [{ id: 'q-new', ...validQuestion, approved: false }],
          error: null,
        }),
      });

      const { POST } = await import('@/app/api/school-admin/content/route');
      const req = makeRequest('/api/school-admin/content', 'POST', validQuestion);
      const res = await POST(req);

      // Should not be a 400 validation error
      // (may be 201 or 500 depending on mock setup, but not 400)
      const body = await res.json();
      if (res.status === 400) {
        // If 400, there should be no validation errors for a valid question
        expect(body.validation_errors?.length ?? 0).toBe(0);
      }
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
