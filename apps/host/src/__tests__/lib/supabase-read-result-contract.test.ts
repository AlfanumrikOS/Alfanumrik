/**
 * `packages/lib/src/supabase.ts` read helpers — a FAILED read is structurally
 * distinguishable from a genuinely-EMPTY one.
 *
 * THE DEFECT THIS PINS
 *   These helpers used to `console.error(error.message)` and then
 *   `return data ?? []`. Because `supabase.rpc()` and the postgrest query
 *   builder RESOLVE with `{ data, error }` — they never reject — a caller's
 *   `.catch()` was dead code and the `[]` was ambiguous between "the server
 *   failed" and "there is genuinely nothing here". /progress rendered
 *   "No knowledge gaps detected!" — a clean bill of academic health — to a
 *   student whose request had just 500'd.
 *
 *   Every helper below now returns the codebase's canonical `ServiceResult`
 *   (`packages/lib/src/domains/types.ts`, the same shape every `domains/*`
 *   module returns), so `.data` is unreachable until `ok` has been checked.
 *
 * BOTH DIRECTIONS ARE ASSERTED for every helper. A suite that only checked the
 * failure direction would still pass if the fix had simply deleted the empty
 * path — and the empty path is what the reassuring copy on /progress, /learn
 * and /exam-prep is built on.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Configurable client stub ─────────────────────────────────────────────
 * Installed at `@alfanumrik/lib/supabase-client` (the pure client module) so
 * the REAL helpers in `@alfanumrik/lib/supabase` stay under test — including
 * their exact table names, RPC names and RPC params. Same technique as
 * study-path-integrity.test.ts and progress-data-load-error.test.tsx. */
const { tableResults, rpcResults, rpcCalls } = vi.hoisted(() => ({
  tableResults: new Map<string, unknown>(),
  rpcResults: new Map<string, unknown>(),
  rpcCalls: [] as Array<{ fn: string; params: unknown }>,
}));

vi.mock('@alfanumrik/lib/supabase-client', () => {
  const CHAIN = ['select', 'eq', 'neq', 'order', 'limit', 'gte', 'lt', 'gt', 'single', 'maybeSingle'];
  return {
    supabase: {
      from: vi.fn((table: string) => {
        const builder: Record<string, unknown> = {};
        CHAIN.forEach((m) => { builder[m] = vi.fn(() => builder); });
        builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(tableResults.get(table) ?? { data: [], error: null }).then(resolve, reject);
        return builder;
      }),
      rpc: vi.fn(async (fn: string, params: unknown) => {
        rpcCalls.push({ fn, params });
        return rpcResults.get(fn) ?? { data: [], error: null };
      }),
    },
    supabaseUrl: 'http://localhost:54321',
    supabaseAnonKey: 'test-anon-key',
  };
});

import {
  getStudentProfiles,
  getSubjects,
  getBloomProgression,
  getKnowledgeGaps,
  getLearningVelocity,
  getStudyPlan,
} from '@alfanumrik/lib/supabase';

/** postgrest-js error shape — resolved, never thrown. */
const pgError = (message: string, code = '500') => ({ message, details: '', hint: '', code });

beforeEach(() => {
  tableResults.clear();
  rpcResults.clear();
  rpcCalls.length = 0;
});

