/**
 * CommandCenter — first-run "Get started" setup checklist (behavioral render unit).
 *
 * P0 fix (2026-06-16)
 *   A brand-new school admin lands on an EMPTY Command Center with nothing to
 *   click — they could not discover the provisioning surfaces (setup / invite-
 *   codes / enroll / classes) needed to bring students & teachers on board. The
 *   fix adds a dismissible <SetupChecklist> that renders ONLY when the overview
 *   resolves to data_state === 'no_data', linking to the four provisioning pages.
 *
 *   This file pins the render CONTRACT against the REAL <CommandCenter /> with a
 *   controllable fetch backend (the gold-standard pattern from
 *   `pulse-flag-gate.test.tsx`):
 *     - no_data overview  ⇒ the "Get your school started" checklist renders WITH
 *       all 4 provisioning links (/school-admin/{setup,invite-codes,enroll,classes}).
 *     - live (non-empty) overview ⇒ the checklist is ABSENT (a populated school
 *       has no need for the first-run nudge).
 *
 *   `SetupChecklist` is a private (non-exported) sub-component, so we exercise it
 *   through the host exactly as a real admin would. The four <a href> links are
 *   real anchors (pure navigation, no fetch/mutation), and the EN copy is
 *   assertable on screen.
 */

import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SWRConfig } from 'swr';
import React from 'react';

// ── Host-context mocks: English, full permissions so ONLY the data state gates ──
let mockIsHi = false;
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: mockIsHi, signOut: vi.fn(), setLanguage: vi.fn() }),
}));
vi.mock('@alfanumrik/lib/usePermissions', () => ({ usePermissions: () => ({ can: () => true }) }));

// Optional sections OFF so the no_data path is the only thing under test.
vi.mock('@alfanumrik/lib/use-school-pulse-flag', () => ({ useSchoolPulseFlag: () => false }));
vi.mock('@alfanumrik/lib/use-school-provisioning', () => ({ useSchoolProvisioning: () => false }));
vi.mock('@alfanumrik/lib/pulse/use-pulse', () => ({
  useSchoolPulse: () => ({ data: null, error: null, isLoading: false, mutate: vi.fn() }),
}));

// Code-split panels → no-op so their chunks never load under jsdom.
vi.mock('next/dynamic', () => ({ default: () => () => null }));

// Keep NoDataState (rendered by OverviewStrip on no_data) inert so we assert
// purely on the SetupChecklist, not the empty-strip copy. StatCard is the real
// component (Task 1.2 — OverviewStrip's KPI tiles now render via the shared
// admin-ui StatCard instead of the removed local Kpi component); it renders
// plain DOM (label/value), so it's inert enough to leave un-mocked here.
vi.mock('@alfanumrik/ui/admin-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/ui/admin-ui')>();
  return { ...actual, NoDataState: () => null };
});

import CommandCenter from '@/app/school-admin/CommandCenter';

// ── Controllable fetch backend keyed by URL fragment ──────────────────────────
type OverviewMode = 'no_data' | 'live';
const backend = { overview: 'no_data' as OverviewMode };

function makeOverviewBody(mode: OverviewMode) {
  const data = mode === 'no_data'
    ? {
        class_count: 0, teacher_count: 0, student_count: 0, seats_purchased: 0,
        active_students: 0, seat_utilization_pct: null, avg_mastery: null,
        data_state: 'no_data' as const,
      }
    : {
        class_count: 4, teacher_count: 6, student_count: 120, seats_purchased: 150,
        active_students: 110, seat_utilization_pct: 73, avg_mastery: 0.62,
        data_state: 'live' as const,
      };
  return { data, data_state: data.data_state };
}

function stubFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/api/school-admin/overview')) {
      return { ok: true, status: 200, json: async () => makeOverviewBody(backend.overview) };
    }
    // The two list panels are dynamic()'d to null here, but their SWR keys still
    // fetch — return an empty page so they settle without error.
    return { ok: true, status: 200, json: async () => ({ data: [], limit: 20, offset: 0, count: 0 }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const renderCommandCenter = () =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <CommandCenter />
    </SWRConfig>,
  );

beforeEach(() => {
  mockIsHi = false;
  backend.overview = 'no_data';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const PROVISIONING_HREFS = [
  '/school-admin/setup',
  '/school-admin/invite-codes',
  '/school-admin/enroll',
  '/school-admin/classes',
];

describe('CommandCenter — setup checklist on the no_data (brand-new school) state', () => {
  it('renders the "Get your school started" checklist when the overview is no_data', async () => {
    backend.overview = 'no_data';
    stubFetch();
    renderCommandCenter();

    await waitFor(() =>
      expect(screen.getByText(/Get your school started/i)).toBeDefined(),
    );
  });

  it('renders all 4 provisioning links (setup / invite-codes / enroll / classes)', async () => {
    backend.overview = 'no_data';
    stubFetch();
    const { container } = renderCommandCenter();

    await waitFor(() =>
      expect(screen.getByText(/Get your school started/i)).toBeDefined(),
    );

    for (const href of PROVISIONING_HREFS) {
      const link = container.querySelector(`a[href="${href}"]`);
      expect(link, `expected a provisioning link to ${href}`).not.toBeNull();
    }
    // Exactly the 4 declared steps inside the checklist section.
    const checklist = screen.getByLabelText('Get started');
    expect(checklist.querySelectorAll('a[href^="/school-admin/"]')).toHaveLength(4);
  });

  it('renders the Hindi checklist heading when isHi=true (P7)', async () => {
    mockIsHi = true;
    backend.overview = 'no_data';
    stubFetch();
    renderCommandCenter();

    await waitFor(() =>
      expect(screen.getByText(/अपना स्कूल शुरू करें/)).toBeDefined(),
    );
  });
});

describe('CommandCenter — setup checklist absent on a populated (live) school', () => {
  it('does NOT render the checklist when the overview has live data', async () => {
    backend.overview = 'live';
    const fetchMock = stubFetch();
    renderCommandCenter();

    // Wait for the overview fetch to resolve so the data_state is known.
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/school-admin/overview'))).toBe(true),
    );
    // The KPI strip renders (control: the live overview is on screen)…
    await waitFor(() => expect(screen.getByLabelText('School overview')).toBeDefined());

    // …and the first-run nudge is absent for a populated school.
    expect(screen.queryByText(/Get your school started/i)).toBeNull();
    expect(screen.queryByLabelText('Get started')).toBeNull();
  });
});
