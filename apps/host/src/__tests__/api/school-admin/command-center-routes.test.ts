/**
 * Phase 3B Wave A / A5 — Command Center read routes (unit, no DB).
 *
 * Three thin GET handlers:
 *   - /api/school-admin/overview          → get_school_overview (jsonb)
 *   - /api/school-admin/classes-at-risk   → get_classes_at_risk (TABLE)
 *   - /api/school-admin/teacher-engagement → get_teacher_engagement (TABLE)
 *
 * We mock ONLY the resolution seam: `resolveCommandCenterContext` is replaced
 * with a fake that returns a stub supabase whose `.rpc()` is controllable. The
 * pure helpers `parsePagination`, `rpcErrorResponse`, and the cache-header
 * constant are kept REAL (re-exported from the actual module) so the route's
 * pagination parse/clamp and Postgres-42501→403 mapping are genuinely
 * exercised, not stubbed.
 *
 * Covered per route:
 *   - resolution failure (401/403/400) → its response returned unchanged
 *   - RPC 42501 error → HTTP 403, no SQL/PII leak
 *   - generic RPC error → HTTP 500, no SQL/PII leak
 *   - empty result → HTTP 200 with empty array / empty snapshot
 *   - happy path → 200 with the read-model payload + cache header
 *   - pagination parse/clamp echoed onto the wire + passed to the RPC
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the resolution module. Keep parsePagination + rpcErrorResponse +
//    COMMAND_CENTER_CACHE_CONTROL REAL via importActual so the route's real
//    clamp + error mapping run. Only resolveCommandCenterContext is stubbed. ──
const { mockResolve, rpcSpy } = vi.hoisted(() => ({
  mockResolve: vi.fn(),
  rpcSpy: vi.fn(),
}));

vi.mock('@alfanumrik/lib/school-admin/command-center-context', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@alfanumrik/lib/school-admin/command-center-context')
  >();
  return {
    ...actual,
    resolveCommandCenterContext: (...args: unknown[]) => mockResolve(...args),
  };
});

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { NextResponse } from 'next/server';
import { GET as GET_OVERVIEW } from '@/app/api/school-admin/overview/route';
import { GET as GET_CLASSES } from '@/app/api/school-admin/classes-at-risk/route';
import { GET as GET_TEACHERS } from '@/app/api/school-admin/teacher-engagement/route';

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';

// ── Stub the resolved context with a controllable .rpc(). ────────────────────
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };

function resolvedOk() {
  mockResolve.mockResolvedValue({
    ok: true,
    ctx: {
      schoolId: SCHOOL_ID,
      userId: 'admin-1',
      supabase: {
        rpc: (...args: unknown[]) => {
          rpcSpy(...args);
          return Promise.resolve(rpcResult);
        },
      },
    },
  });
}

function resolvedFail(status: number, body: Record<string, unknown> = { success: false }) {
  mockResolve.mockResolvedValue({
    ok: false,
    response: NextResponse.json(body, { status }),
  });
}

function req(path: string, query = ''): Request {
  return new Request(`http://localhost${path}${query}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcResult = { data: null, error: null };
});

// ── Per-route metadata so the shared assertions stay DRY. ────────────────────
const ROUTES = [
  {
    name: 'overview',
    path: '/api/school-admin/overview',
    handler: GET_OVERVIEW,
    rpcName: 'get_school_overview',
    paginated: false,
  },
  {
    name: 'classes-at-risk',
    path: '/api/school-admin/classes-at-risk',
    handler: GET_CLASSES,
    rpcName: 'get_classes_at_risk',
    paginated: true,
  },
  {
    name: 'teacher-engagement',
    path: '/api/school-admin/teacher-engagement',
    handler: GET_TEACHERS,
    rpcName: 'get_teacher_engagement',
    paginated: true,
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Shared contract: every route propagates a resolution failure + maps errors.
// ─────────────────────────────────────────────────────────────────────────────
describe.each(ROUTES)('GET $path — resolution + error mapping', (route) => {
  it('propagates a 401 from resolveCommandCenterContext unchanged', async () => {
    resolvedFail(401);
    const res = await route.handler(req(route.path) as never);
    expect(res.status).toBe(401);
    // The RPC must never run when resolution fails.
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('propagates a 403 from resolveCommandCenterContext unchanged', async () => {
    resolvedFail(403);
    const res = await route.handler(req(route.path) as never);
    expect(res.status).toBe(403);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('propagates a 400 multi-school { school_ids } hint unchanged', async () => {
    resolvedFail(400, { success: false, error: 'Multiple schools — specify ?school_id', school_ids: ['a', 'b'] });
    const res = await route.handler(req(route.path) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.school_ids).toEqual(['a', 'b']);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('maps a Postgres 42501 RPC error to HTTP 403 (scope guard)', async () => {
    resolvedOk();
    rpcResult = { data: null, error: { code: '42501', message: 'not authorized for school' } };
    const res = await route.handler(req(route.path) as never);
    expect(res.status).toBe(403);
  });

  it('maps a generic RPC error to HTTP 500 without leaking SQL/PII', async () => {
    resolvedOk();
    rpcResult = {
      data: null,
      error: { code: '23505', message: 'duplicate key on auth_user_id=admin-PII@x.com' },
    };
    const res = await route.handler(req(route.path) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('admin-PII@x.com');
    expect(serialized).not.toContain('duplicate key');
    expect(serialized).not.toContain('23505');
  });

  it('calls the correct RPC with the resolved school id', async () => {
    resolvedOk();
    rpcResult = { data: route.paginated ? [] : {}, error: null };
    await route.handler(req(route.path) as never);
    expect(rpcSpy).toHaveBeenCalledWith(
      route.rpcName,
      expect.objectContaining({ p_school_id: SCHOOL_ID }),
    );
  });

  it('sets the private/max-age=30/swr=60 cache header on success', async () => {
    resolvedOk();
    rpcResult = { data: route.paginated ? [] : {}, error: null };
    const res = await route.handler(req(route.path) as never);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=30, stale-while-revalidate=60');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Overview-specific shape.
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/school-admin/overview — payload shape', () => {
  it('returns 200 with the live snapshot + data_state', async () => {
    resolvedOk();
    rpcResult = {
      data: {
        class_count: 4,
        teacher_count: 3,
        student_count: 40,
        seats_purchased: 50,
        active_students: 40,
        seat_utilization_pct: 80,
        avg_mastery: 0.6123,
        data_state: 'live',
      },
      error: null,
    };
    const res = await GET_OVERVIEW(req('/api/school-admin/overview') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.class_count).toBe(4);
    expect(body.data.avg_mastery).toBeCloseTo(0.6123, 4);
    expect(body.data.data_state).toBe('live');
    expect(body.data_state).toBe('live');
  });

  it('treats a null RPC result as an empty no_data snapshot (never 500s the home)', async () => {
    resolvedOk();
    rpcResult = { data: null, error: null };
    const res = await GET_OVERVIEW(req('/api/school-admin/overview') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data_state).toBe('no_data');
    expect(body.data.class_count).toBe(0);
    expect(body.data.student_count).toBe(0);
    expect(body.data.seat_utilization_pct).toBeNull();
    expect(body.data.avg_mastery).toBeNull();
  });

  it('reports no_data when the RPC returns a no_data snapshot', async () => {
    resolvedOk();
    rpcResult = {
      data: {
        class_count: 0,
        teacher_count: 0,
        student_count: 0,
        seats_purchased: 0,
        active_students: 0,
        seat_utilization_pct: null,
        avg_mastery: null,
        data_state: 'no_data',
      },
      error: null,
    };
    const res = await GET_OVERVIEW(req('/api/school-admin/overview') as never);
    const body = await res.json();
    expect(body.data_state).toBe('no_data');
  });

  it('does NOT pass pagination params to the overview RPC', async () => {
    resolvedOk();
    rpcResult = { data: {}, error: null };
    await GET_OVERVIEW(req('/api/school-admin/overview', '?limit=10&offset=5') as never);
    const [, params] = rpcSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(params).toEqual({ p_school_id: SCHOOL_ID });
    expect(params).not.toHaveProperty('p_limit');
    expect(params).not.toHaveProperty('p_offset');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// List-route shared shape: empty page + pagination parse/clamp + echo.
// ─────────────────────────────────────────────────────────────────────────────
const LIST_ROUTES = ROUTES.filter((r) => r.paginated);

describe.each(LIST_ROUTES)('GET $path — list payload + pagination', (route) => {
  it('returns 200 with an empty array when the RPC yields no rows', async () => {
    resolvedOk();
    rpcResult = { data: [], error: null };
    const res = await route.handler(req(route.path) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.count).toBe(0);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  it('treats a null RPC result as an empty page (no 500)', async () => {
    resolvedOk();
    rpcResult = { data: null, error: null };
    const res = await route.handler(req(route.path) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.count).toBe(0);
  });

  it('echoes count = rows.length on a populated page', async () => {
    resolvedOk();
    rpcResult = { data: [{ a: 1 }, { a: 2 }, { a: 3 }], error: null };
    const res = await route.handler(req(route.path) as never);
    const body = await res.json();
    expect(body.count).toBe(3);
    expect(body.data).toHaveLength(3);
  });

  it('defaults to p_limit=20, p_offset=0 when no pagination params', async () => {
    resolvedOk();
    rpcResult = { data: [], error: null };
    await route.handler(req(route.path) as never);
    expect(rpcSpy).toHaveBeenCalledWith(
      route.rpcName,
      expect.objectContaining({ p_school_id: SCHOOL_ID, p_limit: 20, p_offset: 0 }),
    );
  });

  it('clamps ?limit=500 to 100 both on the wire and at the RPC', async () => {
    resolvedOk();
    rpcResult = { data: [], error: null };
    const res = await route.handler(req(route.path, '?limit=500') as never);
    const body = await res.json();
    expect(body.limit).toBe(100);
    expect(rpcSpy).toHaveBeenCalledWith(
      route.rpcName,
      expect.objectContaining({ p_limit: 100 }),
    );
  });

  it('clamps a negative ?offset to 0', async () => {
    resolvedOk();
    rpcResult = { data: [], error: null };
    const res = await route.handler(req(route.path, '?offset=-5') as never);
    const body = await res.json();
    expect(body.offset).toBe(0);
    expect(rpcSpy).toHaveBeenCalledWith(
      route.rpcName,
      expect.objectContaining({ p_offset: 0 }),
    );
  });

  it('falls back to the default limit for a non-numeric ?limit', async () => {
    resolvedOk();
    rpcResult = { data: [], error: null };
    const res = await route.handler(req(route.path, '?limit=abc') as never);
    const body = await res.json();
    expect(body.limit).toBe(20);
  });

  it('passes a valid in-range limit/offset through to the RPC', async () => {
    resolvedOk();
    rpcResult = { data: [], error: null };
    const res = await route.handler(req(route.path, '?limit=15&offset=30') as never);
    const body = await res.json();
    expect(body.limit).toBe(15);
    expect(body.offset).toBe(30);
    expect(rpcSpy).toHaveBeenCalledWith(
      route.rpcName,
      expect.objectContaining({ p_limit: 15, p_offset: 30 }),
    );
  });
});