describe('supabase read helpers — failure is not empty (table-backed)', () => {
  it('getStudentProfiles reports a failure instead of a success-shaped []', async () => {
    tableResults.set('student_learning_profiles', { data: null, error: pgError('rls denied') });
    const res = await getStudentProfiles('stu-1');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.code).toBe('DB_ERROR');
    expect(res.ok === false && res.error).toContain('rls denied');
    // The old ambiguous shape must not come back.
    expect(res).not.toHaveProperty('data');
  });

  it('getStudentProfiles reports a genuine empty as ok', async () => {
    tableResults.set('student_learning_profiles', { data: [], error: null });
    const res = await getStudentProfiles('stu-1');
    expect(res.ok).toBe(true);
    expect(res.ok && res.data).toEqual([]);
  });

  it('getSubjects reports a failure instead of a success-shaped []', async () => {
    tableResults.set('subjects', { data: null, error: pgError('subjects unreachable') });
    const res = await getSubjects();
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('subjects unreachable');
  });

  it('getSubjects reports a genuine empty as ok', async () => {
    tableResults.set('subjects', { data: [], error: null });
    const res = await getSubjects();
    expect(res.ok).toBe(true);
    expect(res.ok && res.data).toEqual([]);
  });

  it('getLearningVelocity reports a failure instead of a success-shaped []', async () => {
    tableResults.set('learning_velocity', { data: null, error: pgError('velocity timeout') });
    const res = await getLearningVelocity('stu-1');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('velocity timeout');
  });

  it('getLearningVelocity reports a genuine empty as ok', async () => {
    tableResults.set('learning_velocity', { data: [], error: null });
    const res = await getLearningVelocity('stu-1');
    expect(res.ok).toBe(true);
    expect(res.ok && res.data).toEqual([]);
  });

  it('a null data payload with no error is still ok (empty), not a failure', async () => {
    // PostgREST can answer `{ data: null, error: null }`. That is "nothing",
    // not "broken" — it must not be escalated into an error state.
    tableResults.set('learning_velocity', { data: null, error: null });
    const res = await getLearningVelocity('stu-1');
    expect(res.ok).toBe(true);
    expect(res.ok && res.data).toEqual([]);
  });
});

describe('supabase read helpers — failure is not empty (RPC-backed)', () => {
  it('getBloomProgression reports a failure instead of a success-shaped []', async () => {
    rpcResults.set('get_bloom_progression', { data: null, error: pgError('bloom rpc down') });
    const res = await getBloomProgression('stu-1');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('bloom rpc down');
  });

  it('getBloomProgression reports a genuine empty as ok', async () => {
    rpcResults.set('get_bloom_progression', { data: [], error: null });
    const res = await getBloomProgression('stu-1');
    expect(res.ok).toBe(true);
    expect(res.ok && res.data).toEqual([]);
  });

  it('getKnowledgeGaps reports a failure — the "all clear" must not be forgeable', async () => {
    rpcResults.set('get_knowledge_gaps', { data: null, error: pgError('gaps rpc exploded') });
    const res = await getKnowledgeGaps('stu-1', undefined, 20);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('gaps rpc exploded');
  });

  it('getKnowledgeGaps reports a genuine empty as ok — the real all-clear survives', async () => {
    rpcResults.set('get_knowledge_gaps', { data: [], error: null });
    const res = await getKnowledgeGaps('stu-1', undefined, 20);
    expect(res.ok).toBe(true);
    expect(res.ok && res.data).toEqual([]);
  });
});

/* The /progress duplication that this change collapsed was kept in sync only
 * by a NOTE(drift) comment. These pin the query CONTRACT the page inlined, so
 * a future edit to the shared helper cannot silently change what a student
 * sees on /progress. */
describe('supabase read helpers — /progress query contract is unchanged', () => {
  it('getKnowledgeGaps(id, undefined, 20) sends exactly { p_student_id, p_limit } — no p_subject', async () => {
    await getKnowledgeGaps('stu-1', undefined, 20);
    const call = rpcCalls.find((c) => c.fn === 'get_knowledge_gaps');
    expect(call).toBeDefined();
    expect(call!.params).toEqual({ p_student_id: 'stu-1', p_limit: 20 });
  });

  it('getBloomProgression(id) sends exactly { p_student_id } — no p_subject', async () => {
    await getBloomProgression('stu-1');
    const call = rpcCalls.find((c) => c.fn === 'get_bloom_progression');
    expect(call).toBeDefined();
    expect(call!.params).toEqual({ p_student_id: 'stu-1' });
  });

  it('the subject-scoped variants still add p_subject (other direction)', async () => {
    await getKnowledgeGaps('stu-1', 'math', 6);
    await getBloomProgression('stu-1', 'math');
    expect(rpcCalls.find((c) => c.fn === 'get_knowledge_gaps')!.params)
      .toEqual({ p_student_id: 'stu-1', p_limit: 6, p_subject: 'math' });
    expect(rpcCalls.find((c) => c.fn === 'get_bloom_progression')!.params)
      .toEqual({ p_student_id: 'stu-1', p_subject: 'math' });
  });
});

