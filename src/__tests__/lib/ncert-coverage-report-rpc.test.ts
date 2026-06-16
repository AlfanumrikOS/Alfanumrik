/**
 * getNCERTCoverageReport — RPC signature contract.
 *
 * CONTRACT (RPC re-sweep 2026-06-16):
 *   The live `get_ncert_coverage_report` overload is (p_grade text, p_subject text).
 *   It is grade/subject scoped, NOT per-student. An earlier call ALSO passed
 *   `p_student_id`, which made PostgREST return PGRST202 (no matching overload),
 *   so the report silently came back null and the coverage widget rendered empty.
 *
 *   This test pins the fix: `getNCERTCoverageReport` must call the RPC with
 *   EXACTLY `{ p_grade, p_subject }` and NO `p_student_id` key. A regression that
 *   re-adds p_student_id (or any third arg) re-opens the PGRST202 empty-widget bug.
 *
 * SEAM: `getNCERTCoverageReport` calls `supabase.rpc(...)` where `supabase` comes
 * from `@/lib/supabase-client`. We mock that module with an `rpc` spy and assert
 * on the exact params object — mocking the Supabase client, not the business
 * function (per testing rules).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the underlying Supabase client so we can spy on rpc(). ────────────────
const rpcMock = vi.fn();
vi.mock('@/lib/supabase-client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
  supabaseUrl: 'https://placeholder.supabase.co',
  supabaseAnonKey: 'anon-key',
}));

import { getNCERTCoverageReport } from '@/lib/supabase';

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: [{ chapter: 1, covered: true }], error: null });
});

describe('getNCERTCoverageReport — RPC signature contract', () => {
  it('calls get_ncert_coverage_report with exactly { p_grade, p_subject }', async () => {
    await getNCERTCoverageReport('8', 'science');

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fnName, params] = rpcMock.mock.calls[0];
    expect(fnName).toBe('get_ncert_coverage_report');
    // Exact-shape pin: only these two keys, with the passed values.
    expect(params).toEqual({ p_grade: '8', p_subject: 'science' });
  });

  it('does NOT pass p_student_id (the PGRST202 / empty-widget regression)', async () => {
    await getNCERTCoverageReport('10', 'math');

    const params = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(params).not.toHaveProperty('p_student_id');
    // Coverage is grade/subject scoped — exactly two params, no third arg.
    expect(Object.keys(params).sort()).toEqual(['p_grade', 'p_subject']);
  });

  it('passes p_subject as null when the subject argument is omitted', async () => {
    await getNCERTCoverageReport('7');

    const params = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(params).toEqual({ p_grade: '7', p_subject: null });
    expect(params).not.toHaveProperty('p_student_id');
  });

  it('returns the RPC data on success', async () => {
    rpcMock.mockResolvedValue({ data: [{ chapter: 3, covered: false }], error: null });
    const result = await getNCERTCoverageReport('9', 'physics');
    expect(result).toEqual([{ chapter: 3, covered: false }]);
  });

  it('returns null when the RPC errors (graceful degradation, no throw)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'PGRST202: no overload' } });
    const result = await getNCERTCoverageReport('11', 'chemistry');
    expect(result).toBeNull();
  });
});
