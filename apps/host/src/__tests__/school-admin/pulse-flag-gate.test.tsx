/**
 * REG-124 — `ff_school_pulse_v1` flag gate (Round 2 pin, 2026-06-12).
 *
 * The single invariant: while `ff_school_pulse_v1` is OFF or still unresolved,
 * the School Pulse section of the school-admin Command Center does NOT mount —
 * therefore `useSchoolPulse` never runs (no SWR key) and ZERO `/api/pulse/school`
 * fetches fire. Default OFF is pinned at every layer that encodes it:
 *
 *   1. Hook layer — `useSchoolPulseFlag()` initialises OFF synchronously
 *      (no first-paint flash) and only flips ON after the async confirm
 *      resolves the flag explicitly true. Mirrors the established precedent
 *      `src/__tests__/school-admin/command-center-flag-gate.test.tsx`
 *      (useSchoolCommandCenter) test-for-test.
 *   2. Behavioral layer — the REAL <CommandCenter /> rendered with FULL
 *      permissions (can() → true, so ONLY the flag gates): flag OFF/absent ⇒
 *      the "School Pulse" section is absent and fetch is never called with
 *      /api/pulse/school, while the host's own overview fetch DOES fire
 *      (control: the component is alive, SWR is live — the suppression is the
 *      flag's doing, not a dead page). Flag ON ⇒ the section mounts and
 *      /api/pulse/school IS fetched (non-vacuity control for the OFF test).
 *   3. Static layer — FLAG_DEFAULTS pins `ff_school_pulse_v1: false`; the seed
 *      migration 20260619000100 inserts is_enabled=false / rollout=0 with
 *      ON CONFLICT DO NOTHING; and the CommandCenter source keeps the
 *      conditional-render guard (`pulseEnabled && can('institution.view_analytics')`)
 *      around <SchoolPulseSection>, with the ONLY `useSchoolPulse(` call site
 *      inside that gated section — the structural reason fetch suppression
 *      holds (no mount ⇒ no hook ⇒ no SWR key ⇒ no request).
 *
 * NOT a security boundary (P9): /api/pulse/school enforces
 * `institution.view_analytics` + school membership server-side regardless
 * (REG-121). This pin protects the OFF-path byte-identity / kill-switch
 * contract (P10-adjacent) the CEO-approved F2+F3 remediation introduced.
 */

import { render, renderHook, screen, waitFor, cleanup } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SWRConfig } from 'swr';

// ── localStorage shim (jsdom provides it via setup.ts; ensure clean slate). ──
beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── getFeatureFlags mock — controllable per test via a module-level holder. ──
const flagHolder: { flags: Record<string, boolean> } = { flags: {} };
vi.mock('@alfanumrik/lib/supabase', () => ({
  getFeatureFlags: vi.fn(async () => flagHolder.flags),
}));

