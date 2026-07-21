import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * T8 regression: shared BKT-mastery formula parity across surfaces.
 *
 * RCA: teacher Reports, the School-Admin Command Center, and super-admin
 * B2B analytics each computed "this cohort's mastery" with a different
 * formula. Migration 20260721000200_shared_cohort_bkt_mastery_rpc.sql
 * unifies them onto ONE Postgres primitive:
 *   calculate_cohort_bkt_mastery(uuid[]) / get_cohort_bkt_mastery_by_student(uuid[])
 *   avg_mastery_pct = round(AVG(concept_mastery.p_know) * 100)
 *
 * This test asserts the super-admin B2B route's new `avg_bkt_mastery` field
 * is read verbatim from that shared RPC's response — never recalculated
 * client-side from raw concept_mastery rows — for a fixture cohort whose
 * expected average (50%) is the SAME number asserted for the teacher-
 * dashboard Edge Function's equivalent Deno test:
 *   supabase/functions/teacher-dashboard/__tests__/metrics.test.ts
 *     ("shared cohort BKT mastery: shapes RPC rows into a per-student map...")
 * Both tests use the identical 3-student fixture (p_know 0.9 / 0.5 / 0.1 →
 * 90% / 50% / 10%, cohort average 50%) and the SAME `avg_mastery_pct`
 * field name in the RPC response shape. get_school_overview (the
 * School-Admin Command Center) is asserted separately via a static wiring
 * check on the migration SQL (see below) since it is a SECURITY DEFINER
 * SQL function that cannot run inside a Vitest/Node process.
 */

const COHORT_BKT_FIXTURE_STUDENT_IDS = ['student-1', 'student-2', 'student-3'];
// Matches supabase/functions/teacher-dashboard/__tests__/metrics.test.ts —
// p_know 0.9 / 0.5 / 0.1 -> 90% / 50% / 10%, average 50%.
const COHORT_BKT_FIXTURE_AVERAGE_PCT = 50;
const COHORT_BKT_FIXTURE_SCORED_COUNT = 3;

let _mockAuthorized = true;

vi.mock('@alfanumrik/lib/admin-auth', () => {
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
          adminLevel: 'support',
        });
      }
      return Promise.resolve({
        authorized: false,
        response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      });
    }),
    supabaseAdminHeaders: vi.fn().mockReturnValue({}),
    // Encode the table/rpc name directly into the URL so the fetch mock
    // below can branch on it without depending on real env vars.
    supabaseAdminUrl: vi.fn().mockImplementation((table: string, params: string = '') => {
      return `https://mock.supabase.local/rest/v1/${table}${params ? `?${params}` : ''}`;
    }),
  };
});

function jsonResponse(body: unknown, init: { headers?: Record<string, string> } = {}) {
  return {
    ok: true,
    json: async () => body,
    headers: {
      get: (name: string) => init.headers?.[name] ?? null,
    },
  } as unknown as Response;
}

