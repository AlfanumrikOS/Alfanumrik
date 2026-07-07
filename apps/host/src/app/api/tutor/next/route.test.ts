/**
 * GET /api/tutor/next — ADR-004 Phase 2 attemptId behaviour.
 *
 * Pins:
 *   - When ff_tutor_v1 is OFF, route returns 404 (unchanged from Phase 0).
 *   - When ff_tutor_v1 is ON and ff_tutor_bkt_v1 is OFF, response omits attemptId.
 *   - When BOTH flags are ON, response includes a fresh UUID attemptId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    isFeatureEnabled: vi.fn(),
    createSupabaseServerClient: vi.fn(),
    resolveNextConcept: vi.fn(),
    capture: vi.fn(),
  },
}));

vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => mocks.isFeatureEnabled(...args),
}));
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: () => mocks.createSupabaseServerClient(),
}));
vi.mock('@alfanumrik/lib/tutor/resolve-next-concept', () => ({
  resolveNextConcept: (...args: unknown[]) => mocks.resolveNextConcept(...args),
}));
vi.mock('@alfanumrik/lib/posthog/server', () => ({
  capture: (...args: unknown[]) => mocks.capture(...args),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from './route';

function makeSupabase(opts: {
  userId: string;
  studentId: string;
  grade: string;
  conceptRows: unknown[];
  masteryRows: unknown[];
}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: opts.userId } }, error: null }) },
    from(table: string) {
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: opts.studentId, grade: opts.grade, preferred_language: 'en' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'chapter_concepts') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  order: () => ({
                    order: async () => ({ data: opts.conceptRows, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'concept_mastery') {
        return {
          select: () => ({
            eq: async () => ({ data: opts.masteryRows, error: null }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/tutor/next — attemptId behaviour', () => {
  it('404s when ff_tutor_v1 is OFF', async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
      from: () => ({}),
    });

    const res = await GET(new Request('http://localhost/api/tutor/next'));
    expect(res.status).toBe(404);
  });

  it('returns attemptId when both ff_tutor_v1 and ff_tutor_bkt_v1 are ON', async () => {
    mocks.isFeatureEnabled.mockImplementation(async (flag: string) => {
      if (flag === 'ff_tutor_v1') return true;
      if (flag === 'ff_tutor_bkt_v1') return true;
      return false;
    });
    mocks.createSupabaseServerClient.mockResolvedValue(
      makeSupabase({
        userId: 'u1',
        studentId: 's1',
        grade: '7',
        conceptRows: [],
        masteryRows: [],
      }),
    );
    mocks.resolveNextConcept.mockReturnValue({
      status: 'next_concept',
      concept: { id: '11111111-1111-1111-1111-111111111111' },
      progress: { mastered: 0, total: 10 },
    });

    const res = await GET(new Request('http://localhost/api/tutor/next'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('next_concept');
    expect(typeof body.attemptId).toBe('string');
    expect(body.attemptId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('omits attemptId when ff_tutor_v1 is ON but ff_tutor_bkt_v1 is OFF', async () => {
    mocks.isFeatureEnabled.mockImplementation(async (flag: string) => {
      if (flag === 'ff_tutor_v1') return true;
      if (flag === 'ff_tutor_bkt_v1') return false;
      return false;
    });
    mocks.createSupabaseServerClient.mockResolvedValue(
      makeSupabase({
        userId: 'u1',
        studentId: 's1',
        grade: '7',
        conceptRows: [],
        masteryRows: [],
      }),
    );
    mocks.resolveNextConcept.mockReturnValue({
      status: 'next_concept',
      concept: { id: '11111111-1111-1111-1111-111111111111' },
    });

    const res = await GET(new Request('http://localhost/api/tutor/next'));
    const body = await res.json();
    expect(body.attemptId).toBeUndefined();
  });

  it('generates a fresh attemptId per request', async () => {
    mocks.isFeatureEnabled.mockResolvedValue(true);
    mocks.createSupabaseServerClient.mockResolvedValue(
      makeSupabase({
        userId: 'u1',
        studentId: 's1',
        grade: '7',
        conceptRows: [],
        masteryRows: [],
      }),
    );
    mocks.resolveNextConcept.mockReturnValue({
      status: 'next_concept',
      concept: { id: '11111111-1111-1111-1111-111111111111' },
    });

    const r1 = await (await GET(new Request('http://localhost/api/tutor/next'))).json();
    const r2 = await (await GET(new Request('http://localhost/api/tutor/next'))).json();
    expect(r1.attemptId).not.toBe(r2.attemptId);
  });
});
