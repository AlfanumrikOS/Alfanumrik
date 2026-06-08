/**
 * Phase 3A Wave A / A4 — flag gate parity for both teacher surfaces.
 *
 * The single invariant: `ff_teacher_command_center` gates BOTH the /teacher
 * page dispatch AND the TeacherShell primary nav, and DEFAULTS OFF. When OFF,
 * neither surface shows the Command Center / slim nav — they render the prior
 * (legacy/Atlas) surface unchanged.
 *
 * `useTeacherCommandCenter` is the single client gate both surfaces consume.
 * Pinning its default-OFF behaviour (sync paint OFF, async confirm OFF unless
 * the flag is explicitly true) is the cheapest, most robust proof that flag-OFF
 * is byte-identical: both `TeacherPage` (`if (commandCenter) return …`) and
 * `TeacherShell` (`const primaryNav = commandCenterOn ? slim : full`) branch on
 * this one boolean, and both fall through to the prior surface when it is false.
 */

import { waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── localStorage shim (jsdom provides it, but ensure a clean slate). ──
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

import { useTeacherCommandCenter } from '@/lib/use-teacher-command-center';

describe('useTeacherCommandCenter — default OFF', () => {
  it('initialises OFF (sync) and stays OFF when the flag is absent', async () => {
    flagHolder.flags = {}; // unseeded
    const { result } = renderHook(() => useTeacherCommandCenter());
    // First synchronous paint must be OFF (byte-identical legacy surface).
    expect(result.current).toBe(false);
    // The async confirm keeps it OFF.
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('stays OFF when the flag is explicitly false', async () => {
    flagHolder.flags = { ff_teacher_command_center: false };
    const { result } = renderHook(() => useTeacherCommandCenter());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('flips ON when the flag resolves true', async () => {
    flagHolder.flags = { ff_teacher_command_center: true };
    const { result } = renderHook(() => useTeacherCommandCenter());
    // Sync paint is OFF (no cache yet) → async confirm flips ON.
    await waitFor(() => expect(result.current).toBe(true));
  });
});
