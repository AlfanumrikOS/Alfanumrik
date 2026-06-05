/**
 * REG-78 — Cosmic redesign flag-OFF pixel-identity guarantee (Phase 0).
 *
 * ff_cosmic_redesign_v1 defaults OFF, which is production truth today. The
 * single most important safety property of the entire Phase 0 foundation is:
 * with the flag OFF, the cosmic theme NEVER activates. The cosmic CSS in
 * globals.css is scoped under `html[data-design="cosmic"]`, so the whole dark
 * identity hinges on whether CosmicThemeProvider writes that one attribute.
 *
 * This test pins the contract at the DOM boundary:
 *   - Flag absent / OFF  ⇒ NO `data-design` attribute is written to <html>,
 *     so the cosmic token scope can never match. The app is pixel-identical
 *     to today. `cosmicEnabled` resolves false.
 *   - Flag ON            ⇒ `data-design="cosmic"` IS written, proving the
 *     attribute is the live switch (and that flag-OFF isn't passing for a
 *     trivial reason like the provider never writing anything at all).
 *
 * We mock `getFeatureFlags` (the client read path the provider uses) rather
 * than the provider's own logic — testing behavior, not implementation. We
 * also mock `useAuth` so the provider can read `activeRole` without a full
 * AuthProvider tree.
 *
 * NOTE: removing or weakening this test requires user approval — it is the
 * enforcing test for the REG-78 regression-catalog entry.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

// ── mock the auth context so the provider can read activeRole ─────────────────
vi.mock('@/lib/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({ activeRole: 'student' }) as ReturnType<typeof actual.useAuth>,
  };
});

// ── mock the client flag read path. Default: cosmic flag ABSENT (⇒ OFF). ──────
const getFeatureFlagsMock = vi.fn<() => Promise<Record<string, boolean>>>();
vi.mock('@/lib/supabase', () => ({
  getFeatureFlags: () => getFeatureFlagsMock(),
}));

import { CosmicThemeProvider, useCosmicTheme } from '@/lib/cosmic-theme';

function ProbeEnabled() {
  const { cosmicEnabled } = useCosmicTheme();
  return <span data-testid="enabled">{String(cosmicEnabled)}</span>;
}

describe('REG-78 — CosmicThemeProvider flag-OFF DOM safety', () => {
  beforeEach(() => {
    getFeatureFlagsMock.mockReset();
    // Clean any attributes a prior render left on <html> + the flag cache.
    document.documentElement.removeAttribute('data-design');
    document.documentElement.removeAttribute('data-role');
    document.documentElement.removeAttribute('data-theme');
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('writes NO data-design / data-role when the cosmic flag is ABSENT', async () => {
    // Flag table returns other flags but not ff_cosmic_redesign_v1 → undefined → OFF.
    getFeatureFlagsMock.mockResolvedValue({ some_other_flag: true });

    render(
      <CosmicThemeProvider>
        <ProbeEnabled />
      </CosmicThemeProvider>,
    );

    // Let the async flag-resolution effect settle.
    await waitFor(() => expect(getFeatureFlagsMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-design')).toBeNull();
    });
    expect(document.documentElement.getAttribute('data-role')).toBeNull();
  });

  it('writes NO data-design when the cosmic flag is explicitly false', async () => {
    getFeatureFlagsMock.mockResolvedValue({ ff_cosmic_redesign_v1: false });

    const { getByTestId } = render(
      <CosmicThemeProvider>
        <ProbeEnabled />
      </CosmicThemeProvider>,
    );

    await waitFor(() => expect(getByTestId('enabled').textContent).toBe('false'));
    expect(document.documentElement.getAttribute('data-design')).toBeNull();
  });

  it('does NOT clobber data-theme when the flag is OFF (AuthContext owns it)', async () => {
    // AuthContext force-writes data-theme="light" in the flag-OFF world. The
    // cosmic provider must leave it untouched so the two don't fight.
    document.documentElement.setAttribute('data-theme', 'light');
    getFeatureFlagsMock.mockResolvedValue({});

    render(
      <CosmicThemeProvider>
        <ProbeEnabled />
      </CosmicThemeProvider>,
    );

    await waitFor(() => expect(getFeatureFlagsMock).toHaveBeenCalled());
    // data-theme is still exactly what AuthContext set.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('writes data-design="cosmic" when the flag is ON (switch is live)', async () => {
    // Proves flag-OFF safety isn't a false positive from a no-op provider.
    getFeatureFlagsMock.mockResolvedValue({ ff_cosmic_redesign_v1: true });

    const { getByTestId } = render(
      <CosmicThemeProvider>
        <ProbeEnabled />
      </CosmicThemeProvider>,
    );

    await waitFor(() => expect(getByTestId('enabled').textContent).toBe('true'));
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-design')).toBe('cosmic');
    });
    // Role + theme attributes also land when ON.
    expect(document.documentElement.getAttribute('data-role')).toBe('student');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
