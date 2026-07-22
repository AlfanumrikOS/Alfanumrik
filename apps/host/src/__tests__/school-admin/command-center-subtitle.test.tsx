/**
 * CommandCenter — header subtitle copy (render unit).
 *
 * WHY THIS EXISTS
 *   The header subtitle was changed from the misleading 'Read-only overview' to
 *   the accurate 'School overview and analytics' (hi 'स्कूल अवलोकन और विश्लेषण').
 *   These tests pin the NEW copy in both languages and assert the OLD copy is
 *   gone, so a future revert can't reintroduce the stale label unnoticed.
 *
 *   The header renders unconditionally (independent of SWR data state), so we
 *   keep the data layer mocked to a simple loading state and only assert on the
 *   header text.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

let mockIsHi = false;

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: mockIsHi, signOut: vi.fn(), setLanguage: vi.fn() }),
}));
vi.mock('@alfanumrik/lib/usePermissions', () => ({ usePermissions: () => ({ can: () => false }) }));

// Flag + pulse hooks default OFF so the optional Pulse section never mounts.
vi.mock('@alfanumrik/lib/use-school-pulse-flag', () => ({ useSchoolPulseFlag: () => false }));
vi.mock('@alfanumrik/lib/use-school-provisioning', () => ({ useSchoolProvisioning: () => false }));
vi.mock('@alfanumrik/lib/pulse/use-pulse', () => ({ useSchoolPulse: () => ({ data: null, error: null, isLoading: false, mutate: vi.fn() }) }));

// SWR → loading, no data, no error → only the header + skeletons render.
vi.mock('swr', () => ({
  default: () => ({ data: undefined, error: undefined, isLoading: true, mutate: vi.fn() }),
}));

// next/dynamic returns a no-op component so the code-split panels don't load.
vi.mock('next/dynamic', () => ({ default: () => () => null }));

// StatCard is left as the real component (Task 1.2 — OverviewStrip's KPI
// tiles now render via the shared admin-ui StatCard); it's plain inert DOM.
vi.mock('@alfanumrik/ui/admin-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/ui/admin-ui')>();
  return { ...actual, NoDataState: () => null };
});

import CommandCenter from '@/app/school-admin/CommandCenter';

beforeEach(() => {
  mockIsHi = false;
  vi.clearAllMocks();
});

describe('CommandCenter — header subtitle', () => {
  it('renders the new "School overview and analytics" subtitle', () => {
    render(React.createElement(CommandCenter));
    expect(screen.getByText('School overview and analytics')).toBeDefined();
  });

  it('does NOT render the old "Read-only overview" subtitle', () => {
    render(React.createElement(CommandCenter));
    expect(screen.queryByText('Read-only overview')).toBeNull();
  });

  it('renders the Hindi subtitle स्कूल अवलोकन और विश्लेषण when isHi=true (P7)', () => {
    mockIsHi = true;
    render(React.createElement(CommandCenter));
    expect(screen.getByText('स्कूल अवलोकन और विश्लेषण')).toBeDefined();
  });
});
