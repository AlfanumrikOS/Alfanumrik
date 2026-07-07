/**
 * REG-78 — Cosmic redesign flag-OFF / production pixel-identity guarantee.
 *
 * ff_cosmic_redesign_v1 defaults OFF, which is production truth. The single
 * most important safety property of the entire Phase 0 foundation is: in
 * PRODUCTION with the flag OFF and no manual override, the cosmic theme NEVER
 * activates. The cosmic CSS in globals.css is scoped under
 * `html[data-design="cosmic"]`, so the whole dark identity hinges on whether
 * CosmicThemeProvider writes that one attribute.
 *
 * The enable decision is now a 4-input OR (with a force-off escape hatch):
 *     forceOff ? false : ( dbFlag || isPreviewEnv || urlForce || localStorageForce )
 *
 * This test pins the contract at the DOM boundary across all those inputs:
 *   - Flag absent / OFF, not preview, no force ⇒ NO `data-design` (production
 *     truth; byte-identical to today). `cosmicEnabled` resolves false.
 *   - NEXT_PUBLIC_VERCEL_ENV='production' + flag OFF + no force ⇒ still OFF.
 *   - Flag ON                                  ⇒ `data-design="cosmic"` written
 *     (proves the switch is live, not a trivial no-op).
 *   - NEXT_PUBLIC_VERCEL_ENV='preview'         ⇒ cosmic auto-ON even with flag
 *     OFF (the whole point: previews show the redesign with no DB seeding).
 *   - ?cosmic=1 / localStorage force='1'       ⇒ cosmic ON in any env.
 *   - ?cosmic=0 / localStorage force='0'       ⇒ cosmic OFF even on a preview
 *     and even with the DB flag ON (force-off beats everything).
 *
 * In JSDOM `process.env.NEXT_PUBLIC_VERCEL_ENV` is undefined → isPreviewEnv()
 * is false, so the historic "absent flag ⇒ OFF" assertions exercise the
 * not-preview path unchanged. The preview/production cases stub the env var.
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

function ProbeEnabled() {
  const { cosmicEnabled } = useCosmicTheme();
  return <span data-testid="enabled">{String(cosmicEnabled)}</span>;
}

/**
 * JSDOM keeps window.location read-only-ish; redefine `search` per test so the
 * provider's `new URLSearchParams(window.location.search)` reads our override.
 */
function setSearch(search: string): void {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, search },
    writable: true,
  });
}

