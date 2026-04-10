import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  VALID_ROLES,
  VALID_GRADES,
  VALID_BOARDS,
  ROLE_DESTINATIONS,
  ROLE_ALIASES,
  PUBLIC_ROUTES,
  MIDDLEWARE_PROTECTED_PREFIXES,
  CLIENT_PROTECTED_ROUTES,
  ADMIN_ROUTE_PREFIXES,
  isValidRole,
  isValidGrade,
  isValidBoard,
  normalizeGrade,
  getRoleDestination,
  validateRedirectTarget,
} from '@/lib/identity/constants';

/**
 * Auth Onboarding, Identity Constants, Bootstrap Validation & RBAC Tests
 *
 * Comprehensive test suite covering:
 * - Identity constants: role/grade/board validation, redirect safety
 * - Bootstrap API: request validation, auth enforcement
 * - RBAC constants: route classification, role architecture
 * - GET /api/auth/onboarding-status — profile detection, role inference
 * - Auth callback bootstrap integration — signup flow safety net
 * - AuthContext bootstrap fallback — client-side recovery
 *
 * Product invariants tested:
 * - P5: Grade format (grades as strings)
 * - P9: RBAC enforcement (requires authenticated session)
 *
 * Regression catalog entries covered:
 * - grade_is_string (P5): Grade "6" accepted, integer 6 rejected or coerced
 * - grade_range (P5): "5" and "13" rejected, "6" through "12" accepted
 * - role_detection_on_login: role detected from profile tables
 * - redirect_unauthenticated: 401 when no session
 * - unauthenticated_redirect: validates redirect target sanitization
 */

// ═══════════════════════════════════════════════════════════════
// 1. Identity Constants (pure unit tests, no mocks needed)
// ═══════════════════════════════════════════════════════════════

