/**
 * GET /api/super-admin/synthesis-health — Phase 8 item 8.4 dashboard reader.
 *
 * Pins:
 *   - Auth gate: super_admin.access — a denied result short-circuits BEFORE
 *     any DB read and returns the authorizer's errorResponse verbatim.
 *   - Happy path returns { success, data } with a trailing-24h window summary
 *     (incl. failure_rate_pct), a per-day trend, and the last 10 failures.
 *   - P13: the payload carries run ids + student ids + month + timestamps
 *     ONLY — never summary_text, bundle, phone, or student name.
 *   - DB error → 500 { success: false }.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuthorizeRequest = vi.fn();

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: mockAuthorizeRequest,
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Stub = { data: unknown; error: unknown };
let _rows: Stub = { data: [], error: null };
function setRows(s: Stub) { _rows = s; }

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      // terminal .order(...) resolves the query
      order: vi.fn(() => Promise.resolve(_rows)),
    })),
  },
}));

const AUTH_OK = {
  authorized: true as const,
  userId: '11111111-1111-1111-1111-111111111111',
  studentId: null,
  roles: ['super_admin'],
  permissions: ['super_admin.access'],
};

const AUTH_DENIED_403 = () => ({
  authorized: false as const,
  userId: '22222222-2222-2222-2222-222222222222',
  studentId: null,
  roles: ['student'],
  permissions: [],
  errorResponse: new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403, headers: { 'Content-Type': 'application/json' },
  }),
});

function makeReq(): Request {
  return new Request('http://localhost/api/super-admin/synthesis-health', { method: 'GET' });
}

function isoHoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
  _rows = { data: [], error: null };
});

describe('GET /api/super-admin/synthesis-health', () => {
  it('short-circuits with the authorizer errorResponse when denied', async () => {
    mockAuthorizeRequest.mockResolvedValue(AUTH_DENIED_403());
    const { GET } = await import('@/app/api/super-admin/synthesis-health/route');
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });

  it('computes 24h window failure_rate and last-10 failures (ids only, P13)', async () => {
    mockAuthorizeRequest.mockResolvedValue(AUTH_OK);
    setRows({
      data: [
        { id: 'run-a', student_id: 'stu-a', synthesis_month: '2026-06', parent_share_status: 'failed', created_at: isoHoursAgo(2) },
        { id: 'run-b', student_id: 'stu-b', synthesis_month: '2026-06', parent_share_status: 'failed', created_at: isoHoursAgo(3) },
        { id: 'run-c', student_id: 'stu-c', synthesis_month: '2026-06', parent_share_status: 'sent', created_at: isoHoursAgo(4) },
        { id: 'run-d', student_id: 'stu-d', synthesis_month: '2026-06', parent_share_status: 'opted_out', created_at: isoHoursAgo(5) },
      ],
      error: null,
    });
    const { GET } = await import('@/app/api/super-admin/synthesis-health/route');
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // 2 failed / (1 sent + 2 failed) = 67%
    expect(body.data.window.failure_rate_pct).toBe(67);
    expect(body.data.window.failed).toBe(2);
    expect(body.data.window.sent).toBe(1);
    expect(body.data.recentFailures).toHaveLength(2);

    // P13: only ids/month/timestamps — no summary/body/phone/name.
    const serialized = JSON.stringify(body.data);
    expect(serialized).not.toMatch(/summary_text|bundle|phone|"name"/i);
    const fail = body.data.recentFailures[0];
    expect(Object.keys(fail).sort()).toEqual(['createdAt', 'studentId', 'synthesisMonth', 'synthesisRunId']);
  });

  it('returns null failure_rate when no terminal attempts in the window', async () => {
    mockAuthorizeRequest.mockResolvedValue(AUTH_OK);
    setRows({
      data: [
        { id: 'run-p', student_id: 'stu-p', synthesis_month: '2026-06', parent_share_status: 'pending', created_at: isoHoursAgo(1) },
      ],
      error: null,
    });
    const { GET } = await import('@/app/api/super-admin/synthesis-health/route');
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.data.window.failure_rate_pct).toBeNull();
    expect(body.data.recentFailures).toHaveLength(0);
  });

  it('returns 500 on DB error', async () => {
    mockAuthorizeRequest.mockResolvedValue(AUTH_OK);
    setRows({ data: null, error: { message: 'boom' } });
    const { GET } = await import('@/app/api/super-admin/synthesis-health/route');
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
