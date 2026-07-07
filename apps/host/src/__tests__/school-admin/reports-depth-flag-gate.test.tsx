/**
 * Phase 3B Wave D / D-tests — flag gate parity for the school-wide academic
 * REPORTING DEPTH UI.
 *
 * The single invariant: `ff_school_reports_depth` gates the reporting-depth UI
 * surfaces (the board/parent-ready mastery + Bloom's reports + export surface,
 * plus its Academics-section nav entry) and DEFAULTS OFF. When OFF, those
 * surfaces render the prior portal byte-identically (no reporting surface, no
 * nav link).
 *
 * `useSchoolReportsDepth` is the single client gate those surfaces consume.
 * Pinning its default-OFF behaviour (synchronous first paint OFF, async confirm
 * OFF unless the flag is explicitly true) is the cheapest, most robust proof that
 * flag-OFF is byte-identical: every consumer branches on this one boolean and
 * falls through to the legacy surface when it is false. The server routes are the
 * actual security boundary (this hook is UI-only — P9); the FLAG-OFF server
 * byte-identity (404-before-auth on all three reporting routes) is proven
 * separately in `src/__tests__/api/school-admin/reports-depth-routes.test.ts`.
 *
 * Mirrors `src/__tests__/school-admin/command-center-flag-gate.test.tsx` (Wave A),
 * `provisioning-flag-gate.test.tsx` (Wave B), and `rbac-flag-gate.test.tsx`
 * (Wave C) seam-for-seam.
 */

import { waitFor, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.clearAllMocks();
});

const flagHolder: { flags: Record<string, boolean> } = { flags: {} };
vi.mock('@alfanumrik/lib/supabase', () => ({
  getFeatureFlags: vi.fn(async () => flagHolder.flags),
}));

import { useSchoolReportsDepth } from '@alfanumrik/lib/use-school-reports-depth';
import { SCHOOL_REPORTS_DEPTH_FLAGS } from '@alfanumrik/lib/feature-flags';

describe('useSchoolReportsDepth — default OFF (no first-paint flash)', () => {
  it('initialises OFF synchronously and stays OFF when the flag is absent', async () => {
    flagHolder.flags = {}; // unseeded — production reality
    const { result } = renderHook(() => useSchoolReportsDepth());

    // FIRST synchronous paint MUST be OFF (byte-identical portal: no reports UI).
    expect(result.current).toBe(false);

    // The async confirm keeps it OFF (flag absent ⇒ resolves false).
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('stays OFF when the flag resolves explicitly false', async () => {
    flagHolder.flags = { [SCHOOL_REPORTS_DEPTH_FLAGS.V1]: false };
    const { result } = renderHook(() => useSchoolReportsDepth());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('flips ON only after the async confirm when the flag resolves true', async () => {
    flagHolder.flags = { [SCHOOL_REPORTS_DEPTH_FLAGS.V1]: true };
    const { result } = renderHook(() => useSchoolReportsDepth());
    // Sync paint is still OFF (no cache primed yet) — proves the default is the
    // safe portal paint even for a flagged-on admin's first-ever visit.
    expect(result.current).toBe(false);
    // Async confirm flips it ON.
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('stays OFF when getFeatureFlags rejects (network/auth failure)', async () => {
    const supabase = await import('@alfanumrik/lib/supabase');
    (supabase.getFeatureFlags as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network down'),
    );
    const { result } = renderHook(() => useSchoolReportsDepth());
    expect(result.current).toBe(false);
    // Optimistic default-OFF is retained through the rejection.
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('requests flags scoped to the school_admin role', async () => {
    const supabase = await import('@alfanumrik/lib/supabase');
    const spy = supabase.getFeatureFlags as unknown as ReturnType<typeof vi.fn>;
    flagHolder.flags = {};
    renderHook(() => useSchoolReportsDepth());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith({ role: 'school_admin' });
  });
});
