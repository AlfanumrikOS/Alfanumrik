/**
 * usePrincipalAi — Track-2 Principal AI flag hook, DEFAULT-OFF first paint.
 *
 * Unlike the student/subjects/revision/practice/test OS hooks, usePrincipalAi
 * has NO exported sync reader and NO dev override — it mirrors useSchoolAdminRbac
 * exactly (DEFAULT_OFF init + async confirm). So the unit-testable guarantee is:
 *
 *   - With no cache, the hook's initial render value is FALSE (legacy school-admin
 *     portal is the safe first paint).
 *   - A stale/expired or malformed cache also yields FALSE.
 *   - A fresh cached { enabled:true } yields TRUE on first paint (post-rollout
 *     repeat visit, no OFF→ON flash).
 *
 * The async getFeatureFlags reconcile is mocked to {} (flag absent → OFF), so the
 * post-effect value stays FALSE unless a fresh cache seeded it TRUE. We don't
 * assert the network path here — that's the route's server-authoritative job
 * (covered E2E).
 *
 * Owning agent: testing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getFeatureFlags = vi.fn(async () => ({} as Record<string, boolean>));
vi.mock('@/lib/supabase', () => ({
  getFeatureFlags: (...args: unknown[]) => getFeatureFlags(...(args as [])),
}));

import { usePrincipalAi } from '@/lib/use-principal-ai';

const CACHE_KEY = 'alfanumrik_principal_ai_flag_v1';

beforeEach(() => {
  localStorage.clear();
  getFeatureFlags.mockClear();
  getFeatureFlags.mockResolvedValue({});
});

afterEach(() => {
  localStorage.clear();
});

describe('usePrincipalAi — default-OFF first paint', () => {
  it('initial value is FALSE with no cache (byte-identical legacy portal)', async () => {
    const { result } = renderHook(() => usePrincipalAi());
    expect(result.current).toBe(false);
    await waitFor(() => expect(getFeatureFlags).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('expired cache is ignored → FALSE on first paint', () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ enabled: true, ts: twoHoursAgo }));
    const { result } = renderHook(() => usePrincipalAi());
    expect(result.current).toBe(false);
  });

  it('malformed cache is ignored → FALSE on first paint', () => {
    localStorage.setItem(CACHE_KEY, '{not json');
    const { result } = renderHook(() => usePrincipalAi());
    expect(result.current).toBe(false);
  });

  it('fresh cached { enabled:true } → TRUE on first paint (no OFF→ON flash post-rollout)', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ enabled: true, ts: Date.now() }));
    const { result } = renderHook(() => usePrincipalAi());
    expect(result.current).toBe(true);
  });

  it('async reconcile flips a stale TRUE cache OFF when the DB flag is absent', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ enabled: true, ts: Date.now() }));
    const { result } = renderHook(() => usePrincipalAi());
    expect(result.current).toBe(true); // optimistic from cache
    await waitFor(() => expect(result.current).toBe(false)); // DB says absent → OFF
  });

  it('requests flags scoped to the school_admin role', async () => {
    renderHook(() => usePrincipalAi());
    await waitFor(() => expect(getFeatureFlags).toHaveBeenCalled());
    expect(getFeatureFlags).toHaveBeenCalledWith({ role: 'school_admin' });
  });
});
