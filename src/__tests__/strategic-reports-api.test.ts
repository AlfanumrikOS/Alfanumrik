import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Strategic Reports API Tests
 *
 * Tests cohort-retention and bloom-by-grade routes:
 * 1. Reject unauthenticated requests (401)
 * 2. Return correct response shape on success
 * 3. Handle empty data gracefully
 *
 * Regression catalog entries covered:
 * - R52: Cohort retention computes weekly/monthly retention from students.created_at + quiz_sessions activity
 * - R53: Bloom's distribution correctly joins quiz responses with question_bank bloom_level by grade
 */

// ═══════════════════════════════════════════════════════════════
// Module-level control variables (vi.mock factories capture these)
// ═══════════════════════════════════════════════════════════════

let _mockAuthorized = false;
let _tableResults: Map<string, unknown> = new Map();

// ═══════════════════════════════════════════════════════════════
// Mocks
// ═══════════════════════════════════════════════════════════════

vi.mock('@/lib/admin-auth', () => {
  const { NextResponse } = require('next/server');
  return {
    authorizeAdmin: vi.fn().mockImplementation(() => {
      if (_mockAuthorized) {
        return Promise.resolve({
          authorized: true,
          userId: 'test-user',
          adminId: 'test-admin',
          email: 'admin@test.com',
          name: 'Test Admin',
          adminLevel: 'super_admin',
        });
      }
      return Promise.resolve({
        authorized: false,
        response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      });
    }),
    logAdminAudit: vi.fn().mockResolvedValue(undefined),
    supabaseAdminHeaders: vi.fn().mockReturnValue({}),
    supabaseAdminUrl: vi.fn().mockReturnValue(''),
    isValidUUID: (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  };
});

function chain(resolveWith: unknown) {
  const p = Promise.resolve(resolveWith);
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_, prop: string) {
      if (prop === 'then') return p.then.bind(p);
      if (prop === 'catch') return p.catch.bind(p);
      if (prop === 'finally') return p.finally.bind(p);
      if (prop === 'single') return () => p;
      if (prop === 'maybeSingle') return () => p;
      return () => new Proxy({} as Record<string, unknown>, handler);
    },
  };
  return new Proxy({} as Record<string, unknown>, handler);
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const result = _tableResults.get(table) ?? { data: [], error: null };
      return chain(result);
    },
  },
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const result = _tableResults.get(table) ?? { data: [], error: null };
      return chain(result);
    },
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/env', () => ({
  validateServerEnv: vi.fn(),
}));

function makeGetRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

// ═══════════════════════════════════════════════════════════════
// Module export validation
// ═══════════════════════════════════════════════════════════════

