/**
 * SchoolAdminReportsPage — loadClassOptions error vs empty (render unit).
 *
 * WHY THIS EXISTS
 *   loadClassOptions used to swallow failures, leaving an inscrutable empty
 *   dropdown (a reports-only admin lacking `class.manage` gets a 403). It now:
 *     - sets classOptionsError on non-OK / throw and surfaces a bilingual error
 *       notice WITH a Retry (role="alert"); and
 *     - on a successful-but-empty response shows a DISTINCT "No classes found"
 *       empty hint (NOT an error).
 *   These tests drive the Class Performance tab and pin both branches.
 *
 *   The Class Performance tab triggers loadClassOptions on first activation
 *   (when classOptions is empty and not yet loaded). We mock fetch so the
 *   /api/school-admin/classes call returns the per-test outcome; the default
 *   /api/school-admin/reports overview call (school_overview tab) succeeds.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Hoisted so the vi.mock factories (which are hoisted above normal consts) can
// reference these safely.
const { SCHOOL_ID, stableRouter } = vi.hoisted(() => ({
  SCHOOL_ID: '11111111-1111-4111-a111-111111111111',
  // Stable router object: fetchAdminRecord lists `router` in its useCallback
  // deps, so a fresh object each render would loop the admin-record effect.
  stableRouter: { replace: () => {}, push: () => {} },
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ authUserId: 'admin-user-1', isLoading: false, isHi: false }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => stableRouter }));

vi.mock('@alfanumrik/lib/supabase', () => {
  const builder: Record<string, unknown> = {};
  ['select', 'eq'].forEach((m) => { builder[m] = vi.fn().mockReturnValue(builder); });
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: { school_id: SCHOOL_ID }, error: null });
  return {
    supabase: {
      from: vi.fn(() => builder),
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok-123' } } }) },
    },
  };
});

import SchoolAdminReportsPage from '@/app/school-admin/reports/page';

/** Build a fetch mock: overview report always succeeds; the classes endpoint
 *  resolves to the provided outcome. */
function makeFetch(classesOutcome: { ok: boolean; body: unknown }) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/school-admin/classes')) {
      return Promise.resolve({ ok: classesOutcome.ok, json: async () => classesOutcome.body });
    }
    // /api/school-admin/reports?type=school_overview → minimal valid payload.
    return Promise.resolve({
      ok: true,
      json: async () => ({
        success: true,
        data: { total_quizzes: 0, avg_score: 0, active_students: 0, completion_rate: 0, subject_performance: [], grade_performance: [] },
      }),
    });
  });
}

async function gotoClassPerformanceTab() {
  // Wait for the admin record to resolve and the page to leave the skeleton.
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Class Performance' })).toBeDefined());
  fireEvent.click(screen.getByRole('tab', { name: 'Class Performance' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reports page — class options FAILURE surfaces error + Retry', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', makeFetch({ ok: false, body: { error: 'Forbidden' } }));
  });

  it('shows the bilingual error notice with a Retry (not a silently empty dropdown)', async () => {
    render(React.createElement(SchoolAdminReportsPage));
    await gotoClassPerformanceTab();

    // The role="alert" error notice renders…
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByText("Couldn't load classes.")).toBeDefined();
    // …with a Retry button inside the notice.
    const retry = screen.getAllByRole('button', { name: 'Retry' });
    expect(retry.length).toBeGreaterThan(0);
    // And the "no classes found" empty hint is NOT shown (this is an error, not empty).
    expect(screen.queryByText('No classes found for this school yet.')).toBeNull();
  });
});

describe('reports page — class options SUCCESS-but-EMPTY shows the empty hint', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', makeFetch({ ok: true, body: { data: [] } }));
  });

  it('shows the distinct "No classes found" empty hint, not an error', async () => {
    render(React.createElement(SchoolAdminReportsPage));
    await gotoClassPerformanceTab();

    await waitFor(() =>
      expect(screen.getByText('No classes found for this school yet.')).toBeDefined(),
    );
    // No error notice for a successful-but-empty load.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText("Couldn't load classes.")).toBeNull();
  });
});