// ── Host-context mocks: full permissions so ONLY the flag gates the section. ──
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({
    isHi: false,
    signOut: vi.fn(),
    setLanguage: vi.fn(),
  }),
}));
vi.mock('@alfanumrik/lib/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}));

import { useSchoolPulseFlag } from '@alfanumrik/lib/use-school-pulse-flag';
import { SCHOOL_PULSE_FLAGS, FLAG_DEFAULTS } from '@alfanumrik/lib/feature-flags';
import CommandCenter from '@/app/school-admin/CommandCenter';

// ═════════════════════════════════════════════════════════════════════════════
// 1. Hook layer — default OFF, no first-paint flash (precedent mirror)
// ═════════════════════════════════════════════════════════════════════════════

describe('useSchoolPulseFlag — default OFF (no first-paint flash)', () => {
  it('initialises OFF synchronously and stays OFF when the flag is absent', async () => {
    flagHolder.flags = {}; // unseeded — production reality
    const { result } = renderHook(() => useSchoolPulseFlag());

    // FIRST synchronous paint MUST be OFF (byte-identical Command Center).
    expect(result.current).toBe(false);

    // The async confirm keeps it OFF (flag absent ⇒ resolves false).
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('stays OFF when the flag resolves explicitly false', async () => {
    flagHolder.flags = { [SCHOOL_PULSE_FLAGS.V1]: false };
    const { result } = renderHook(() => useSchoolPulseFlag());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('flips ON only after the async confirm when the flag resolves true', async () => {
    flagHolder.flags = { [SCHOOL_PULSE_FLAGS.V1]: true };
    const { result } = renderHook(() => useSchoolPulseFlag());
    // Sync paint is still OFF (no cache primed) — the default is the safe
    // no-Pulse paint even for a flagged-on admin's first-ever visit.
    expect(result.current).toBe(false);
    // Async confirm flips it ON.
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('stays OFF when getFeatureFlags rejects (network/auth failure)', async () => {
    const supabase = await import('@alfanumrik/lib/supabase');
    (supabase.getFeatureFlags as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network down'),
    );
    const { result } = renderHook(() => useSchoolPulseFlag());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('requests flags scoped to the school_admin role', async () => {
    const supabase = await import('@alfanumrik/lib/supabase');
    const spy = supabase.getFeatureFlags as unknown as ReturnType<typeof vi.fn>;
    flagHolder.flags = {};
    renderHook(() => useSchoolPulseFlag());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith({ role: 'school_admin' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Behavioral layer — fetch suppression on the REAL CommandCenter
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Minimal Response-alike: both ccFetcher and pulseFetcher only read .ok,
 * .status and .json(). A 500 keeps every panel in a deterministic error state
 * (no data-shape coupling) — what we assert is WHICH URLs were requested.
 */
function stubFetch() {
  const fetchMock = vi.fn(async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: 'offline test backend' }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const calledWith = (fetchMock: ReturnType<typeof vi.fn>, fragment: string) =>
  fetchMock.mock.calls.some(([url]) => String(url).includes(fragment));

/** Fresh SWR cache per render so dedupe/error caches never leak across tests. */
const renderCommandCenter = () =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <CommandCenter />
    </SWRConfig>,
  );

describe('CommandCenter — School Pulse fetch suppression while the flag is OFF', () => {
  it('flag OFF/absent ⇒ Pulse section not mounted and ZERO /api/pulse/school fetches (overview fetch fires as the alive-control)', async () => {
    flagHolder.flags = {}; // unseeded — production reality
    const fetchMock = stubFetch();

    renderCommandCenter();

    // Control 1: the component is alive — the host's own eager fetch fired.
    await waitFor(() =>
      expect(calledWith(fetchMock, '/api/school-admin/overview')).toBe(true),
    );
    // Control 2: the flag confirm has resolved (the async OFF is final, not pending).
    const supabase = await import('@alfanumrik/lib/supabase');
    await waitFor(() =>
      expect(supabase.getFeatureFlags as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled(),
    );

    // The invariant: section absent + zero school-pulse requests.
    expect(screen.queryByLabelText('School Pulse')).toBeNull();
    expect(calledWith(fetchMock, '/api/pulse/school')).toBe(false);
  });

  it('flag ON ⇒ the section mounts and /api/pulse/school IS fetched (non-vacuity control)', async () => {
    flagHolder.flags = { [SCHOOL_PULSE_FLAGS.V1]: true };
    const fetchMock = stubFetch();

    renderCommandCenter();

    // The async confirm flips the gate ON, the section mounts, useSchoolPulse
    // builds its SWR key and the request fires.
    await waitFor(
      () => expect(calledWith(fetchMock, '/api/pulse/school')).toBe(true),
      { timeout: 3000 },
    );
    expect(screen.queryByLabelText('School Pulse')).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Static layer — default-OFF + guard pins (REG-124)
// ═════════════════════════════════════════════════════════════════════════════

describe('REG-124 static pins — default OFF at every layer', () => {
  it('FLAG_DEFAULTS pins ff_school_pulse_v1 to false under the exact flag name', () => {
    expect(SCHOOL_PULSE_FLAGS.V1).toBe('ff_school_pulse_v1');
    expect(FLAG_DEFAULTS[SCHOOL_PULSE_FLAGS.V1]).toBe(false);
  });

  it('seed migration 20260619000100 inserts the flag DISABLED (is_enabled=false, rollout=0) and idempotently', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260619000100_seed_ff_school_pulse_v1.sql'),
      'utf8',
    );
    // Column order pins the meaning of the literals below.
    expect(sql).toMatch(
      /INSERT INTO public\.feature_flags \(\s*flag_name,\s*is_enabled,\s*rollout_percentage,/,
    );
    // The flag row is seeded OFF / 0% — seeding makes it auditable, never live.
    expect(sql).toMatch(/VALUES\s*\(\s*'ff_school_pulse_v1',\s*false,\s*0,/);
    // Idempotent re-run safety (flag_name unique constraint).
    expect(sql).toContain('ON CONFLICT (flag_name) DO NOTHING');
  });

  it('CommandCenter keeps the conditional-render guard and the ONLY useSchoolPulse call site inside the gated section', () => {
    const ccSource = readFileSync(
      resolve(process.cwd(), 'src/app/school-admin/CommandCenter.tsx'),
      'utf8',
    );

    // The gate variable comes from the single flag hook…
    expect(ccSource).toMatch(/const pulseEnabled = useSchoolPulseFlag\(\)/);
    // …and the JSX guard double-gates the section (flag FIRST, then UX perm).
    expect(ccSource).toMatch(
      /\{pulseEnabled && can\('institution\.view_analytics'\) && \(\s*<SchoolPulseSection/,
    );

    // Structural fetch-suppression proof: `useSchoolPulse(` (the data hook —
    // the regex's literal "(" cannot match `useSchoolPulseFlag(`) is called
    // EXACTLY once, inside SchoolPulseSection (which only mounts under the
    // guard) — so flag OFF ⇒ no hook ⇒ no SWR key ⇒ no /api/pulse/school.
    const dataHookCalls = ccSource.match(/useSchoolPulse\(/g) ?? [];
    expect(dataHookCalls).toHaveLength(1);

    const callIdx = ccSource.indexOf('useSchoolPulse(');
    const sectionIdx = ccSource.indexOf('function SchoolPulseSection');
    const hostIdx = ccSource.indexOf('export default function CommandCenter');
    expect(sectionIdx).toBeGreaterThan(-1);
    expect(hostIdx).toBeGreaterThan(sectionIdx);
    expect(callIdx).toBeGreaterThan(sectionIdx);
    expect(callIdx).toBeLessThan(hostIdx);
  });
});
