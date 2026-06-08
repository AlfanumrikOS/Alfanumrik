/**
 * Phase 3B Wave A / A5 — flag gate parity for the School Command Center.
 *
 * The single invariant: `ff_school_command_center` gates BOTH the /school-admin
 * page dispatch AND the consolidated school nav, and DEFAULTS OFF. When OFF,
 * neither surface shows the Command Center / 5-section nav — they render the
 * prior (legacy stat-tile) surface byte-identically.
 *
 * `useSchoolCommandCenter` is the single client gate both surfaces consume.
 * Pinning its default-OFF behaviour (synchronous first paint OFF, async confirm
 * OFF unless the flag is explicitly true) is the cheapest, most robust proof
 * that flag-OFF is byte-identical: every consumer branches on this one boolean
 * and falls through to the legacy surface when it is false. This deterministic
 * sync-OFF is what guarantees there is no first-paint flash for the production
 * (flag-absent) user.
 *
 * Mirrors `src/__tests__/teacher/command-center-flag-gate.test.tsx` (Phase 3A).
 */

import { waitFor, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── localStorage shim (jsdom provides it via setup.ts, but ensure clean slate). ─
beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.clearAllMocks();
});

// ── getFeatureFlags mock — controllable per test via a module-level holder. ──
const flagHolder: { flags: Record<string, boolean> } = { flags: {} };
vi.mock('@/lib/supabase', () => ({
  getFeatureFlags: vi.fn(async () => flagHolder.flags),
}));

import { useSchoolCommandCenter } from '@/lib/use-school-command-center';
import { SCHOOL_COMMAND_CENTER_FLAGS } from '@/lib/feature-flags';

describe('useSchoolCommandCenter — default OFF (no first-paint flash)', () => {
  it('initialises OFF synchronously and stays OFF when the flag is absent', async () => {
    flagHolder.flags = {}; // unseeded — production reality
    const { result } = renderHook(() => useSchoolCommandCenter());

    // FIRST synchronous paint MUST be OFF (byte-identical legacy surface).
    // No cache, no async resolution yet — the hook returns DEFAULT_OFF deterministically.
    expect(result.current).toBe(false);

    // The async confirm keeps it OFF (flag absent ⇒ resolves false).
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('stays OFF when the flag resolves explicitly false', async () => {
    flagHolder.flags = { [SCHOOL_COMMAND_CENTER_FLAGS.V1]: false };
    const { result } = renderHook(() => useSchoolCommandCenter());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('flips ON only after the async confirm when the flag resolves true', async () => {
    flagHolder.flags = { [SCHOOL_COMMAND_CENTER_FLAGS.V1]: true };
    const { result } = renderHook(() => useSchoolCommandCenter());
    // Sync paint is still OFF (no cache primed yet) — proves the default is the
    // safe legacy paint even for a flagged-on admin's first-ever visit.
    expect(result.current).toBe(false);
    // Async confirm flips it ON.
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('stays OFF when getFeatureFlags rejects (network/auth failure)', async () => {
    const supabase = await import('@/lib/supabase');
    (supabase.getFeatureFlags as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network down'),
    );
    const { result } = renderHook(() => useSchoolCommandCenter());
    expect(result.current).toBe(false);
    // Optimistic default-OFF is retained through the rejection.
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('requests flags scoped to the school_admin role', async () => {
    const supabase = await import('@/lib/supabase');
    const spy = supabase.getFeatureFlags as unknown as ReturnType<typeof vi.fn>;
    flagHolder.flags = {};
    renderHook(() => useSchoolCommandCenter());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith({ role: 'school_admin' });
  });
});