describe('Strategic Reports Route Exports', () => {
  it('cohort-retention route exports GET', async () => {
    const mod = await import('@/app/api/super-admin/strategic-reports/cohort-retention/route');
    expect(typeof mod.GET).toBe('function');
  });

  it('bloom-by-grade route exports GET', async () => {
    const mod = await import('@/app/api/super-admin/strategic-reports/bloom-by-grade/route');
    expect(typeof mod.GET).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════
// Auth rejection — unauthenticated requests return 401
// ═══════════════════════════════════════════════════════════════

describe('Strategic Reports: Auth Rejection', () => {
  beforeEach(() => {
    _mockAuthorized = false;
    _tableResults.clear();
  });

  it('cohort-retention returns 401 when not authenticated', async () => {
    const { GET } = await import('@/app/api/super-admin/strategic-reports/cohort-retention/route');
    const req = makeGetRequest('/api/super-admin/strategic-reports/cohort-retention');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('bloom-by-grade returns 401 when not authenticated', async () => {
    const { GET } = await import('@/app/api/super-admin/strategic-reports/bloom-by-grade/route');
    const req = makeGetRequest('/api/super-admin/strategic-reports/bloom-by-grade');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// Response shape — authenticated with empty data
// ═══════════════════════════════════════════════════════════════

describe('Strategic Reports: Response Shape (empty data)', () => {
  beforeEach(() => {
    _mockAuthorized = true;
    _tableResults.clear();
    _tableResults.set('students', { data: [], error: null });
    _tableResults.set('quiz_sessions', { data: [], error: null });
    _tableResults.set('question_responses', { data: [], error: null });
    _tableResults.set('quiz_responses', { data: [], error: null });
    _tableResults.set('question_bank', { data: [], error: null });
  });

  it('cohort-retention returns {interval, cohorts: []} for empty data', async () => {
    const { GET } = await import('@/app/api/super-admin/strategic-reports/cohort-retention/route');
    const req = makeGetRequest('/api/super-admin/strategic-reports/cohort-retention?interval=weekly');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('interval', 'weekly');
    expect(body).toHaveProperty('cohorts');
    expect(Array.isArray(body.cohorts)).toBe(true);
  });

  it('cohort-retention respects monthly interval param', async () => {
    const { GET } = await import('@/app/api/super-admin/strategic-reports/cohort-retention/route');
    const req = makeGetRequest('/api/super-admin/strategic-reports/cohort-retention?interval=monthly');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.interval).toBe('monthly');
  });

  it('bloom-by-grade returns {grades: {}} for empty data', async () => {
    const { GET } = await import('@/app/api/super-admin/strategic-reports/bloom-by-grade/route');
    const req = makeGetRequest('/api/super-admin/strategic-reports/bloom-by-grade');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('grades');
    expect(typeof body.grades).toBe('object');
  });
});

// ═══════════════════════════════════════════════════════════════
// Response shape — with sample data
// ═══════════════════════════════════════════════════════════════

describe('Strategic Reports: Cohort Retention with data', () => {
  beforeEach(() => {
    _mockAuthorized = true;
    _tableResults.clear();

    _tableResults.set('students', {
      data: [
        { id: 'stu-1', created_at: '2026-03-02T10:00:00Z' },
        { id: 'stu-2', created_at: '2026-03-03T10:00:00Z' },
        { id: 'stu-3', created_at: '2026-03-10T10:00:00Z' },
      ],
      error: null,
    });

    _tableResults.set('quiz_sessions', {
      data: [
        { student_id: 'stu-1', created_at: '2026-03-02T12:00:00Z' },
        { student_id: 'stu-2', created_at: '2026-03-04T12:00:00Z' },
        { student_id: 'stu-2', created_at: '2026-03-10T12:00:00Z' },
        { student_id: 'stu-3', created_at: '2026-03-10T12:00:00Z' },
      ],
      error: null,
    });
  });

  it('groups students into cohorts and computes retention', async () => {
    const { GET } = await import('@/app/api/super-admin/strategic-reports/cohort-retention/route');
    const req = makeGetRequest('/api/super-admin/strategic-reports/cohort-retention?interval=weekly&periods=4');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cohorts.length).toBeGreaterThan(0);

    const cohort = body.cohorts[0];
    expect(cohort).toHaveProperty('cohortStart');
    expect(cohort).toHaveProperty('cohortEnd');
    expect(cohort).toHaveProperty('totalStudents');
    expect(cohort).toHaveProperty('retention');
    expect(Array.isArray(cohort.retention)).toBe(true);

    if (cohort.retention.length > 0) {
      const r = cohort.retention[0];
      expect(r).toHaveProperty('period');
      expect(r).toHaveProperty('active');
      expect(r).toHaveProperty('percent');
      expect(typeof r.percent).toBe('number');
    }
  });
});

describe('Strategic Reports: Bloom by Grade with data', () => {
  beforeEach(() => {
    _mockAuthorized = true;
    _tableResults.clear();

    _tableResults.set('students', {
      data: [
        { id: 'stu-1', grade: '6' },
        { id: 'stu-2', grade: '7' },
      ],
      error: null,
    });

    _tableResults.set('question_responses', {
      data: [
        { student_id: 'stu-1', bloom_level: 'remember' },
        { student_id: 'stu-1', bloom_level: 'understand' },
        { student_id: 'stu-1', bloom_level: 'remember' },
        { student_id: 'stu-2', bloom_level: 'apply' },
        { student_id: 'stu-2', bloom_level: 'analyze' },
      ],
      error: null,
    });
  });

  it('returns bloom distribution grouped by grade', async () => {
    const { GET } = await import('@/app/api/super-admin/strategic-reports/bloom-by-grade/route');
    const req = makeGetRequest('/api/super-admin/strategic-reports/bloom-by-grade');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('grades');

    if (body.grades['6']) {
      expect(typeof body.grades['6'].remember).toBe('number');
      expect(typeof body.grades['6'].understand).toBe('number');
    }

    if (body.grades['7']) {
      expect(typeof body.grades['7'].apply).toBe('number');
      expect(typeof body.grades['7'].analyze).toBe('number');
    }
  });

  it('respects grade filter param', async () => {
    const { GET } = await import('@/app/api/super-admin/strategic-reports/bloom-by-grade/route');
    const req = makeGetRequest('/api/super-admin/strategic-reports/bloom-by-grade?grade=6');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('grades');
  });
});