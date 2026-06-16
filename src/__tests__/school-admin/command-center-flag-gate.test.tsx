/**
 * School Command Center — UNCONDITIONAL render contract (render unit).
 *
 * CONTRACT CHANGE (2026-06-16)
 *   The `ff_school_command_center` legacy/new TOGGLE was removed from the
 *   school-admin surfaces. The flag was globally ON in prod, so the legacy
 *   dispatch (and its first-paint flag race) was deleted entirely:
 *     - `src/app/school-admin/page.tsx` now renders <CommandCenter /> directly,
 *       with NO branch on the flag and NO import of `useSchoolCommandCenter`.
 *     - `SchoolAdminShell` always renders the consolidated 5-section
 *       <ConsolidatedSchoolNav>, with NO branch on the flag.
 *     - `AtlasSchoolAdmin` was renamed to `_deprecated_AtlasSchoolAdmin` and is
 *       no longer rendered by any live surface.
 *
 *   This file PREVIOUSLY pinned the now-removed contract ("flag OFF ⇒ legacy
 *   surface byte-identical, flag ON ⇒ Command Center"). That OFF→legacy
 *   assertion is INVALID now that the UI no longer branches on the flag. Rather
 *   than delete the coverage, it is converted to pin the NEW invariant: BOTH
 *   school-admin surfaces render the Command Center / ConsolidatedSchoolNav
 *   REGARDLESS of the `useSchoolCommandCenter` flag value (the hook may still
 *   exist in the lib, but no school-admin surface consumes it anymore).
 *
 * NOTE: the teacher equivalent (`src/__tests__/teacher/command-center-flag-gate.test.tsx`)
 * is unchanged — only the school-admin surfaces were forced-purple.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ── Flag holder: lets each test drive the (now-unused) flag value to PROVE the
//    surfaces do not branch on it. Default OFF mirrors production reality. ──────
const flagHolder = { enabled: false };
vi.mock('@/lib/use-school-command-center', () => ({
  useSchoolCommandCenter: () => flagHolder.enabled,
}));

// ── /school-admin page dispatch: stub the two candidate bodies so we can assert
//    WHICH one renders without dragging their data layers in. ───────────────────
vi.mock('@/app/school-admin/CommandCenter', () => ({
  default: () => React.createElement('div', { 'data-testid': 'command-center' }, 'Command Center'),
}));
vi.mock('@/app/school-admin/_deprecated_AtlasSchoolAdmin', () => ({
  default: () => React.createElement('div', { 'data-testid': 'atlas-school-admin' }, 'Atlas'),
}));

// ── SchoolAdminShell seams. We only care that ConsolidatedSchoolNav renders, so
//    stub it (and the other client-only hooks the shell imports at module scope). ─
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/school-admin',
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ authUserId: 'admin-user-1', isHi: false }) }));
vi.mock('@/lib/tenant-context', () => ({
  useTenant: () => ({ schoolName: 'Greenwood High', schoolId: 's1', branding: { primaryColor: '#7C3AED', logoUrl: null, showPoweredBy: false } }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null }), then: (r: (v: unknown) => unknown) => r({ data: null }) })) } }));
// useAtlasFlag must stay OFF: when ON the shell short-circuits to {children} and
// never renders the nav. Forced-purple keeps the consolidated nav unconditional.
vi.mock('@/lib/use-atlas-flag', () => ({ useAtlasFlag: () => false }));
vi.mock('@/lib/use-school-reports-depth', () => ({ useSchoolReportsDepth: () => false }));
vi.mock('@/lib/use-school-admin-rbac', () => ({ useSchoolAdminRbac: () => false }));
vi.mock('@/lib/use-school-admin-role', () => ({ useSchoolAdminRole: () => ({ role: null }) }));
vi.mock('@/lib/use-principal-ai', () => ({ usePrincipalAi: () => false }));
vi.mock('@/lib/cosmic-theme', () => ({ useCosmicTheme: () => ({ cosmicEnabled: false }) }));
vi.mock('@/components/cosmic', () => ({ Starfield: () => null }));
vi.mock('@/app/school-admin/_components/ConsolidatedSchoolNav', () => ({
  default: () => React.createElement('nav', { 'data-testid': 'consolidated-school-nav' }, 'Consolidated Nav'),
}));

// `fetch` (module-enablement) — keep it a benign no-op so the shell effect runs clean.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
  flagHolder.enabled = false;
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

import SchoolAdminPage from '@/app/school-admin/page';
import SchoolAdminShell from '@/app/school-admin/_components/SchoolAdminShell';

describe('/school-admin page — Command Center renders UNCONDITIONALLY', () => {
  it('renders the Command Center when the (now-unused) flag is OFF', () => {
    flagHolder.enabled = false;
    render(React.createElement(SchoolAdminPage));
    expect(screen.getByTestId('command-center')).toBeDefined();
    // The deprecated Atlas body must NEVER render.
    expect(screen.queryByTestId('atlas-school-admin')).toBeNull();
  });

  it('renders the Command Center when the (now-unused) flag is ON', () => {
    flagHolder.enabled = true;
    render(React.createElement(SchoolAdminPage));
    expect(screen.getByTestId('command-center')).toBeDefined();
    expect(screen.queryByTestId('atlas-school-admin')).toBeNull();
  });
});

describe('SchoolAdminShell — ConsolidatedSchoolNav renders UNCONDITIONALLY', () => {
  it('renders the consolidated nav when the (now-unused) flag is OFF', () => {
    flagHolder.enabled = false;
    render(
      React.createElement(SchoolAdminShell, null, React.createElement('div', { 'data-testid': 'shell-child' }, 'child')),
    );
    expect(screen.getByTestId('consolidated-school-nav')).toBeDefined();
    expect(screen.getByTestId('shell-child')).toBeDefined();
  });

  it('renders the consolidated nav when the (now-unused) flag is ON', () => {
    flagHolder.enabled = true;
    render(
      React.createElement(SchoolAdminShell, null, React.createElement('div', { 'data-testid': 'shell-child' }, 'child')),
    );
    expect(screen.getByTestId('consolidated-school-nav')).toBeDefined();
    expect(screen.getByTestId('shell-child')).toBeDefined();
  });
});
