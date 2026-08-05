/**
 * /school-admin/reports — folded Leadership tab (Foxy North-Star K9, 2026-08-05
 * P10 fold-in). Mirrors the escalations-safeguarding-tab.test.tsx pattern.
 *
 * PINS:
 *   (1) ?tab=leadership deep-link renders the Leadership tab on mount.
 *   (2) The Leadership content fetches /api/school-admin/leadership (the
 *       dashboard's own API), NOT the shared reports API — the K9 dashboard
 *       kept its own endpoint through the fold-in, only the page moved.
 *   (3) The Leadership nav entry (ConsolidatedSchoolNav) points at
 *       /school-admin/reports?tab=leadership — the standalone
 *       /school-admin/leadership route no longer exists.
 *
 * Seams (house pattern): AuthContext, useSchoolAdminAuth, authedFetch (used by
 * the reports page for the other tabs; unused for the Leadership tab), global
 * fetch (the Leadership tab uses raw fetch with cookies). next/dynamic mocked
 * to React.lazy passthrough so the real LeadershipTab loads.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ── AuthContext: signed in, English ──────────────────────────────────────────
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({
    authUserId: 'admin-user-1',
    isLoading: false,
    isHi: false,
    setLanguage: vi.fn(),
  }),
}));

// ── useSchoolAdminAuth: ready with a school id ───────────────────────────────
vi.mock('@alfanumrik/ui/school-admin/use-school-admin-auth', () => ({
  useSchoolAdminAuth: () => ({
    schoolId: '11111111-1111-4111-a111-111111111111',
    isLoading: false,
  }),
}));

// ── authedFetch: not exercised for the Leadership tab, but the module is
// imported at the top of reports/page.tsx so it must resolve. Returns an empty
// success shape defensively in case any effect calls it. ─────────────────────
vi.mock('@alfanumrik/lib/school-admin/authed-fetch', () => ({
  authedFetch: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: null }),
  })),
}));

// ── next/dynamic → React.lazy passthrough (real LeadershipTab loads) ─────────
vi.mock('next/dynamic', async () => {
  const ReactMod = await import('react');
  return {
    __esModule: true,
    default: (loader: () => Promise<any>) => {
      const Lazy = ReactMod.lazy(async () => {
        const mod = await loader();
        return { default: mod.default ?? mod };
      });
      return function DynamicPassthrough(props: any) {
        return ReactMod.createElement(
          ReactMod.Suspense,
          { fallback: null },
          ReactMod.createElement(Lazy, props),
        );
      };
    },
  };
});

import SchoolAdminReportsPage from '@/app/school-admin/reports/page';
import { SCHOOL_NAV_SECTIONS } from '@/app/school-admin/_components/ConsolidatedSchoolNav';

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

const LEADERSHIP_PAYLOAD = {
  school_overview: {
    students_total: 420,
    active_this_week: 310,
    at_risk: 22,
    avg_mastery_pct: 68,
  },
  safeguarding_counts: { open: 2, escalated: 1, resolved_7d: 4 },
  competency_summary: {
    average_growth_pct: 12,
    retention_pct: 87,
    engagement_pct: 74,
    top_competencies: [{ code: 'crit_think', label: 'Critical Thinking', growth_pct: 18 }],
  },
  coverage: {
    subjects_ready: 7,
    subjects_total: 9,
    chapters_ready: 84,
    chapters_total: 120,
    stale_syllabus_rows: 3,
  },
};

beforeEach(() => {
  window.history.pushState({}, '', '/school-admin/reports');
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/school-admin/leadership')) {
      return jsonRes(LEADERSHIP_PAYLOAD);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/school-admin/reports — Leadership tab (folded from /school-admin/leadership)', () => {
  it('renders the Leadership tab on ?tab=leadership deep-link and fetches /api/school-admin/leadership', async () => {
    window.history.pushState({}, '', '/school-admin/reports?tab=leadership');

    render(<SchoolAdminReportsPage />);

    // Leadership tab panel content renders (dashboard header inside the tab).
    await waitFor(
      () => {
        expect(screen.getByTestId('leadership-tab-panel')).toBeTruthy();
      },
      { timeout: 3000 },
    );

    // Fetched the leadership API, not the reports API.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith('/api/school-admin/leadership'))).toBe(true);

    // A tile from the fetched payload is visible (Competency growth section).
    expect(screen.getByText('Critical Thinking')).toBeTruthy();
  });

  it('does NOT load the Leadership tab when no ?tab= is set (school_overview is the default)', () => {
    render(<SchoolAdminReportsPage />);

    // Leadership content is not mounted.
    expect(screen.queryByTestId('leadership-tab-panel')).toBeNull();

    // /api/school-admin/leadership is not called during first paint.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith('/api/school-admin/leadership'))).toBe(false);
  });

  it('ConsolidatedSchoolNav points the Leadership entry at /school-admin/reports?tab=leadership (fold-in target, not the deleted standalone route)', () => {
    const academics = SCHOOL_NAV_SECTIONS.find((s) => s.title === 'Academics');
    expect(academics).toBeTruthy();
    const leadership = academics!.items.find((i) => i.label === 'Leadership');
    expect(leadership).toBeTruthy();
    expect(leadership!.href).toBe('/school-admin/reports?tab=leadership');
    // Regression guard: the standalone route no longer exists.
    expect(leadership!.href).not.toBe('/school-admin/leadership');
  });
});
