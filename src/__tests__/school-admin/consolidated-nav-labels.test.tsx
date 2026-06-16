/**
 * ConsolidatedSchoolNav — Academics nav label rename (render unit).
 *
 * WHY THIS EXISTS
 *   The Academics section labels were renamed to disambiguate the two reporting
 *   surfaces that share the section:
 *     - 'Reports'       → 'Academic Reports' (hi 'शैक्षणिक रिपोर्ट')  href /school-admin/reports
 *     - 'School Report' → 'Board Report'      (hi 'बोर्ड रिपोर्ट')    href /school-admin/reports-depth
 *   hrefs are UNCHANGED. These tests pin the new labels AND the unchanged hrefs
 *   so a future copy edit can't silently break the routing target, and assert the
 *   old labels are gone (no stale 'Reports'/'School Report' text in the nav).
 *
 *   The "Board Report" entry is `reportsDepthOnly`, so it only renders with
 *   reportsDepthEnabled + its analytics module enabled — both supplied here.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import ConsolidatedSchoolNav from '@/app/school-admin/_components/ConsolidatedSchoolNav';

// twMerge + type-only imports are the only deps; no module mocks required.

function renderNav(overrides: Record<string, unknown> = {}) {
  return render(
    React.createElement(ConsolidatedSchoolNav, {
      brandTitle: 'Greenwood High',
      brandSubtitle: 'School Administration',
      currentPath: '/school-admin',
      isHi: false,
      // Enable analytics so the analytics-gated Academic Reports + Board Report show.
      moduleEnablement: { analytics: true, lms: true, testing_engine: true, communication: true, ai_tutor: true },
      // Board Report is reportsDepthOnly → needs this ON to render.
      reportsDepthEnabled: true,
      ...overrides,
    }) as React.ReactElement,
  );
}

/** The desktop rail carries every item; scope queries to it to avoid the
 *  (un-rendered until opened) mobile drawer duplicating entries. */
function desktopRail() {
  return screen.getByTestId('school-consolidated-nav-desktop');
}

describe('ConsolidatedSchoolNav — Academics labels (English)', () => {
  it('renders the new "Academic Reports" label', () => {
    renderNav();
    expect(within(desktopRail()).getByText('Academic Reports')).toBeDefined();
  });

  it('renders the new "Board Report" label when reports-depth is enabled', () => {
    renderNav();
    expect(within(desktopRail()).getByText('Board Report')).toBeDefined();
  });

  it('no longer renders the OLD bare "Reports" label', () => {
    renderNav();
    expect(within(desktopRail()).queryByText('Reports')).toBeNull();
  });

  it('no longer renders the OLD "School Report" label', () => {
    renderNav();
    expect(within(desktopRail()).queryByText('School Report')).toBeNull();
  });
});

describe('ConsolidatedSchoolNav — hrefs unchanged after the rename', () => {
  it('"Academic Reports" still points at /school-admin/reports', () => {
    renderNav();
    const link = within(desktopRail()).getByText('Academic Reports').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/school-admin/reports');
  });

  it('"Board Report" still points at /school-admin/reports-depth', () => {
    renderNav();
    const link = within(desktopRail()).getByText('Board Report').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/school-admin/reports-depth');
  });
});

describe('ConsolidatedSchoolNav — Hindi labels (P7)', () => {
  it('renders the Hindi labels शैक्षणिक रिपोर्ट and बोर्ड रिपोर्ट', () => {
    renderNav({ isHi: true });
    const rail = desktopRail();
    expect(within(rail).getByText('शैक्षणिक रिपोर्ट')).toBeDefined();
    expect(within(rail).getByText('बोर्ड रिपोर्ट')).toBeDefined();
  });
});

describe('ConsolidatedSchoolNav — Board Report respects its flag gate', () => {
  it('hides "Board Report" when reportsDepthEnabled is false (byte-identical-OFF)', () => {
    renderNav({ reportsDepthEnabled: false });
    const rail = desktopRail();
    // Academic Reports still shows (not flag-gated)…
    expect(within(rail).getByText('Academic Reports')).toBeDefined();
    // …but the deep Board Report entry is filtered out entirely.
    expect(within(rail).queryByText('Board Report')).toBeNull();
  });
});