describe('REG-78 — CosmicThemeProvider flag-OFF / production DOM safety', () => {
  beforeEach(() => {
    getFeatureFlagsMock.mockReset();
    // Clean any attributes a prior render left on <html> + the flag cache.
    document.documentElement.removeAttribute('data-design');
    document.documentElement.removeAttribute('data-role');
    document.documentElement.removeAttribute('data-theme');
    window.localStorage.clear();
    // Default: no URL override and no preview env (JSDOM has it undefined, but
    // be explicit so a leaked stub from another test can't bleed in).
    setSearch('');
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    setSearch('');
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

  // ── NEW: production env safety ───────────────────────────────────────────
  it('stays OFF in PRODUCTION env with the flag OFF and no force (byte-identical)', async () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production');
    getFeatureFlagsMock.mockResolvedValue({ ff_cosmic_redesign_v1: false });

    const { getByTestId } = render(
      <CosmicThemeProvider>
        <ProbeEnabled />
      </CosmicThemeProvider>,
    );

    await waitFor(() => expect(getFeatureFlagsMock).toHaveBeenCalled());
    expect(getByTestId('enabled').textContent).toBe('false');
    expect(document.documentElement.getAttribute('data-design')).toBeNull();
    expect(document.documentElement.getAttribute('data-role')).toBeNull();
  });

  // ── NEW: preview env auto-enables cosmic ─────────────────────────────────
  it('auto-enables cosmic on a PREVIEW deploy even with the flag OFF', async () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview');
    getFeatureFlagsMock.mockResolvedValue({ ff_cosmic_redesign_v1: false });

    const { getByTestId } = render(
      <CosmicThemeProvider>
        <ProbeEnabled />
      </CosmicThemeProvider>,
    );

    await waitFor(() => expect(getByTestId('enabled').textContent).toBe('true'));
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-design')).toBe('cosmic');
    });
    expect(document.documentElement.getAttribute('data-role')).toBe('student');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  // ── NEW: ?cosmic=1 manual override enables in any env ────────────────────
  it('enables cosmic via ?cosmic=1 even in production with the flag OFF', async () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production');
    setSearch('?cosmic=1');
    getFeatureFlagsMock.mockResolvedValue({ ff_cosmic_redesign_v1: false });

    const { getByTestId } = render(
      <CosmicThemeProvider>
        <ProbeEnabled />
      </CosmicThemeProvider>,
    );

    await waitFor(() => expect(getByTestId('enabled').textContent).toBe('true'));
    expect(document.documentElement.getAttribute('data-design')).toBe('cosmic');
    // ?cosmic=1 is persisted so it survives client navigation.
    expect(window.localStorage.getItem('alfanumrik_cosmic_force')).toBe('1');
  });

  it('enables cosmic via persisted localStorage force "1" (no URL param)', async () => {
    window.localStorage.setItem('alfanumrik_cosmic_force', '1');
    getFeatureFlagsMock.mockResolvedValue({ ff_cosmic_redesign_v1: false });

    const { getByTestId } = render(
      <CosmicThemeProvider>
        <ProbeEnabled />
      </CosmicThemeProvider>,
    );

    await waitFor(() => expect(getByTestId('enabled').textContent).toBe('true'));
    expect(document.documentElement.getAttribute('data-design')).toBe('cosmic');
  });

  it('treats ?cosmic=preview (case-insensitive) as an enable override', async () => {
    setSearch('?cosmic=PREVIEW');
    getFeatureFlagsMock.mockResolvedValue({ ff_cosmic_redesign_v1: false });

    const { getByTestId } = render(
      <CosmicThemeProvider>
        <ProbeEnabled />
      </CosmicThemeProvider>,
    );

    await waitFor(() => expect(getByTestId('enabled').textContent).toBe('true'));
    expect(window.localStorage.getItem('alfanumrik_cosmic_force')).toBe('1');
  });

  // ── NEW: ?cosmic=0 force-off beats every enable signal ───────────────────
  it('force-disables via ?cosmic=0 even on a PREVIEW deploy', async () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview');
    setSearch('?cosmic=0');
    getFeatureFlagsMock.mockResolvedValue({ ff_cosmic_redesign_v1: false });

    const { getByTestId } = render(
      <CosmicThemeProvider>
        <ProbeEnabled />
      </CosmicThemeProvider>,
    );

    await waitFor(() => expect(getByTestId('enabled').textContent).toBe('false'));
    expect(document.documentElement.getAttribute('data-design')).toBeNull();
    // ?cosmic=0 is persisted as the force-off marker.
    expect(window.localStorage.getItem('alfanumrik_cosmic_force')).toBe('0');
  });

  it('force-disables via ?cosmic=0 even when the DB flag is ON', async () => {
    setSearch('?cosmic=0');
    getFeatureFlagsMock.mockResolvedValue({ ff_cosmic_redesign_v1: true });

    const { getByTestId } = render(
      <CosmicThemeProvider>
        <ProbeEnabled />
      </CosmicThemeProvider>,
    );

    await waitFor(() => expect(getFeatureFlagsMock).toHaveBeenCalled());
    expect(getByTestId('enabled').textContent).toBe('false');
    expect(document.documentElement.getAttribute('data-design')).toBeNull();
  });

  it('force-disables via persisted localStorage force "0" on a preview', async () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview');
    window.localStorage.setItem('alfanumrik_cosmic_force', '0');
    getFeatureFlagsMock.mockResolvedValue({ ff_cosmic_redesign_v1: true });

    const { getByTestId } = render(
      <CosmicThemeProvider>
        <ProbeEnabled />
      </CosmicThemeProvider>,
    );

    await waitFor(() => expect(getFeatureFlagsMock).toHaveBeenCalled());
    expect(getByTestId('enabled').textContent).toBe('false');
    expect(document.documentElement.getAttribute('data-design')).toBeNull();
  });
});