describe('getStudyPlan — "no plan" must mean no plan, not a failed read', () => {
  it('reports a failure when the study_plans read errors', async () => {
    // The RPC returns nothing usable so the ladder degrades to the direct
    // query, exactly as before — and that direct query is what fails.
    rpcResults.set('get_study_plan', { data: null, error: pgError('rpc missing', '42883') });
    tableResults.set('study_plans', { data: null, error: pgError('study_plans timeout') });
    const res = await getStudyPlan('stu-1');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('study_plans timeout');
    // Crucially NOT the shape that drives "Generate your AI Study Plan".
    expect(res).not.toHaveProperty('data');
  });

  it('reports has_plan: false as a SUCCESS when the student genuinely has none', async () => {
    rpcResults.set('get_study_plan', { data: null, error: pgError('rpc missing', '42883') });
    // PGRST116 = ".single() matched no rows" — the legitimate no-plan answer.
    tableResults.set('study_plans', { data: null, error: pgError('no rows', 'PGRST116') });
    const res = await getStudyPlan('stu-1');
    expect(res.ok).toBe(true);
    expect(res.ok && res.data).toEqual({ has_plan: false });
  });

  it('reports a plan + its tasks as a success', async () => {
    rpcResults.set('get_study_plan', { data: null, error: pgError('rpc missing', '42883') });
    tableResults.set('study_plans', { data: { id: 'plan-1' }, error: null });
    tableResults.set('study_plan_tasks', { data: [{ id: 't-1', day_number: 1 }], error: null });
    const res = await getStudyPlan('stu-1');
    expect(res.ok).toBe(true);
    expect(res.ok && res.data.has_plan).toBe(true);
    expect(res.ok && res.data.tasks).toEqual([{ id: 't-1', day_number: 1 }]);
  });

  it('reports a failure when the plan loads but its tasks do not', async () => {
    rpcResults.set('get_study_plan', { data: null, error: pgError('rpc missing', '42883') });
    tableResults.set('study_plans', { data: { id: 'plan-1' }, error: null });
    tableResults.set('study_plan_tasks', { data: null, error: pgError('tasks timeout') });
    const res = await getStudyPlan('stu-1');
    expect(res.ok).toBe(false);
    // A half-loaded plan rendered as "0 tasks" would be its own quiet lie.
    expect(res.ok === false && res.error).toContain('tasks timeout');
  });

  it('still prefers the RPC when it succeeds (ladder unchanged)', async () => {
    rpcResults.set('get_study_plan', { data: { has_plan: true, plan: { id: 'rpc-plan' }, tasks: [] }, error: null });
    const res = await getStudyPlan('stu-1');
    expect(res.ok).toBe(true);
    expect(res.ok && res.data.plan.id).toBe('rpc-plan');
  });
});

/* The SWR hooks in packages/lib/src/swr.tsx are the other consumer of these
 * helpers. SWR already models failure-vs-empty (`error` set vs `data: []`), so
 * their fetchers THROW on a failed ServiceResult rather than resolving to [].
 * Resolving to [] there would re-introduce the exact ambiguity this change
 * removed, one layer up. */
describe('swr.tsx hooks — a failed read surfaces as SWR `error`, not empty data', () => {
  it('useStudentProfiles: failure → error set, data undefined', async () => {
    const { renderHook, waitFor } = await import('@testing-library/react');
    const { useStudentProfiles } = await import('@alfanumrik/lib/swr');

    tableResults.set('student_learning_profiles', { data: null, error: pgError('rls denied') });
    const { result } = renderHook(() => useStudentProfiles('stu-1'));

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect((result.current.error as Error).message).toContain('rls denied');
    expect(result.current.data).toBeUndefined();
  });

  it('useStudentProfiles: genuine empty → data [], no error (other direction)', async () => {
    const { renderHook, waitFor } = await import('@testing-library/react');
    const { useStudentProfiles } = await import('@alfanumrik/lib/swr');

    tableResults.set('student_learning_profiles', { data: [], error: null });
    const { result } = renderHook(() => useStudentProfiles('stu-2'));

    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(result.current.error).toBeUndefined();
  });

  it('useStudyPlan: failure → error set, never a silent { has_plan: false }', async () => {
    const { renderHook, waitFor } = await import('@testing-library/react');
    const { useStudyPlan } = await import('@alfanumrik/lib/swr');

    rpcResults.set('get_study_plan', { data: null, error: pgError('rpc missing', '42883') });
    tableResults.set('study_plans', { data: null, error: pgError('study_plans timeout') });
    const { result } = renderHook(() => useStudyPlan('stu-3'));

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.data).toBeUndefined();
  });
});
