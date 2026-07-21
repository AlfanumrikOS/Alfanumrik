/**
 * Backend Task 3.3 (RCA fix) — /api/school-admin/reports/export MUST gate on
 * `institution.export_reports`, not `institution.view_analytics` (the code it
 * incorrectly inherited from the other resolveCommandCenterContext callers).
 *
 * This test exercises the REAL `resolveCommandCenterContext` (not mocked, so
 * the permission string it is invoked with is genuinely observed) and stubs
 * only its two external seams: `authorizeRequest` (RBAC) and `@supabase/ssr`
 * (membership lookup). `authorizeRequest` is stubbed to simulate a caller who
 * holds ONLY `institution.view_analytics` — i.e. it authorizes when asked
 * about `institution.view_analytics` and DENIES (403) for any other
 * permission code. If the route still asked for `view_analytics` (the RCA
 * bug), this caller would incorrectly pass; with the fix, the route asks for
 * `institution.export_reports` and this caller correctly gets 403.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const { mockAuthorize } = vi.hoisted(() => ({ mockAuthorize: vi.fn() }));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => mockAuthorize(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@alfanumrik/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/feature-flags')>();
  return {
    ...actual,
    // Reporting-depth flag must be ON for the route to reach the permission
    // check at all (flag OFF returns 404 before auth).
    isFeatureEnabled: vi.fn().mockResolvedValue(true),
  };
});

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';

function schoolAdminsBuilder() {
  const chain = {
    select() {
      return chain;
    },
    eq() {
      return Promise.resolve({ data: [{ school_id: SCHOOL_ID }], error: null });
    },
  };
  return chain;
}

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    from(table: string) {
      if (table === 'school_admins') return schoolAdminsBuilder();
      throw new Error(`unexpected table: ${table}`);
    },
    rpc: () =>
      Promise.resolve({
        data: {
          school_id: SCHOOL_ID,
          overview: {
            class_count: 0,
            teacher_count: 0,
            student_count: 0,
            seats_purchased: 0,
            active_students: 0,
            seat_utilization_pct: null,
            avg_mastery: null,
            data_state: 'no_data',
          },
          mastery_by_grade: [],
          bloom_summary: [],
          data_state: 'no_data',
          generated_at: '2026-07-21T00:00:00.000Z',
        },
        error: null,
      }),
  }),
}));

/** Simulates a caller who holds ONLY `institution.view_analytics`. */
function authorizeAsViewAnalyticsOnly() {
  mockAuthorize.mockImplementation((_req: unknown, permission?: string) => {
    if (permission === 'institution.view_analytics') {
      return Promise.resolve({
        authorized: true,
        userId: 'admin-1',
        roles: ['school_admin'],
        permissions: ['institution.view_analytics'],
      });
    }
    return Promise.resolve({
      authorized: false,
      userId: null,
      roles: [],
      permissions: [],
      errorResponse: NextResponse.json(
        { success: false, error: 'Permission denied' },
        { status: 403 },
      ),
    });
  });
}

function req(query = ''): Request {
  return new Request(`http://localhost/api/school-admin/reports/export${query}`, {
    method: 'GET',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/school-admin/reports/export — permission code (RCA fix)', () => {
  it('403s a caller who holds only institution.view_analytics (not institution.export_reports)', async () => {
    authorizeAsViewAnalyticsOnly();
    const { GET } = await import('@/app/api/school-admin/reports/export/route');
    const res = await GET(req() as never);
    expect(res.status).toBe(403);
    // Prove the route actually asked for the export-specific code, not the
    // view-analytics code it used to inherit.
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), 'institution.export_reports');
  });

  it('succeeds (200) for a caller who holds institution.export_reports', async () => {
    mockAuthorize.mockResolvedValue({
      authorized: true,
      userId: 'admin-1',
      roles: ['school_admin'],
      permissions: ['institution.export_reports'],
    });
    const { GET } = await import('@/app/api/school-admin/reports/export/route');
    const res = await GET(req() as never);
    expect(res.status).toBe(200);
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), 'institution.export_reports');
  });
});
