/**
 * Contract tests for GET /api/v2/student/progress.
 * Pins: auth 401 + progress.view_own, 404 without student context, envelope
 * shape (schemaVersion 1 + the five progress arrays), source reuse.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({ authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a) }));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const STUDENT_A = '11111111-1111-4111-8111-111111111111';

// from('table') queue: performance_scores, concept_mastery (mastery),
// learning_velocity, concept_mastery (decay). RPC: get_knowledge_gaps.
const fromResults: Record<string, { data: unknown[] }> = {};
let _conceptCalls = 0;
let _gaps: { data: unknown } = { data: [] };

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      // terminal: the await resolves the chain itself (thenable).
      let result: { data: unknown[] };
      if (table === 'concept_mastery') {
        result = _conceptCalls++ === 0
          ? (fromResults['topic_mastery'] ?? { data: [] })
          : (fromResults['decay_topics'] ?? { data: [] });
      } else {
        result = fromResults[table] ?? { data: [] };
      }
      for (const m of ['select', 'eq', 'order', 'lt']) chain[m] = () => chain;
      chain.limit = () => Promise.resolve(result);
      // Some chains end on .eq (performance_scores) — make the chain thenable.
      chain.then = (res: (v: { data: unknown[] }) => unknown) => res(result);
      return chain;
    },
    rpc: () => Promise.resolve(_gaps),
  }),
}));

function setAuthorized(studentId: string | null = STUDENT_A) {
  _authorizeImpl.mockResolvedValue({
    authorized: true, userId: 'auth-user-1', studentId,
    roles: ['student'], permissions: ['progress.view_own'],
  });
}

const req = () => new Request('http://localhost/api/v2/student/progress', { method: 'GET' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: any;
beforeEach(async () => {
  vi.clearAllMocks();
  _conceptCalls = 0;
  setAuthorized();
  // The route now memoizes the aggregate read in a 30s per-student server cache
  // (Phase 5 perf). The store is module-level and survives between cases, so
  // clear the route's cache prefix to keep each case isolated.
  const { cacheInvalidatePrefix } = await import('@alfanumrik/lib/cache');
  cacheInvalidatePrefix('v2:student:progress:');
  fromResults['performance_scores'] = {
    data: [{ subject: 'math', overall_score: 72, level_name: 'Rising', updated_at: '2026-06-01' }],
  };
  fromResults['topic_mastery'] = {
    data: [{ topic_id: 't1', mastery_probability: 0.6, consecutive_correct: 2, updated_at: '2026-06-01' }],
  };
  fromResults['learning_velocity'] = {
    data: [{ subject: 'science', weekly_mastery_rate: 0.1, acceleration: 0, predicted_mastery_date: null }],
  };
  fromResults['decay_topics'] = {
    data: [{ topic_id: 't2', mastery_probability: 0.3, next_review_at: '2026-06-02' }],
  };
  _gaps = { data: [{ subject: 'math', topic: 'fractions', severity: 'high', mastery_probability: 0.2 }] };
  GET = (await import('@/app/api/v2/student/progress/route')).GET;
});

describe('GET /api/v2/student/progress', () => {
  it('returns 401 when unauthenticated', async () => {
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false, userId: null,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    expect((await GET(req())).status).toBe(401);
  });

  it('uses progress.view_own with requireStudentId', async () => {
    await GET(req());
    expect(_authorizeImpl).toHaveBeenCalledWith(
      expect.anything(), 'progress.view_own', expect.objectContaining({ requireStudentId: true }),
    );
  });

  it('returns 404 when no student context', async () => {
    setAuthorized(null);
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NO_STUDENT_PROFILE');
  });

  it('returns the structured progress envelope (all five arrays)', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.schemaVersion).toBe(1);
    expect(body.data.student_id).toBe(STUDENT_A);
    expect(body.data.performance_scores[0].subject).toBe('math');
    expect(body.data.topic_mastery[0].mastery_probability).toBe(0.6);
    expect(body.data.knowledge_gaps[0].severity).toBe('high');
    expect(body.data.learning_velocity[0].subject).toBe('science');
    expect(body.data.decay_topics[0].topic_id).toBe('t2');
  });

  it('sets a private cache header', async () => {
    const res = await GET(req());
    expect(res.headers.get('Cache-Control')).toContain('private');
  });
});