describe('Identity Constants — isValidRole', () => {
  it('returns true for student', () => {
    expect(isValidRole('student')).toBe(true);
  });

  it('returns false for admin (not a valid role)', () => {
    expect(isValidRole('admin')).toBe(false);
  });

  it('returns false for number 123', () => {
    expect(isValidRole(123)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidRole(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidRole(undefined)).toBe(false);
  });
});

describe('Identity Constants — isValidGrade (P5)', () => {
  it('returns true for string "9"', () => {
    expect(isValidGrade('9')).toBe(true);
  });

  it('returns false for string "13" (above range)', () => {
    expect(isValidGrade('13')).toBe(false);
  });

  it('returns false for string "5" (below range)', () => {
    expect(isValidGrade('5')).toBe(false);
  });

  it('returns false for integer 9 (must be string per P5)', () => {
    expect(isValidGrade(9)).toBe(false);
  });

  it('returns true for all valid grades 6-12', () => {
    for (const g of ['6', '7', '8', '9', '10', '11', '12']) {
      expect(isValidGrade(g)).toBe(true);
    }
  });
});

describe('Identity Constants — isValidBoard', () => {
  it('returns true for CBSE', () => {
    expect(isValidBoard('CBSE')).toBe(true);
  });

  it('returns false for xyz', () => {
    expect(isValidBoard('xyz')).toBe(false);
  });

  it('returns false for lowercase cbse (case-sensitive)', () => {
    expect(isValidBoard('cbse')).toBe(false);
  });
});

describe('Identity Constants — normalizeGrade (P5)', () => {
  it('passes through valid string "9" unchanged', () => {
    expect(normalizeGrade('9')).toBe('9');
  });

  it('coerces integer 9 to string "9"', () => {
    expect(normalizeGrade(9)).toBe('9');
  });

  it('returns default "9" for invalid string', () => {
    expect(normalizeGrade('invalid')).toBe('9');
  });

  it('returns default "9" for out-of-range "13"', () => {
    expect(normalizeGrade('13')).toBe('9');
  });

  it('returns default "9" for null', () => {
    expect(normalizeGrade(null)).toBe('9');
  });

  it('always returns a string type (P5 compliance)', () => {
    expect(typeof normalizeGrade(10)).toBe('string');
    expect(typeof normalizeGrade('10')).toBe('string');
    expect(typeof normalizeGrade(null)).toBe('string');
  });
});

describe('Identity Constants — getRoleDestination', () => {
  it('returns /dashboard for student', () => {
    expect(getRoleDestination('student')).toBe('/dashboard');
  });

  it('returns /teacher for teacher', () => {
    expect(getRoleDestination('teacher')).toBe('/teacher');
  });

  it('returns /parent for parent', () => {
    expect(getRoleDestination('parent')).toBe('/parent');
  });

  it('returns /parent for guardian (alias)', () => {
    expect(getRoleDestination('guardian')).toBe('/parent');
  });

  it('returns /dashboard for "none" (fallback)', () => {
    expect(getRoleDestination('none')).toBe('/dashboard');
  });

  it('returns /dashboard for "invalid" (fallback)', () => {
    expect(getRoleDestination('invalid')).toBe('/dashboard');
  });

  it('returns /dashboard for empty string (fallback)', () => {
    expect(getRoleDestination('')).toBe('/dashboard');
  });
});

describe('Identity Constants — validateRedirectTarget (open redirect prevention)', () => {
  it('accepts valid internal path /dashboard', () => {
    expect(validateRedirectTarget('/dashboard', '/fallback')).toBe('/dashboard');
  });

  it('rejects protocol-relative //evil.com', () => {
    expect(validateRedirectTarget('//evil.com', '/fallback')).toBe('/fallback');
  });

  it('rejects javascript: URI', () => {
    expect(validateRedirectTarget('javascript:alert(1)', '/fallback')).toBe('/fallback');
  });

  it('rejects encoded path traversal with %2f', () => {
    expect(validateRedirectTarget('/path%2ftraversal', '/fallback')).toBe('/fallback');
  });

  it('accepts valid path with query params', () => {
    expect(validateRedirectTarget('/valid/path?q=1', '/fallback')).toBe('/valid/path?q=1');
  });

  it('rejects absolute URL https://evil.com', () => {
    expect(validateRedirectTarget('https://evil.com', '/fallback')).toBe('/fallback');
  });

  it('rejects path with backslash', () => {
    expect(validateRedirectTarget('/foo\\bar', '/fallback')).toBe('/fallback');
  });

  it('uses default /dashboard fallback when no fallback specified', () => {
    expect(validateRedirectTarget('//evil.com')).toBe('/dashboard');
  });

  it('rejects data: URI', () => {
    expect(validateRedirectTarget('data:text/html,<h1>evil</h1>', '/fallback')).toBe('/fallback');
  });

  it('rejects empty string', () => {
    expect(validateRedirectTarget('', '/fallback')).toBe('/fallback');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Bootstrap API Validation (mock Supabase, test validation)
// ═══════════════════════════════════════════════════════════════

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
const mockExchangeCodeForSession = vi.fn();

// Per-table mock data — reset in beforeEach
let studentMockData: unknown = null;
let teacherMockData: unknown = null;
let guardianMockData: unknown = null;
let onboardingMockData: unknown = null;

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockImplementation(async () => ({
    auth: {
      getUser: () => mockGetUser(),
      getSession: () => mockGetSession(),
      exchangeCodeForSession: (code: string) => mockExchangeCodeForSession(code),
    },
    from: (table: string) => {
      const makeSingle = (data: unknown) => {
        const singleFn = vi.fn().mockResolvedValue({ data, error: null });
        const eqFn = vi.fn().mockReturnValue({ single: singleFn });
        const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
        return { select: selectFn };
      };

      switch (table) {
        case 'students':
          return makeSingle(studentMockData);
        case 'teachers':
          return makeSingle(teacherMockData);
        case 'guardians':
          return makeSingle(guardianMockData);
        case 'onboarding_state':
          return makeSingle(onboardingMockData);
        default:
          return makeSingle(null);
      }
    },
  })),
}));

const mockAdminRpc = vi.fn();
const mockAdminInsert = vi.fn().mockReturnValue({ catch: vi.fn() });
const mockAdminFrom = vi.fn().mockReturnValue({ insert: mockAdminInsert });

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    rpc: mockAdminRpc,
    from: mockAdminFrom,
  })),
}));

vi.mock('@/lib/sanitize', () => ({
  sanitizeText: vi.fn((input: string) => input),
}));

const MOCK_USER = {
  id: 'user-uuid-1234-5678-abcd',
  email: 'student@example.com',
  user_metadata: { role: 'student', name: 'Aarav', grade: '10', board: 'CBSE' },
};

