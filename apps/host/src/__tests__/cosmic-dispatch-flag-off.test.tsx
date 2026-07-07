/**
 * REG-79 — Cosmic dispatcher flag-OFF → legacy selection contract.
 *
 * REG-78 pins the foundation: with the flag OFF, CosmicThemeProvider writes no
 * `data-design` attribute and `cosmicEnabled` resolves false. This entry pins
 * the NEXT link in the chain — the page-level DISPATCH decision that every
 * cosmic surface keys off:
 *
 *   src/app/dashboard/page.tsx       cosmicEnabled ? <CosmicAboveFoldHero/> : <AboveFoldHero/>
 *   src/app/parent/page.tsx          cosmicEnabled ? <CosmicParentHome/>    : <legacy markup>
 *   …and the Phase-3 portal shells gate their Starfield + portal class on it.
 *
 * The single switch behind ALL of those branches is `useCosmicTheme().cosmicEnabled`,
 * resolved by the real <CosmicThemeProvider> from the client flag read path
 * (getFeatureFlags). If that switch ever reads true while the flag is OFF — or
 * the dispatch ternary is inverted — production would silently flip to the
 * cosmic skin for every user. This test wires the EXACT dispatch shape the
 * pages use (cosmicEnabled ? cosmic : legacy) to the REAL provider and asserts:
 *
 *   - flag ABSENT  (production truth) ⇒ legacy branch renders, cosmic does NOT
 *   - flag false                      ⇒ legacy branch renders, cosmic does NOT
 *   - flag true                       ⇒ cosmic branch renders, legacy does NOT
 *                                        (proves the OFF result isn't a dead switch)
 *
 * We mock only the flag read path (getFeatureFlags) and useAuth — behavior over
 * implementation, mirroring cosmic-flag-off-safety.test.tsx. The dispatch
 * components are inert sentinels: the contract under test is the SELECTION, not
 * the (separately-tested) cosmic compositions themselves.
 *
 * NOTE: removing or weakening this test requires user approval — it is the
 * enforcing test for the REG-79 regression-catalog entry.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

// ── mock the auth context so the provider can read activeRole ─────────────────
vi.mock('@alfanumrik/lib/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({ activeRole: 'student' }) as ReturnType<typeof actual.useAuth>,
  };
});

// ── mock the client flag read path. Default: cosmic flag ABSENT (⇒ OFF). ──────
const getFeatureFlagsMock = vi.fn<() => Promise<Record<string, boolean>>>();
vi.mock('@alfanumrik/lib/supabase', () => ({
  getFeatureFlags: () => getFeatureFlagsMock(),
}));

import { CosmicThemeProvider, useCosmicTheme } from '@alfanumrik/lib/cosmic-theme';

/**
 * Faithful replica of the page-level dispatch ternary used by the student
 * dashboard and parent home: render the cosmic branch ONLY when cosmicEnabled,
 * otherwise the legacy branch. The two branches are inert sentinels so the
 * assertion is purely about which one the live hook selects.
 */
function CosmicDispatcher() {
  const { cosmicEnabled } = useCosmicTheme();
  return cosmicEnabled ? (
    <div data-testid="branch-cosmic">cosmic</div>
  ) : (
    <div data-testid="branch-legacy">legacy</div>
  );
}

describe('REG-79 — cosmic dispatch flag-OFF stays legacy', () => {
  beforeEach(() => {
    getFeatureFlagsMock.mockReset();
    document.documentElement.removeAttribute('data-design');
    document.documentElement.removeAttribute('data-role');
    document.documentElement.removeAttribute('data-theme');
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the LEGACY branch (not cosmic) when the flag is ABSENT', async () => {
    // Production truth: the flag row simply isn't present in the table.
    getFeatureFlagsMock.mockResolvedValue({ some_other_flag: true });

    const { queryByTestId } = render(
      <CosmicThemeProvider>
        <CosmicDispatcher />
      </CosmicThemeProvider>,
    );

    await waitFor(() => expect(getFeatureFlagsMock).toHaveBeenCalled());
    // The dispatch must settle on legacy and NEVER show the cosmic branch.
    await waitFor(() => expect(queryByTestId('branch-legacy')).not.toBeNull());
    expect(queryByTestId('branch-cosmic')).toBeNull();
  });

  it('renders the LEGACY branch when the flag is explicitly false', async () => {
    getFeatureFlagsMock.mockResolvedValue({ ff_cosmic_redesign_v1: false });

    const { queryByTestId } = render(
      <CosmicThemeProvider>
        <CosmicDispatcher />
      </CosmicThemeProvider>,
    );

    await waitFor(() => expect(getFeatureFlagsMock).toHaveBeenCalled());
    await waitFor(() => expect(queryByTestId('branch-legacy')).not.toBeNull());
    expect(queryByTestId('branch-cosmic')).toBeNull();
  });

  it('renders the COSMIC branch when the flag is ON (switch is live, not dead)', async () => {
    // Proves the flag-OFF legacy result is a real decision, not a switch that
    // can never flip — otherwise the OFF assertions above would be vacuous.
    getFeatureFlagsMock.mockResolvedValue({ ff_cosmic_redesign_v1: true });

    const { queryByTestId } = render(
      <CosmicThemeProvider>
        <CosmicDispatcher />
      </CosmicThemeProvider>,
    );

    await waitFor(() => expect(queryByTestId('branch-cosmic')).not.toBeNull());
    expect(queryByTestId('branch-legacy')).toBeNull();
  });
});
