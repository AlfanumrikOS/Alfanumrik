/**
 * /school-admin page dispatch — Command Center is the SOLE home (render unit).
 *
 * WHY THIS EXISTS
 *   The `ff_school_command_center` legacy/new toggle was removed (2026-06-16):
 *   `src/app/school-admin/page.tsx` renders <CommandCenter /> directly with NO
 *   dependence on the flag, and the old Atlas body was renamed to
 *   `_deprecated_AtlasSchoolAdmin` and is no longer dispatched.
 *
 *   This focused test pins exactly that: even with `useSchoolCommandCenter`
 *   mocked OFF, the page renders the Command Center and NEVER the deprecated
 *   Atlas body. (The page no longer imports the flag hook at all — the mock
 *   below is a belt-and-suspenders proof that, were it consulted, an OFF value
 *   would NOT downgrade the surface.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// The flag hook is mocked OFF — the page must ignore it entirely.
vi.mock('@alfanumrik/lib/use-school-command-center', () => ({
  useSchoolCommandCenter: () => false,
}));

// Stub the two candidate bodies so we can assert which one the page dispatches
// without importing their real data layers.
vi.mock('@/app/school-admin/CommandCenter', () => ({
  default: () => React.createElement('div', { 'data-testid': 'command-center' }, 'Command Center'),
}));
import SchoolAdminPage from '@/app/school-admin/page';

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('SchoolAdminPage — unconditional Command Center dispatch', () => {
  it('renders the Command Center even with the flag mocked OFF', () => {
    render(React.createElement(SchoolAdminPage));
    expect(screen.getByTestId('command-center')).toBeDefined();
  });

  it('does NOT render any atlas-school-admin testid (structural — the deprecated component is deleted)', () => {
    render(React.createElement(SchoolAdminPage));
    // The deprecated file has been deleted; this confirms nothing sneaked it back in.
    expect(screen.queryByTestId('atlas-school-admin')).toBeNull();
  });
});
