/**
 * /api/school-admin/modules — GET + PUT contract tests.
 *
 * Pins:
 *   - Auth gate via authorizeSchoolAdmin('school.manage_modules').
 *   - GET response shape: tenant_type + flag_enabled + modules[].
 *   - GET resolution order: override row > tenant-type default; flag-OFF
 *     short-circuits to all-enabled.
 *   - PUT validation: moduleKey enum, isEnabled boolean, config object.
 *   - PUT upsert path: invalidates cache after success.
 *   - Logger silenced.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Auth mock ─────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...args: unknown[]) => _authorizeImpl(...args),
}));
function authedAs(schoolId: string) {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    schoolId,
    permissions: ['school.manage_modules'],
  });
}

// ── Logger silencer ──────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Cache invalidation spy (we assert it fires after successful PUT) ─
const invalidateCacheSpy = vi.fn();
vi.mock('@alfanumrik/lib/modules/registry', async () => {
  const actual = await vi.importActual<typeof import('@alfanumrik/lib/modules/registry')>('@alfanumrik/lib/modules/registry');
  return {
    ...actual,
    invalidateTenantModulesCache: (...args: unknown[]) => invalidateCacheSpy(...args),
  };
});

// ── Supabase chain mock ──────────────────────────────────────────────
// Each .from(table) call records the table name and returns the right
// chain shape for the operations the route performs:
//   schools          → .select(...).eq(...).maybeSingle()
//   tenant_modules   → .select(...).eq(...)               (rows[])
//                    → .upsert(...).select(...).single()  (PUT)
//   feature_flags    → .select(...).eq(...).maybeSingle()
//
// We stash the canned response per table in `tableResults`.
const tableResults: Record<string, unknown> = {};
const upsertCalls: unknown[] = [];

function chainFor(table: string) {
  const result = () => tableResults[table] ?? { data: null, error: null };
  return {
    select: () => ({
      eq: () => Object.assign(
        // For tenant_modules.select.eq → returns array result directly
        Promise.resolve(result()),
        {
          maybeSingle: () => Promise.resolve(result()),
        },
      ),
    }),
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

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => chainFor(table),
  }),
}));

import { GET, PUT } from '@/app/api/school-admin/modules/route';

beforeEach(() => {
  _authorizeImpl.mockReset();
  invalidateCacheSpy.mockReset();
  upsertCalls.length = 0;
  for (const k of Object.keys(tableResults)) delete tableResults[k];
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(method: 'GET' | 'PUT', body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/school-admin/modules', {
    method,
    body: body !== undefined ? JSON.stringify(body) : null,
    headers: { 'content-type': 'application/json' },
  });
}

// ── GET ──────────────────────────────────────────────────────────────

describe('GET /api/school-admin/modules', () => {
  it('returns the catalog with registry defaults when no tenant_modules rows exist', async () => {
    authedAs('school-1');
    tableResults.schools = { data: { tenant_type: 'school' }, error: null };
    tableResults.tenant_modules = { data: [], error: null };
    tableResults.feature_flags = { data: { is_enabled: true, rollout_percentage: 100 }, error: null };

    const res = await GET(makeRequest('GET'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.tenant_type).toBe('school');
    expect(body.data.flag_enabled).toBe(true);
    expect(body.data.modules.length).toBeGreaterThan(0);
    // School defaults: lms=true, crm=false. Pin both shapes.
    const lms = body.data.modules.find((m: { key: string }) => m.key === 'lms');
    const crm = body.data.modules.find((m: { key: string }) => m.key === 'crm');
    expect(lms.isEnabled).toBe(true);
    expect(lms.isOverride).toBe(false);
    expect(crm.isEnabled).toBe(false);
    expect(crm.isOverride).toBe(false);
  });

  it('respects tenant_modules overrides on top of defaults', async () => {
    authedAs('school-1');
    tableResults.schools = { data: { tenant_type: 'school' }, error: null };
    tableResults.tenant_modules = {
      data: [
        { module_key: 'crm', is_enabled: true, config: {} },          // default false → override true
        { module_key: 'analytics', is_enabled: false, config: { foo: 1 } }, // default true → override false
      ],
      error: null,
    };
    tableResults.feature_flags = { data: { is_enabled: true, rollout_percentage: 100 }, error: null };

    const res = await GET(makeRequest('GET'));
    const body = await res.json();
    const crm = body.data.modules.find((m: { key: string }) => m.key === 'crm');
    const analytics = body.data.modules.find((m: { key: string }) => m.key === 'analytics');
    expect(crm.isEnabled).toBe(true);
    expect(crm.isOverride).toBe(true);
    expect(analytics.isEnabled).toBe(false);
    expect(analytics.isOverride).toBe(true);
    expect(analytics.config).toEqual({ foo: 1 });
  });

  it('flag OFF surfaces every module as enabled (matches runtime resolver)', async () => {
    authedAs('school-1');
    tableResults.schools = { data: { tenant_type: 'school' }, error: null };
    tableResults.tenant_modules = {
      data: [{ module_key: 'lms', is_enabled: false, config: {} }],
      error: null,
    };
    tableResults.feature_flags = { data: { is_enabled: false, rollout_percentage: 0 }, error: null };

    const res = await GET(makeRequest('GET'));
    const body = await res.json();
    expect(body.data.flag_enabled).toBe(false);
    // Even though there's an override saying lms=false, runtime returns
    // all-on while the flag is off — UI mirrors that for truthful display.
    const lms = body.data.modules.find((m: { key: string }) => m.key === 'lms');
    expect(lms.isEnabled).toBe(true);
    expect(lms.isOverride).toBe(true); // override row STILL surfaced for the badge
  });

  it('coerces an unknown DB tenant_type back to "school"', async () => {
    authedAs('school-1');
    tableResults.schools = { data: { tenant_type: 'monastery' }, error: null };
    tableResults.tenant_modules = { data: [], error: null };
    tableResults.feature_flags = { data: { is_enabled: true, rollout_percentage: 100 }, error: null };

    const res = await GET(makeRequest('GET'));
    const body = await res.json();
    expect(body.data.tenant_type).toBe('school');
  });
});

// ── PUT ──────────────────────────────────────────────────────────────

describe('PUT /api/school-admin/modules — validation', () => {
  it('rejects an unknown moduleKey', async () => {
    authedAs('school-1');
    const res = await PUT(makeRequest('PUT', { moduleKey: 'quantum_physics', isEnabled: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/moduleKey/);
    expect(upsertCalls).toHaveLength(0);
    expect(invalidateCacheSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean isEnabled', async () => {
    authedAs('school-1');
    const res = await PUT(makeRequest('PUT', { moduleKey: 'lms', isEnabled: 'yes' }));
    expect(res.status).toBe(400);
    expect(upsertCalls).toHaveLength(0);
  });

  it('rejects a non-object config', async () => {
    authedAs('school-1');
    const res = await PUT(makeRequest('PUT', { moduleKey: 'lms', isEnabled: true, config: 'not-object' }));
    expect(res.status).toBe(400);
    expect(upsertCalls).toHaveLength(0);
  });

  it('rejects an array as config', async () => {
    authedAs('school-1');
    const res = await PUT(makeRequest('PUT', { moduleKey: 'lms', isEnabled: true, config: [1, 2] }));
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/school-admin/modules — happy path', () => {
  it('upserts the tenant_modules row and invalidates cache on success', async () => {
    authedAs('school-1');
    tableResults.tenant_modules = {
      data: { module_key: 'ai_tutor', is_enabled: false, config: {} },
      error: null,
    };

    const res = await PUT(makeRequest('PUT', {
      moduleKey: 'ai_tutor',
      isEnabled: false,
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    expect(upsertCalls).toHaveLength(1);
    const call = upsertCalls[0] as { table: string; patch: Record<string, unknown> };
    expect(call.table).toBe('tenant_modules');
    expect(call.patch.school_id).toBe('school-1');
    expect(call.patch.module_key).toBe('ai_tutor');
    expect(call.patch.is_enabled).toBe(false);

    expect(invalidateCacheSpy).toHaveBeenCalledTimes(1);
    expect(invalidateCacheSpy).toHaveBeenCalledWith('school-1');
  });

  it('forwards a config object when provided', async () => {
    authedAs('school-1');
    tableResults.tenant_modules = {
      data: { module_key: 'live_classes', is_enabled: true, config: { provider: 'meet' } },
      error: null,
    };
    await PUT(makeRequest('PUT', {
      moduleKey: 'live_classes',
      isEnabled: true,
      config: { provider: 'meet' },
    }));
    expect((upsertCalls[0] as { patch: Record<string, unknown> }).patch.config).toEqual({ provider: 'meet' });
  });

  it('defaults config to {} when omitted (sparse rows)', async () => {
    authedAs('school-1');
    tableResults.tenant_modules = { data: { module_key: 'lms', is_enabled: true, config: {} }, error: null };
    await PUT(makeRequest('PUT', { moduleKey: 'lms', isEnabled: true }));
    expect((upsertCalls[0] as { patch: Record<string, unknown> }).patch.config).toEqual({});
  });
});

describe('Auth gate', () => {
  it('GET — denied auth → returns the auth helper response untouched', async () => {
    const { NextResponse } = await import('next/server');
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false,
      errorResponse: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    });
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(403);
  });

  it('PUT — denied auth → no upsert, no cache invalidation', async () => {
    const { NextResponse } = await import('next/server');
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false,
      errorResponse: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    });
    const res = await PUT(makeRequest('PUT', { moduleKey: 'lms', isEnabled: true }));
    expect(res.status).toBe(403);
    expect(upsertCalls).toHaveLength(0);
    expect(invalidateCacheSpy).not.toHaveBeenCalled();
  });
});
