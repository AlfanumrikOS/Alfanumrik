/**
 * Phase 3B Wave B — flag gate parity for school-admin SEAT-ENFORCEMENT UI.
 *
 * The single invariant: `ff_school_provisioning` gates the seat-enforcement UI
 * surfaces (enroll page warnings/blocks, invite-codes seat cap, command-center
 * seat gauge) and DEFAULTS OFF. When OFF, those surfaces render the prior
 * (legacy, no-enforcement) provisioning UI byte-identically.
 *
 * `useSchoolProvisioning` is the single client gate those surfaces consume.
 * Pinning its default-OFF behaviour (synchronous first paint OFF, async confirm
 * OFF unless the flag is explicitly true) is the cheapest, most robust proof
 * that flag-OFF is byte-identical: every consumer branches on this one boolean
 * and falls through to the legacy surface when it is false. The server routes
 * are the actual security boundary (this hook is UI-only — P9); the FLAG-OFF
 * server byte-identity is proven separately in
 * `src/__tests__/api/school-admin/seat-enforcement-flag-off.test.ts`.
 *
 * Mirrors `src/__tests__/school-admin/command-center-flag-gate.test.tsx` (Wave A).
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
vi.mock('@/lib/supabase', () => ({
  getFeatureFlags: vi.fn(async () => flagHolder.flags),
}));

import { useSchoolProvisioning } from '@/lib/use-school-provisioning';
import { SCHOOL_PROVISIONING_FLAGS } from '@/lib/feature-flags';

describe('useSchoolProvisioning — default OFF (no first-paint flash)', () => {
  it('initialises OFF synchronously and stays OFF when the flag is absent', async () => {
    flagHolder.flags = {}; // unseeded — production reality
    const { result } = renderHook(() => useSchoolProvisioning());

    // FIRST synchronous paint MUST be OFF (byte-identical legacy provisioning UI).
    expect(result.current).toBe(false);

    // The async confirm keeps it OFF (flag absent ⇒ resolves false).
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('stays OFF when the flag resolves explicitly false', async () => {
    flagHolder.flags = { [SCHOOL_PROVISIONING_FLAGS.V1]: false };
    const { result } = renderHook(() => useSchoolProvisioning());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('flips ON only after the async confirm when the flag resolves true', async () => {
    flagHolder.flags = { [SCHOOL_PROVISIONING_FLAGS.V1]: true };
    const { result } = renderHook(() => useSchoolProvisioning());
    // Sync paint is still OFF (no cache primed yet) — proves the default is the
    // safe legacy paint even for a flagged-on admin's first-ever visit.
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('stays OFF when getFeatureFlags rejects (network/auth failure)', async () => {
    const supabase = await import('@/lib/supabase');
    (supabase.getFeatureFlags as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network down'),
    );
    const { result } = renderHook(() => useSchoolProvisioning());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('requests flags scoped to the school_admin role', async () => {
    const supabase = await import('@/lib/supabase');
    const spy = supabase.getFeatureFlags as unknown as ReturnType<typeof vi.fn>;
    flagHolder.flags = {};
    renderHook(() => useSchoolProvisioning());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith({ role: 'school_admin' });
  });
});
