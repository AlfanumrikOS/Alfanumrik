/**
 * Phase 3B Wave D / D-tests — school-wide reporting read routes (unit, no DB).
 *
 * Three thin GET handlers, each gated by `ff_school_reports_depth` (404 BEFORE
 * auth when OFF — byte-identical "feature absent" portal):
 *   - /api/school-admin/reports/mastery?group_by=grade|subject|teacher → get_school_mastery_rollup
 *   - /api/school-admin/reports/bloom                                  → get_school_bloom_summary
 *   - /api/school-admin/reports/export?format=json|csv                 → export_school_report
 *
 * We mock TWO seams:
 *   - `isFeatureEnabled` (the flag gate) — controllable per test. Default ON for
 *     the body of the suite; a dedicated FLAG-OFF block flips it OFF and asserts
 *     404-before-auth + that the resolution seam is NEVER consulted.
 *   - `resolveCommandCenterContext` (auth + school + user-context client) —
 *     replaced with a fake whose `.rpc()` is controllable.
 *
 * The pure helpers `reportingRpcErrorResponse`, `VALID_MASTERY_GROUP_BY`,
 * `DEFAULT_MASTERY_GROUP_BY`, and the cache constant are kept REAL (re-exported
 * from the actual modules via importActual) so the route's real group_by/format
 * validation and Postgres 22023→400 / 42501→403 mapping are genuinely exercised,
 * not stubbed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the flag gate. Default behaviour set per-test in beforeEach. ─────────
const { mockIsFeatureEnabled, mockResolve, rpcSpy } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockResolve: vi.fn(),
  rpcSpy: vi.fn(),
}));

vi.mock('@alfanumrik/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/feature-flags')>();
  return {
    ...actual,
    isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  };
});

// Keep reportingRpcErrorResponse + the group_by/format constants + cache header
// REAL via importActual so the route's real validation + error mapping run. Only
// resolveCommandCenterContext is stubbed.
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
import { GET as GET_MASTERY } from '@/app/api/school-admin/reports/mastery/route';
import { GET as GET_BLOOM } from '@/app/api/school-admin/reports/bloom/route';
import { GET as GET_EXPORT } from '@/app/api/school-admin/reports/export/route';

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';

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
  // Flag ON by default; the dedicated FLAG-OFF block overrides per test.
  mockIsFeatureEnabled.mockResolvedValue(true);
});

const ROUTES = [
  {
    name: 'mastery',
    path: '/api/school-admin/reports/mastery',
    handler: GET_MASTERY,
    rpcName: 'get_school_mastery_rollup',
  },
  {
    name: 'bloom',
    path: '/api/school-admin/reports/bloom',
    handler: GET_BLOOM,
    rpcName: 'get_school_bloom_summary',
  },
  {
    name: 'export',
    path: '/api/school-admin/reports/export',
    handler: GET_EXPORT,
    rpcName: 'export_school_report',
  },
] as const;

// ═════════════════════════════════════════════════════════════════════════════
// FLAG OFF — 404 BEFORE auth on all three (byte-identical "not present").
// ═════════════════════════════════════════════════════════════════════════════
describe.each(ROUTES)('FLAG OFF — GET $path (404 before auth)', (route) => {
  it('returns 404 and NEVER consults resolveCommandCenterContext or the RPC', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const res = await route.handler(req(route.path) as never);
    expect(res.status).toBe(404);
    // The flag gate is evaluated BEFORE any auth/resolution work.
    expect(mockResolve).not.toHaveBeenCalled();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('checks the ff_school_reports_depth flag (gate is the reporting-depth flag)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    await route.handler(req(route.path) as never);
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith(
      'ff_school_reports_depth',
      expect.any(Object),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FLAG ON — shared contract: resolution failure propagates + error mapping.
// ═════════════════════════════════════════════════════════════════════════════
describe.each(ROUTES)('FLAG ON — GET $path — resolution + error mapping', (route) => {
  it('propagates a 401 from resolveCommandCenterContext unchanged (no RPC call)', async () => {
    resolvedFail(401);
    const res = await route.handler(req(route.path) as never);
    expect(res.status).toBe(401);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('propagates a 403 from resolveCommandCenterContext unchanged', async () => {
    resolvedFail(403);
    const res = await route.handler(req(route.path) as never);
    expect(res.status).toBe(403);
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
    const serialized = JSON.stringify(await res.json());
    expect(serialized).not.toContain('admin-PII@x.com');
    expect(serialized).not.toContain('duplicate key');
    expect(serialized).not.toContain('23505');
  });

  it('calls the correct RPC with the resolved school id', async () => {
    resolvedOk();
    rpcResult = { data: route.name === 'export' ? {} : [], error: null };
    await route.handler(req(route.path) as never);
    expect(rpcSpy).toHaveBeenCalledWith(
      route.rpcName,
      expect.objectContaining({ p_school_id: SCHOOL_ID }),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Mastery route — group_by validation + default + echo + empty.
// ═════════════════════════════════════════════════════════════════════════════
describe('FLAG ON — GET /api/school-admin/reports/mastery', () => {
  it('defaults to group_by=grade when no param, echoes it, and passes it to the RPC', async () => {
    resolvedOk();
    rpcResult = { data: [], error: null };
    const res = await GET_MASTERY(req('/api/school-admin/reports/mastery') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.group_by).toBe('grade');
    expect(rpcSpy).toHaveBeenCalledWith(
      'get_school_mastery_rollup',
      expect.objectContaining({ p_school_id: SCHOOL_ID, p_group_by: 'grade' }),
    );
  });

  it.each(['grade', 'subject', 'teacher'] as const)(
    'accepts the valid group_by=%s and forwards it to the RPC',
    async (gb) => {
      resolvedOk();
      rpcResult = { data: [], error: null };
      const res = await GET_MASTERY(
        req('/api/school-admin/reports/mastery', `?group_by=${gb}`) as never,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.group_by).toBe(gb);
      expect(rpcSpy).toHaveBeenCalledWith(
        'get_school_mastery_rollup',
        expect.objectContaining({ p_group_by: gb }),
      );
    },
  );

  it('returns 400 for an invalid group_by BEFORE calling the RPC', async () => {
    resolvedOk();
    rpcResult = { data: [], error: null };
    const res = await GET_MASTERY(
      req('/api/school-admin/reports/mastery', '?group_by=bogus') as never,
    );
    expect(res.status).toBe(400);
    // Validation runs before the RPC — the rollup is never invoked.
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('returns 200 with an empty data array when the RPC yields no rows', async () => {
    resolvedOk();
    rpcResult = { data: [], error: null };
    const res = await GET_MASTERY(req('/api/school-admin/reports/mastery') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it('returns the rollup rows on the wire and sets the reports cache header', async () => {
    resolvedOk();
    rpcResult = {
      data: [
        { group_key: '7', group_label: 'Grade 7', student_count: 3, avg_mastery: 0.3, at_risk_count: 2 },
      ],
      error: null,
    };
    const res = await GET_MASTERY(req('/api/school-admin/reports/mastery') as never);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].group_key).toBe('7');
    expect(res.headers.get('Cache-Control')).toBe(
      'private, max-age=60, stale-while-revalidate=120',
    );
  });

  it('maps a Postgres 22023 RPC error to HTTP 400 (defensive in-RPC validation)', async () => {
    resolvedOk();
    // A valid group_by reaches the RPC, but SQL still raises 22023 → 400.
    rpcResult = { data: null, error: { code: '22023', message: 'invalid p_group_by' } };
    const res = await GET_MASTERY(
      req('/api/school-admin/reports/mastery', '?group_by=grade') as never,
    );
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Bloom route — rows + empty.
// ═════════════════════════════════════════════════════════════════════════════
describe('FLAG ON — GET /api/school-admin/reports/bloom', () => {
  it('returns 200 with the bloom rows + cache header', async () => {
    resolvedOk();
    rpcResult = {
      data: [
        { bloom_level: 'remember', response_count: 3, correct_count: 2, accuracy: 0.67 },
        { bloom_level: 'unspecified', response_count: 1, correct_count: 0, accuracy: 0 },
      ],
      error: null,
    };
    const res = await GET_BLOOM(req('/api/school-admin/reports/bloom') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].bloom_level).toBe('remember');
    expect(res.headers.get('Cache-Control')).toBe(
      'private, max-age=60, stale-while-revalidate=120',
    );
  });

  it('returns 200 with an empty array when the RPC yields no rows', async () => {
    resolvedOk();
    rpcResult = { data: [], error: null };
    const res = await GET_BLOOM(req('/api/school-admin/reports/bloom') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Export route — json vs csv + format validation + CSV PII-safety.
// ═════════════════════════════════════════════════════════════════════════════
const PII_SAFE_SNAPSHOT = {
  school_id: SCHOOL_ID,
  overview: {
    class_count: 2,
    teacher_count: 2,
    student_count: 5,
    seats_purchased: 10,
    active_students: 5,
    seat_utilization_pct: 50,
    avg_mastery: 0.52,
    data_state: 'live',
  },
  mastery_by_grade: [
    { grade: '7', label: 'Grade 7', student_count: 3, avg_mastery: 0.3, at_risk_count: 2 },
    { grade: '8', label: 'Grade 8', student_count: 2, avg_mastery: 0.8, at_risk_count: 0 },
  ],
  bloom_summary: [
    { bloom_level: 'remember', response_count: 3, correct_count: 2, accuracy: 0.67 },
  ],
  data_state: 'live',
  generated_at: '2026-06-08T00:00:00.000Z',
};

describe('FLAG ON — GET /api/school-admin/reports/export', () => {
  it('defaults to json and returns the verbatim PII-safe snapshot', async () => {
    resolvedOk();
    rpcResult = { data: PII_SAFE_SNAPSHOT, error: null };
    const res = await GET_EXPORT(req('/api/school-admin/reports/export') as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = await res.json();
    expect(body.school_id).toBe(SCHOOL_ID);
    expect(body.mastery_by_grade).toHaveLength(2);
    expect(body.data_state).toBe('live');
  });

  it('format=json explicitly is also a JSON snapshot', async () => {
    resolvedOk();
    rpcResult = { data: PII_SAFE_SNAPSHOT, error: null };
    const res = await GET_EXPORT(req('/api/school-admin/reports/export', '?format=json') as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('format=csv returns a text/csv attachment download', async () => {
    resolvedOk();
    rpcResult = { data: PII_SAFE_SNAPSHOT, error: null };
    const res = await GET_EXPORT(req('/api/school-admin/reports/export', '?format=csv') as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const disposition = res.headers.get('Content-Disposition') ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('.csv');
  });

  it('returns 400 for an invalid format BEFORE calling the RPC', async () => {
    resolvedOk();
    rpcResult = { data: PII_SAFE_SNAPSHOT, error: null };
    const res = await GET_EXPORT(req('/api/school-admin/reports/export', '?format=pdf') as never);
    expect(res.status).toBe(400);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('CSV body contains ONLY aggregate fields — NO student name / email / id (P13)', async () => {
    resolvedOk();
    rpcResult = { data: PII_SAFE_SNAPSHOT, error: null };
    const res = await GET_EXPORT(req('/api/school-admin/reports/export', '?format=csv') as never);
    const csv = await res.text();

    // Aggregate section labels + group-level fields ARE present.
    expect(csv).toContain('overview');
    expect(csv).toContain('mastery_by_grade');
    expect(csv).toContain('bloom_summary');
    expect(csv).toContain('student_count');
    expect(csv).toContain('at_risk_count');
    expect(csv).toContain('Grade 7');

    // The CSV serializes ONLY the bounded aggregate arrays. The serializer never
    // reads a per-student field, so even if the snapshot were tampered to carry
    // a student identifier, these keys would not appear. Assert defensively that
    // common PII column names are absent from the CSV body.
    for (const piiKey of ['email', 'student_name', 'student_id', 'phone', '@']) {
      expect(csv.toLowerCase()).not.toContain(piiKey.toLowerCase());
    }
  });

  it('degrades a null RPC result to an empty no_data snapshot (json, never 500)', async () => {
    resolvedOk();
    rpcResult = { data: null, error: null };
    const res = await GET_EXPORT(req('/api/school-admin/reports/export') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    // The route degrades to an empty PII-safe snapshot rather than 500ing.
    expect(body).toBeTruthy();
  });

  it('maps a Postgres 42501 RPC error to HTTP 403 (scope guard)', async () => {
    resolvedOk();
    rpcResult = { data: null, error: { code: '42501', message: 'not authorized for school' } };
    const res = await GET_EXPORT(req('/api/school-admin/reports/export', '?format=csv') as never);
    expect(res.status).toBe(403);
  });
});