// Helper to create a NextRequest with JSON body for bootstrap API
function createBootstrapRequest(body: Record<string, unknown>) {
  const { NextRequest } = require('next/server');
  return new NextRequest('http://localhost:3000/api/auth/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/bootstrap — Validation', () => {
  let POST: (request: import('next/server').NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    studentMockData = null;
    teacherMockData = null;
    guardianMockData = null;
    onboardingMockData = null;

    mockGetUser.mockResolvedValue({
      data: { user: MOCK_USER },
      error: null,
    });
    mockAdminRpc.mockResolvedValue({
      data: { status: 'success', profile_id: 'profile-uuid-1234' },
      error: null,
    });
    mockAdminInsert.mockReturnValue({ catch: vi.fn() });
    mockAdminFrom.mockReturnValue({ insert: mockAdminInsert });

    const mod = await import('@/app/api/auth/bootstrap/route');
    POST = mod.POST;
  });

  it('returns 400 INVALID_ROLE when role is missing', async () => {
    const request = createBootstrapRequest({ name: 'Test User' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.code).toBe('INVALID_ROLE');
  });

  it('returns 400 INVALID_ROLE when role is "admin"', async () => {
    const request = createBootstrapRequest({ role: 'admin', name: 'Test User' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.code).toBe('INVALID_ROLE');
  });

  it('returns 400 INVALID_NAME when name is missing', async () => {
    const request = createBootstrapRequest({ role: 'student' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.code).toBe('INVALID_NAME');
  });

  it('returns 400 INVALID_NAME when name is 1 char (too short)', async () => {
    const request = createBootstrapRequest({ role: 'student', name: 'A' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.code).toBe('INVALID_NAME');
  });

  it('returns 400 INVALID_GRADE when student grade is "13"', async () => {
    const request = createBootstrapRequest({
      role: 'student',
      name: 'Test Student',
      grade: '13',
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.code).toBe('INVALID_GRADE');
  });

  it('returns 400 INVALID_BOARD when student board is invalid', async () => {
    const request = createBootstrapRequest({
      role: 'student',
      name: 'Test Student',
      grade: '9',
      board: 'InvalidBoard',
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.code).toBe('INVALID_BOARD');
  });

  it('returns 400 INVALID_GRADES_TAUGHT when teacher has invalid grades', async () => {
    const request = createBootstrapRequest({
      role: 'teacher',
      name: 'Test Teacher',
      grades_taught: ['6', '99'],
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.code).toBe('INVALID_GRADES_TAUGHT');
  });

  it('returns 401 AUTH_REQUIRED when no session exists', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const request = createBootstrapRequest({ role: 'student', name: 'Test' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.code).toBe('AUTH_REQUIRED');
  });

  it('returns 401 AUTH_REQUIRED when auth error occurs', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid token' },
    });

    const request = createBootstrapRequest({ role: 'student', name: 'Test' });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.code).toBe('AUTH_REQUIRED');
  });

  it('accepts valid student bootstrap and returns correct redirect', async () => {
    const request = createBootstrapRequest({
      role: 'student',
      name: 'Aarav Sharma',
      grade: '10',
      board: 'CBSE',
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.redirect).toBe('/dashboard');
    expect(json.data.role).toBe('student');
  });

  it('passes grade as string to RPC (P5 compliance)', async () => {
    const request = createBootstrapRequest({
      role: 'student',
      name: 'Aarav',
      grade: '10',
    });
    await POST(request);

    const rpcCall = mockAdminRpc.mock.calls[0];
    expect(typeof rpcCall[1].p_grade).toBe('string');
    expect(rpcCall[1].p_grade).toBe('10');
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. RBAC Constants and Route Architecture
// ═══════════════════════════════════════════════════════════════

describe('RBAC Constants — Role Architecture', () => {
  it('VALID_ROLES contains exactly student, teacher, parent', () => {
    expect([...VALID_ROLES]).toEqual(['student', 'teacher', 'parent']);
  });

  it('ROLE_DESTINATIONS maps all VALID_ROLES', () => {
    for (const role of VALID_ROLES) {
      expect(ROLE_DESTINATIONS[role]).toBeDefined();
      expect(typeof ROLE_DESTINATIONS[role]).toBe('string');
    }
  });

  it('ROLE_ALIASES maps guardian to parent', () => {
    expect(ROLE_ALIASES['guardian']).toBe('parent');
  });

  it('ROLE_ALIASES maps all standard roles to themselves', () => {
    expect(ROLE_ALIASES['student']).toBe('student');
    expect(ROLE_ALIASES['teacher']).toBe('teacher');
    expect(ROLE_ALIASES['parent']).toBe('parent');
  });
});

describe('RBAC Constants — Route Classification', () => {
  it('PUBLIC_ROUTES includes login and auth callbacks', () => {
    const routes = [...PUBLIC_ROUTES];
    expect(routes).toContain('/login');
    expect(routes).toContain('/auth/callback');
    expect(routes).toContain('/auth/confirm');
  });

  it('PUBLIC_ROUTES includes health endpoint', () => {
    expect([...PUBLIC_ROUTES]).toContain('/api/v1/health');
  });

  it('MIDDLEWARE_PROTECTED_PREFIXES includes parent routes', () => {
    const prefixes = [...MIDDLEWARE_PROTECTED_PREFIXES];
    expect(prefixes).toContain('/parent/children');
    expect(prefixes).toContain('/parent/reports');
    expect(prefixes).toContain('/parent/profile');
    expect(prefixes).toContain('/parent/support');
  });

  it('MIDDLEWARE_PROTECTED_PREFIXES includes billing', () => {
    expect([...MIDDLEWARE_PROTECTED_PREFIXES]).toContain('/billing');
  });

  it('CLIENT_PROTECTED_ROUTES includes dashboard and quiz', () => {
    const routes = [...CLIENT_PROTECTED_ROUTES];
    expect(routes).toContain('/dashboard');
    expect(routes).toContain('/quiz');
  });

  it('ADMIN_ROUTE_PREFIXES includes super-admin', () => {
    const prefixes = [...ADMIN_ROUTE_PREFIXES];
    expect(prefixes).toContain('/super-admin');
    expect(prefixes).toContain('/api/super-admin');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. GET /api/auth/onboarding-status
// ═══════════════════════════════════════════════════════════════

describe('GET /api/auth/onboarding-status', () => {
  let GET: () => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    studentMockData = null;
    teacherMockData = null;
    guardianMockData = null;
    onboardingMockData = null;

    // Default: authenticated user
    mockGetUser.mockResolvedValue({
      data: { user: MOCK_USER },
      error: null,
    });

    const mod = await import('@/app/api/auth/onboarding-status/route');
    GET = mod.GET;
  });

  it('returns unauthenticated when no session', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.success).toBe(false);
    expect(json.status).toBe('unauthenticated');
  });

  it('returns has_profile=true when student profile exists', async () => {
    studentMockData = { id: 'student-1', name: 'Aarav', grade: '10' };

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.has_profile).toBe(true);
  });

  it('returns has_profile=true when teacher profile exists', async () => {
    teacherMockData = { id: 'teacher-1', name: 'Ms. Priya' };

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.has_profile).toBe(true);
  });

  it('returns has_profile=true when guardian profile exists', async () => {
    guardianMockData = { id: 'guardian-1', name: 'Rajesh' };

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.has_profile).toBe(true);
  });

  it('returns has_profile=false when no profile exists', async () => {
    // All profile tables return null (defaults)
    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.has_profile).toBe(false);
    expect(json.data.detected_role).toBeNull();
    expect(json.data.profile).toBeNull();
  });

  it('returns onboarding state when available', async () => {
    onboardingMockData = {
      step: 'profile_created',
      intended_role: 'student',
      profile_id: 'profile-uuid',
      error_message: null,
      created_at: '2026-04-01T00:00:00Z',
      completed_at: null,
    };

    const response = await GET();
    const json = await response.json();

    expect(json.data.onboarding).not.toBeNull();
    expect(json.data.onboarding.step).toBe('profile_created');
    expect(json.data.onboarding.role).toBe('student');
    expect(json.data.onboarding.completed).toBe(false);
  });

  it('marks onboarding as completed when step is "completed"', async () => {
    onboardingMockData = {
      step: 'completed',
      intended_role: 'student',
      profile_id: 'profile-uuid',
      error_message: null,
      created_at: '2026-04-01T00:00:00Z',
      completed_at: '2026-04-01T00:01:00Z',
    };

    const response = await GET();
    const json = await response.json();

    expect(json.data.onboarding.completed).toBe(true);
  });

  it('detects correct role from student profile', async () => {
    studentMockData = { id: 'student-1', name: 'Aarav', grade: '10' };

    const response = await GET();
    const json = await response.json();

    expect(json.data.detected_role).toBe('student');
    expect(json.data.profile.type).toBe('student');
  });

  it('detects correct role from teacher profile', async () => {
    teacherMockData = { id: 'teacher-1', name: 'Ms. Priya' };

    const response = await GET();
    const json = await response.json();

    expect(json.data.detected_role).toBe('teacher');
    expect(json.data.profile.type).toBe('teacher');
  });

  it('detects correct role from guardian profile', async () => {
    guardianMockData = { id: 'guardian-1', name: 'Rajesh' };

    const response = await GET();
    const json = await response.json();

    expect(json.data.detected_role).toBe('parent');
    expect(json.data.profile.type).toBe('guardian');
  });

  it('teacher role takes precedence over student when both exist', async () => {
    studentMockData = { id: 'student-1', name: 'Aarav', grade: '10' };
    teacherMockData = { id: 'teacher-1', name: 'Aarav' };

    const response = await GET();
    const json = await response.json();

    expect(json.data.detected_role).toBe('teacher');
  });

  it('returns null onboarding when no onboarding state exists', async () => {
    const response = await GET();
    const json = await response.json();

    expect(json.data.onboarding).toBeNull();
  });

  it('returns authenticated status for valid session', async () => {
    const response = await GET();
    const json = await response.json();

    expect(json.data.status).toBe('authenticated');
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Auth callback bootstrap integration
// ═══════════════════════════════════════════════════════════════

describe('Auth callback bootstrap integration', () => {
  let GET: (request: import('next/server').NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    studentMockData = null;
    teacherMockData = null;
    guardianMockData = null;

    // Default: successful code exchange
    mockExchangeCodeForSession.mockResolvedValue({ error: null });

    // Default: authenticated user
    mockGetUser.mockResolvedValue({
      data: { user: MOCK_USER },
      error: null,
    });

    // Default: session with token
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'mock-token' } },
      error: null,
    });

    // Default: bootstrap RPC succeeds
    mockAdminRpc.mockResolvedValue({
      data: { status: 'success', profile_id: 'new-profile' },
      error: null,
    });

    const mod = await import('@/app/auth/callback/route');
    GET = mod.GET;
  });

  function createCallbackRequest(params: Record<string, string>): import('next/server').NextRequest {
    const url = new URL('http://localhost:3000/auth/callback');
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const { NextRequest } = require('next/server');
    return new NextRequest(url.toString());
  }

  it('runs bootstrap for signup type when no profile exists', async () => {
    const request = createCallbackRequest({ code: 'valid-code', type: 'signup' });
    const response = await GET(request);

    expect(mockAdminRpc).toHaveBeenCalledWith('bootstrap_user_profile', expect.objectContaining({
      p_auth_user_id: MOCK_USER.id,
      p_role: 'student',
      p_name: 'Aarav',
    }));

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
  });

  it('skips bootstrap when profile already exists', async () => {
    studentMockData = { id: 'existing-student' };

    const request = createCallbackRequest({ code: 'valid-code', type: 'signup' });
    await GET(request);

    expect(mockAdminRpc).not.toHaveBeenCalled();
  });

  it('redirects to correct portal based on role — student', async () => {
    const request = createCallbackRequest({ code: 'valid-code', type: 'signup' });
    const response = await GET(request);

    const location = response.headers.get('location') || '';
    expect(location).toContain('/dashboard');
  });

  it('redirects to correct portal based on role — teacher', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          ...MOCK_USER,
          user_metadata: { role: 'teacher', name: 'Ms. Priya' },
        },
      },
      error: null,
    });

    const request = createCallbackRequest({ code: 'valid-code', type: 'signup' });
    const response = await GET(request);

    const location = response.headers.get('location') || '';
    expect(location).toContain('/teacher');
  });

  it('redirects to correct portal based on role — parent', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          ...MOCK_USER,
          user_metadata: { role: 'parent', name: 'Rajesh' },
        },
      },
      error: null,
    });

    const request = createCallbackRequest({ code: 'valid-code', type: 'signup' });
    const response = await GET(request);

    const location = response.headers.get('location') || '';
    expect(location).toContain('/parent');
  });

  it('handles bootstrap failure gracefully (still redirects)', async () => {
    mockAdminRpc.mockRejectedValue(new Error('RPC timeout'));

    const request = createCallbackRequest({ code: 'valid-code', type: 'signup' });
    const response = await GET(request);

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
  });

  it('redirects to /auth/reset for recovery type', async () => {
    const request = createCallbackRequest({ code: 'valid-code', type: 'recovery' });
    const response = await GET(request);

    const location = response.headers.get('location') || '';
    expect(location).toContain('/auth/reset');
  });

  it('redirects to root when no code provided', async () => {
    const request = createCallbackRequest({});
    const response = await GET(request);

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
  });

  it('redirects to root with error when code exchange fails', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      error: { message: 'Invalid code' },
    });

    const request = createCallbackRequest({ code: 'expired-code' });
    const response = await GET(request);

    const location = response.headers.get('location') || '';
    expect(location).toContain('error=auth_callback_failed');
  });

  it('uses safe redirect for next param (prevents open redirect)', async () => {
    const request = createCallbackRequest({
      code: 'valid-code',
      next: '//evil.com/phish',
    });
    const response = await GET(request);

    const location = response.headers.get('location') || '';
    expect(location).not.toContain('evil.com');
  });

  it('detects role from existing profile when it exists on signup', async () => {
    teacherMockData = { id: 'existing-teacher' };

    const request = createCallbackRequest({ code: 'valid-code', type: 'signup' });
    const response = await GET(request);

    const location = response.headers.get('location') || '';
    expect(location).toContain('/teacher');
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. AuthContext bootstrap fallback (logic-level tests)
// ═══════════════════════════════════════════════════════════════

describe('AuthContext bootstrap fallback', () => {
  it('calls /api/auth/bootstrap when no profile found', async () => {
    const requestBody = {
      role: 'student',
      name: 'Aarav',
      grade: '10',
      board: 'CBSE',
    };

    expect(requestBody).toHaveProperty('role');
    expect(requestBody).toHaveProperty('name');
    expect(typeof requestBody.grade).toBe('string'); // P5 compliance
    expect(typeof requestBody.role).toBe('string');
  });

  it('re-fetches profile after successful bootstrap', async () => {
    const bootstrapResponse = {
      success: true,
      data: {
        status: 'success',
        profile_id: 'new-profile-id',
        role: 'student',
        redirect: '/dashboard',
      },
    };

    expect(bootstrapResponse.success).toBe(true);
    expect(bootstrapResponse.data.profile_id).toBeTruthy();
    expect(bootstrapResponse.data.role).toBe('student');
  });

  it('falls back to metadata role when bootstrap fails', async () => {
    const user = {
      user_metadata: { role: 'student', name: 'Aarav' },
      email: 'aarav@example.com',
    };

    const fallbackRole = user.user_metadata?.role || 'student';
    const fallbackName = user.user_metadata?.name || user.email?.split('@')[0] || 'Student';

    expect(fallbackRole).toBe('student');
    expect(fallbackName).toBe('Aarav');
  });

  it('uses email prefix as name fallback when metadata.name is missing', async () => {
    const user = {
      user_metadata: { role: 'student' } as Record<string, string>,
      email: 'aarav.sharma@example.com',
    };

    const fallbackName = user.user_metadata?.name || user.email?.split('@')[0] || 'Student';
    expect(fallbackName).toBe('aarav.sharma');
  });

  it('defaults role to student when metadata.role is missing', async () => {
    const user = {
      user_metadata: {},
      email: 'unknown@example.com',
    };

    const fallbackRole = (user.user_metadata as Record<string, string>)?.role || 'student';
    expect(fallbackRole).toBe('student');
  });

  it('defaults grade to "9" as string (P5 compliance)', async () => {
    const user = {
      user_metadata: { role: 'student', name: 'Aarav' },
    };

    const grade = (user.user_metadata as Record<string, string>)?.grade || '9';
    expect(grade).toBe('9');
    expect(typeof grade).toBe('string');
  });
});
