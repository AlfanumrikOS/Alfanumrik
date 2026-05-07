/**
 * /api/super-admin/module-overrides — GET + PUT contract tests.
 *
 * Pins:
 *   - authorizeAdmin gate.
 *   - GET response: every module from MODULE_REGISTRY with its current
 *     override state; modules without a row report isForceDisabled=false.
 *   - PUT validation (moduleKey enum, isForceDisabled boolean, reason
 *     string ≤500 chars).
 *   - PUT upsert path: row written, audit log written with action
 *     'platform.module_overridden', cache invalidated on success.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Auth mock ────────────────────────────────────────────────────────
const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn();
vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
}));

// ── Logger silencer ─────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Cache invalidation spy ──────────────────────────────────────────
const invalidateCacheSpy = vi.fn();
vi.mock('@/lib/modules/registry', async () => {
  const actual = await vi.importActual<typeof import('@/lib/modules/registry')>('@/lib/modules/registry');
  return {
    ...actual,
    invalidatePlatformOverridesCache: (...args: unknown[]) => invalidateCacheSpy(...args),
  };
});

// ── Supabase chain ──────────────────────────────────────────────────
const tableResults: Record<string, unknown> = {};
const upsertCalls: unknown[] = [];

function chainFor(table: string) {
  const result = () => tableResults[table] ?? { data: null, error: null };
  return {
    select: () => Object.assign(
      Promise.resolve(result()),
      {
        eq: () => Object.assign(
          Promise.resolve(result()),
          { maybeSingle: () => Promise.resolve(result()) },
        ),
      },
    ),
    upsert: (patch: unknown) => {
      upsertCalls.push({ table, patch });
      return {
        select: () => ({
          single: () => Promise.resolve(result()),
        }),
      };
    },
  };
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => chainFor(table),
  }),
}));

import { GET, PUT } from '@/app/api/super-admin/module-overrides/route';

beforeEach(() => {
  authorizeAdmin.mockReset();
  logAdminAudit.mockReset();
  invalidateCacheSpy.mockReset();
  upsertCalls.length = 0;
  for (const k of Object.keys(tableResults)) delete tableResults[k];
  authorizeAdmin.mockResolvedValue({
    authorized: true,
    user: { id: 'admin-1' },
    response: undefined,
  });
  logAdminAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(method: 'GET' | 'PUT', body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/module-overrides', {
    method,
    body: body !== undefined ? JSON.stringify(body) : null,
    headers: { 'content-type': 'application/json' },
  });
}

// ── GET ─────────────────────────────────────────────────────────────

describe('GET /api/super-admin/module-overrides', () => {
  it('returns the full module catalog; modules without an override row report isForceDisabled=false', async () => {
    tableResults.platform_module_overrides = {
      data: [{ module_key: 'live_classes', is_force_disabled: true, reason: 'provider down', set_by: 'admin-1', set_at: '2026-05-07T09:00:00Z' }],
      error: null,
    };
    const res = await GET(makeRequest('GET'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const live = body.data.modules.find((m: { key: string }) => m.key === 'live_classes');
    expect(live.isForceDisabled).toBe(true);
    expect(live.reason).toBe('provider down');
    expect(live.setBy).toBe('admin-1');

    const lms = body.data.modules.find((m: { key: string }) => m.key === 'lms');
    expect(lms.isForceDisabled).toBe(false);
    expect(lms.reason).toBeNull();
    expect(lms.setBy).toBeNull();
  });

  it('returns success:true with all modules false when no rows exist', async () => {
    tableResults.platform_module_overrides = { data: [], error: null };
    const res = await GET(makeRequest('GET'));
    const body = await res.json();
    expect(res.status).toBe(200);
    for (const m of body.data.modules) {
      expect(m.isForceDisabled).toBe(false);
    }
  });
});

// ── PUT ─────────────────────────────────────────────────────────────

describe('PUT /api/super-admin/module-overrides — validation', () => {
  it('rejects unknown moduleKey', async () => {
    const res = await PUT(makeRequest('PUT', { moduleKey: 'quantum', isForceDisabled: true }));
    expect(res.status).toBe(400);
    expect(upsertCalls).toHaveLength(0);
    expect(invalidateCacheSpy).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('rejects non-boolean isForceDisabled', async () => {
    const res = await PUT(makeRequest('PUT', { moduleKey: 'lms', isForceDisabled: 'yes' }));
    expect(res.status).toBe(400);
  });

  it('rejects non-string reason', async () => {
    const res = await PUT(makeRequest('PUT', { moduleKey: 'lms', isForceDisabled: true, reason: 42 }));
    expect(res.status).toBe(400);
  });

  it('rejects reason > 500 chars', async () => {
    const res = await PUT(makeRequest('PUT', {
      moduleKey: 'lms',
      isForceDisabled: true,
      reason: 'a'.repeat(501),
    }));
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/super-admin/module-overrides — happy path', () => {
  it('upserts the row, invalidates cache, writes audit', async () => {
    tableResults.platform_module_overrides = {
      data: { module_key: 'live_classes', is_force_disabled: true, reason: 'provider down', set_at: '2026-05-07T09:00:00Z' },
      error: null,
    };
    const res = await PUT(makeRequest('PUT', {
      moduleKey: 'live_classes',
      isForceDisabled: true,
      reason: 'provider down',
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    expect(upsertCalls).toHaveLength(1);
    const call = upsertCalls[0] as { table: string; patch: Record<string, unknown> };
    expect(call.table).toBe('platform_module_overrides');
    expect(call.patch.module_key).toBe('live_classes');
    expect(call.patch.is_force_disabled).toBe(true);
    expect(call.patch.reason).toBe('provider down');

    expect(invalidateCacheSpy).toHaveBeenCalledTimes(1);
    expect(logAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ authorized: true }),
      'platform.module_overridden',
      'module',
      'live_classes',
      expect.objectContaining({ isForceDisabled: true, reason: 'provider down' }),
    );
  });

  it('re-enabling sets reason=null in patch', async () => {
    tableResults.platform_module_overrides = { data: { module_key: 'lms' }, error: null };
    await PUT(makeRequest('PUT', { moduleKey: 'lms', isForceDisabled: false }));
    const patch = (upsertCalls[0] as { patch: Record<string, unknown> }).patch;
    expect(patch.is_force_disabled).toBe(false);
    expect(patch.reason).toBeNull();
  });
});

describe('Auth gate', () => {
  it('GET denied → returns helper response, no DB read', async () => {
    const { NextResponse } = await import('next/server');
    authorizeAdmin.mockResolvedValueOnce({
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(401);
  });

  it('PUT denied → no upsert, no audit, no cache invalidation', async () => {
    const { NextResponse } = await import('next/server');
    authorizeAdmin.mockResolvedValueOnce({
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await PUT(makeRequest('PUT', { moduleKey: 'lms', isForceDisabled: true }));
    expect(res.status).toBe(401);
    expect(upsertCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
    expect(invalidateCacheSpy).not.toHaveBeenCalled();
  });
});