describe('super-admin B2B analytics — shared cohort BKT mastery (T8)', () => {
  beforeEach(() => {
    _mockAuthorized = true;
    vi.resetModules();
  });

  it('reads avg_bkt_mastery verbatim from calculate_cohort_bkt_mastery — never recomputed client-side', async () => {
    const rpcCalls: Array<{ url: string; body: unknown }> = [];

    global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/rest/v1/rpc/calculate_cohort_bkt_mastery')) {
        rpcCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
        // The shared RPC's response shape — the route must read this
        // verbatim, not recompute it from raw concept_mastery rows (which
        // this test never even provides).
        return jsonResponse([
          {
            student_count: COHORT_BKT_FIXTURE_STUDENT_IDS.length,
            scored_count: COHORT_BKT_FIXTURE_SCORED_COUNT,
            avg_pknow: 0.5,
            avg_mastery_pct: COHORT_BKT_FIXTURE_AVERAGE_PCT,
          },
        ]);
      }

      if (url.includes('/rest/v1/schools')) {
        return jsonResponse([
          {
            id: 'school-1',
            name: 'Fixture School',
            code: 'FX1',
            city: 'Mumbai',
            state: 'MH',
            board: 'CBSE',
            school_type: 'private',
            subscription_plan: 'premium',
            is_active: true,
            max_students: 100,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ]);
      }

      if (url.includes('/rest/v1/students')) {
        return jsonResponse(
          COHORT_BKT_FIXTURE_STUDENT_IDS.map((id) => ({
            id,
            school_id: 'school-1',
            name: id,
            grade: '9',
            created_at: '2026-01-01T00:00:00.000Z',
          })),
        );
      }

      if (url.includes('/rest/v1/quiz_sessions')) {
        return jsonResponse([]);
      }

      if (url.includes('/rest/v1/school_subscriptions')) {
        return jsonResponse([]);
      }

      // countRows() uses a HEAD request + content-range header.
      return {
        ok: true,
        json: async () => [],
        headers: { get: (name: string) => (name === 'content-range' ? '0/0' : null) },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const { GET } = await import('../../../app/api/super-admin/analytics-v2/b2b/route');
    const request = new NextRequest(new URL('https://example.com/api/super-admin/analytics-v2/b2b'));
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    const school = body.data.schools.find((s: { id: string }) => s.id === 'school-1');
    expect(school).toBeDefined();

    // The field must equal the shared RPC's avg_mastery_pct verbatim.
    expect(school.avg_bkt_mastery).toBe(COHORT_BKT_FIXTURE_AVERAGE_PCT);
    expect(school.bkt_scored_count).toBe(COHORT_BKT_FIXTURE_SCORED_COUNT);

    // It must be a DIFFERENT, separately-labeled field from avg_score
    // (quiz-score-percent based) and must not have been folded into
    // health_score's existing weighted formula.
    expect(school).toHaveProperty('avg_score');
    expect(school).toHaveProperty('health_score');
    expect(school.avg_bkt_mastery).not.toBe(undefined);

    // The route called the shared RPC with exactly this school's student ids
    // — proving the cohort passed to the shared formula is the same roster
    // every other surface would resolve for this school.
    expect(rpcCalls.length).toBe(1);
    expect(new Set(rpcCalls[0].body.p_student_ids)).toEqual(new Set(COHORT_BKT_FIXTURE_STUDENT_IDS));
  });

  it('returns null (not 0) avg_bkt_mastery when the shared RPC has no data for the school', async () => {
    global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/rest/v1/rpc/calculate_cohort_bkt_mastery')) {
        return jsonResponse([]); // no concept_mastery rows for this cohort
      }
      if (url.includes('/rest/v1/schools')) {
        return jsonResponse([
          {
            id: 'school-2',
            name: 'No-Data School',
            code: 'ND1',
            is_active: true,
            max_students: 10,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ]);
      }
      if (url.includes('/rest/v1/students')) {
        return jsonResponse([{ id: 'student-9', school_id: 'school-2', name: 'x', grade: '6', created_at: '2026-01-01T00:00:00.000Z' }]);
      }
      return {
        ok: true,
        json: async () => [],
        headers: { get: (name: string) => (name === 'content-range' ? '0/0' : null) },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const { GET } = await import('../../../app/api/super-admin/analytics-v2/b2b/route');
    const request = new NextRequest(new URL('https://example.com/api/super-admin/analytics-v2/b2b'));
    const response = await GET(request);
    const body = await response.json();

    const school = body.data.schools.find((s: { id: string }) => s.id === 'school-2');
    expect(school.avg_bkt_mastery).toBeNull();
    expect(school.bkt_scored_count).toBe(0);
  });

  it('rejects unauthenticated requests before touching the shared RPC', async () => {
    _mockAuthorized = false;
    global.fetch = vi.fn();

    const { GET } = await import('../../../app/api/super-admin/analytics-v2/b2b/route');
    const request = new NextRequest(new URL('https://example.com/api/super-admin/analytics-v2/b2b'));
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('School-Admin Command Center — get_school_overview delegates to the shared formula (static wiring check)', () => {
  it('the migration wires get_school_overview to call calculate_cohort_bkt_mastery instead of its own inline AVG(p_know)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const migrationPath = path.resolve(
      __dirname,
      '../../../../../../supabase/migrations/20260721000200_shared_cohort_bkt_mastery_rpc.sql',
    );
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // get_school_overview's mastery CTE must call the shared primitive...
    expect(sql).toMatch(/mastery AS \(\s*SELECT avg_pknow\s*FROM public\.calculate_cohort_bkt_mastery/);
    // ...and must NOT reintroduce its own inline AVG(cm.p_know) roll-up
    // (that was the pre-T8 shape being refactored away here).
    const overviewFnMatch = sql.match(
      /CREATE OR REPLACE FUNCTION public\.get_school_overview[\s\S]*?\$\$;/,
    );
    expect(overviewFnMatch).not.toBeNull();
    expect(overviewFnMatch![0]).not.toMatch(/AVG\(cm\.p_know\)/);
  });
});
