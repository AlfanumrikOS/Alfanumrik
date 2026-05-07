/**
 * /api/school-admin/tenant-config — GET + PUT contract tests.
 *
 * Pins:
 *   - Auth via authorizeSchoolAdmin('school.manage_settings').
 *   - GET response shape: tenant_type + flag_enabled + entries[].
 *   - GET resolution order: override row > tenant-type default; flag-OFF
 *     short-circuits to defaults (matching the runtime resolver).
 *   - GET surfaces enum options for select-rendered keys.
 *   - PUT all-or-nothing: any invalid entry rejects the whole batch.
 *   - PUT validates each value with the zod schema for that key.
 *   - PUT cache invalidation fires on success.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Auth mock ─────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...args: unknown[]) => _authorizeImpl(...args),
}));
function authedAs(schoolId: string) {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    schoolId,
    permissions: ['school.manage_settings'],
  });
}

// ── Logger silencer ──────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Cache invalidation spy ───────────────────────────────────────────
const invalidateCacheSpy = vi.fn();
vi.mock('@/lib/tenant-config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tenant-config')>('@/lib/tenant-config');
  return {
    ...actual,
    invalidateTenantConfigCache: (...args: unknown[]) => invalidateCacheSpy(...args),
  };
});

// ── Supabase chain mock — same shape pattern as modules test ─────────
const tableResults: Record<string, unknown> = {};
const upsertCalls: unknown[] = [];

function chainFor(table: string) {
  const result = () => tableResults[table] ?? { data: null, error: null };
  return {
    select: () => ({
      eq: () => Object.assign(
        Promise.resolve(result()),
        { maybeSingle: () => Promise.resolve(result()) },
      ),
    }),
    upsert: (rows: unknown) => {
      upsertCalls.push({ table, rows });
      return Promise.resolve(result());
    },
  };
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => chainFor(table),
  }),
}));

import { GET, PUT } from '@/app/api/school-admin/tenant-config/route';

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
  return new NextRequest('http://localhost/api/school-admin/tenant-config', {
    method,
    body: body !== undefined ? JSON.stringify(body) : null,
    headers: { 'content-type': 'application/json' },
  });
}

// ── GET ──────────────────────────────────────────────────────────────

describe('GET /api/school-admin/tenant-config', () => {
  it('returns defaults when no overrides exist + surfaces zod enum options', async () => {
    authedAs('school-1');
    tableResults.schools = { data: { tenant_type: 'school' }, error: null };
    tableResults.tenant_configs = { data: [], error: null };
    tableResults.feature_flags = { data: { is_enabled: true, rollout_percentage: 100 }, error: null };

    const res = await GET(makeRequest('GET'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.tenant_type).toBe('school');
    expect(body.data.flag_enabled).toBe(true);

    const personality = body.data.entries.find((e: { key: string }) => e.key === 'ai.personality');
    expect(personality.value).toBe('warm_mentor'); // school default
    expect(personality.isOverride).toBe(false);
    // Enum options must be surfaced for select-rendered keys.
    expect(personality.options).toEqual(['warm_mentor', 'rigorous_coach', 'formal_examiner', 'playful_buddy']);

    const dark = body.data.entries.find((e: { key: string }) => e.key === 'theme.dark_mode_default');
    expect(dark.options).toBeNull(); // boolean schema → no enum options
  });

  it('respects per-tenant-type defaults across the four types', async () => {
    authedAs('school-1');
    tableResults.tenant_configs = { data: [], error: null };
    tableResults.feature_flags = { data: { is_enabled: true, rollout_percentage: 100 }, error: null };

    for (const [type, expectedTone] of [
      ['school',     'casual'],
      ['coaching',   'neutral'],
      ['corporate',  'formal'],
      ['government', 'formal'],
    ] as const) {
      tableResults.schools = { data: { tenant_type: type }, error: null };
      const res = await GET(makeRequest('GET'));
      const body = await res.json();
      const tone = body.data.entries.find((e: { key: string }) => e.key === 'ai.tone');
      expect(tone.value, `${type} expected ${expectedTone}`).toBe(expectedTone);
    }
  });

  it('layers a valid override on top of default, isOverride=true', async () => {
    authedAs('school-1');
    tableResults.schools = { data: { tenant_type: 'school' }, error: null };
    tableResults.tenant_configs = {
      data: [{ key: 'ai.personality', value: 'playful_buddy', version: 1 }],
      error: null,
    };
    tableResults.feature_flags = { data: { is_enabled: true, rollout_percentage: 100 }, error: null };

    const res = await GET(makeRequest('GET'));
    const body = await res.json();
    const personality = body.data.entries.find((e: { key: string }) => e.key === 'ai.personality');
    expect(personality.value).toBe('playful_buddy');
    expect(personality.isOverride).toBe(true);
    expect(personality.defaultValue).toBe('warm_mentor');
  });

  it('falls back to default when override fails zod validation', async () => {
    authedAs('school-1');
    tableResults.schools = { data: { tenant_type: 'school' }, error: null };
    tableResults.tenant_configs = {
      data: [{ key: 'ai.personality', value: 'evil_villain', version: 1 }], // not in enum
      error: null,
    };
    tableResults.feature_flags = { data: { is_enabled: true, rollout_percentage: 100 }, error: null };

    const res = await GET(makeRequest('GET'));
    const body = await res.json();
    const personality = body.data.entries.find((e: { key: string }) => e.key === 'ai.personality');
    expect(personality.value).toBe('warm_mentor'); // default wins
    expect(personality.isOverride).toBe(true);     // row STILL exists, badge shows
  });

  it('flag OFF → all values revert to defaults, regardless of override rows', async () => {
    authedAs('school-1');
    tableResults.schools = { data: { tenant_type: 'school' }, error: null };
    tableResults.tenant_configs = {
      data: [{ key: 'ai.personality', value: 'rigorous_coach', version: 1 }],
      error: null,
    };
    tableResults.feature_flags = { data: { is_enabled: false, rollout_percentage: 0 }, error: null };

    const res = await GET(makeRequest('GET'));
    const body = await res.json();
    expect(body.data.flag_enabled).toBe(false);
    const personality = body.data.entries.find((e: { key: string }) => e.key === 'ai.personality');
    expect(personality.value).toBe('warm_mentor'); // default while flag off
    expect(personality.isOverride).toBe(true);     // override still surfaced
  });
});

// ── PUT ──────────────────────────────────────────────────────────────

describe('PUT /api/school-admin/tenant-config — validation', () => {
  it('rejects body without entries array', async () => {
    authedAs('school-1');
    const res = await PUT(makeRequest('PUT', { foo: 'bar' }));
    expect(res.status).toBe(400);
    expect(upsertCalls).toHaveLength(0);
  });

  it('rejects empty entries array', async () => {
    authedAs('school-1');
    const res = await PUT(makeRequest('PUT', { entries: [] }));
    expect(res.status).toBe(400);
    expect(upsertCalls).toHaveLength(0);
  });

  it('rejects entries array > 50 items', async () => {
    authedAs('school-1');
    const entries = Array.from({ length: 51 }, () => ({ key: 'ai.tone', value: 'neutral' }));
    const res = await PUT(makeRequest('PUT', { entries }));
    expect(res.status).toBe(400);
  });

  it('rejects unknown config key', async () => {
    authedAs('school-1');
    const res = await PUT(makeRequest('PUT', {
      entries: [{ key: 'ai.flavour', value: 'spicy' }],
    }));
    expect(res.status).toBe(400);
    expect(upsertCalls).toHaveLength(0);
  });

  it('rejects value that fails zod validation for a known key', async () => {
    authedAs('school-1');
    const res = await PUT(makeRequest('PUT', {
      entries: [{ key: 'ai.personality', value: 'evil_villain' }],
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/ai.personality/);
    expect(upsertCalls).toHaveLength(0);
  });

  it('all-or-nothing: one invalid entry kills the whole batch', async () => {
    authedAs('school-1');
    const res = await PUT(makeRequest('PUT', {
      entries: [
        { key: 'ai.personality', value: 'warm_mentor' }, // valid
        { key: 'ai.tone',        value: 'whisper' },     // invalid
      ],
    }));
    expect(res.status).toBe(400);
    expect(upsertCalls).toHaveLength(0); // no half-write
  });
});

describe('PUT /api/school-admin/tenant-config — happy path', () => {
  it('upserts validated entries and invalidates cache', async () => {
    authedAs('school-1');
    tableResults.tenant_configs = { data: null, error: null };

    const res = await PUT(makeRequest('PUT', {
      entries: [
        { key: 'ai.personality', value: 'rigorous_coach' },
        { key: 'ai.tone',        value: 'formal' },
      ],
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.written).toBe(2);

    expect(upsertCalls).toHaveLength(1);
    const call = upsertCalls[0] as { table: string; rows: Array<Record<string, unknown>> };
    expect(call.table).toBe('tenant_configs');
    expect(call.rows).toHaveLength(2);
    expect(call.rows[0].school_id).toBe('school-1');
    expect(call.rows[0].key).toBe('ai.personality');
    expect(call.rows[0].value).toBe('rigorous_coach');

    expect(invalidateCacheSpy).toHaveBeenCalledWith('school-1');
  });
});

describe('Auth gate', () => {
  it('GET denied → returns helper response untouched', async () => {
    const { NextResponse } = await import('next/server');
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false,
      errorResponse: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    });
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(403);
  });

  it('PUT denied → no upsert, no cache invalidation', async () => {
    const { NextResponse } = await import('next/server');
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false,
      errorResponse: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    });
    const res = await PUT(makeRequest('PUT', {
      entries: [{ key: 'ai.tone', value: 'neutral' }],
    }));
    expect(res.status).toBe(403);
    expect(upsertCalls).toHaveLength(0);
    expect(invalidateCacheSpy).not.toHaveBeenCalled();
  });
});
