/**
 * /school-admin/escalations — folded safeguarding tab (Foxy North-Star Phase 1)
 * + safeguarding notification rows in the Escalations tab (additive contract).
 *
 * PINS (testing-flagged gap after the P10 fold-in of the standalone
 * /school-admin/safeguarding route into this page as a second tab):
 *   (1) ?tab=safeguarding deep-link renders the safeguarding tab on mount.
 *   (2) The queue list fetch fires against /api/school-admin/safeguarding
 *       (status-scoped), NOT the escalations API.
 *   (3) Dismiss requires notes: the "Dismissed" transition button is disabled
 *       while the review-notes textarea is empty, enabled once notes exist.
 *   (4) The detail drawer fetches ?id=<case> and shows the disclosure excerpt.
 *   (5) Escalations-tab safeguarding rows render the type badge bilingually
 *       (typeLabel / typeLabelHi) and link to
 *       /school-admin/escalations?tab=safeguarding; rows lacking the additive
 *       fields (pre-deploy data) fall back gracefully; teacher rows unchanged.
 *
 * Seams (house pattern — see parents-page-load-states.test.tsx): AuthContext,
 * supabase (school_admins + getSession), next/navigation (stable router),
 * global fetch. next/dynamic is mocked to a React.lazy passthrough so the real
 * SafeguardingQueue loads; next/link renders a plain <a> so hrefs are
 * assertable without an app-router context.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const SCHOOL_ID = '11111111-1111-4111-a111-111111111111';
const CASE_ID = '22222222-2222-4222-a222-222222222222';

// ── Auth: signed in; isHi controllable per test ───────────────────────────────
let isHiValue = false;
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({
    authUserId: 'admin-user-1',
    isLoading: false,
    isHi: isHiValue,
    setLanguage: vi.fn(),
  }),
}));

// ── Router: STABLE object (useCallback deps — see parents test) ───────────────
const routerReplace = vi.fn();
const stableRouter = { replace: routerReplace, push: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => stableRouter,
}));

// ── Supabase: valid school-admin record + session token ───────────────────────
vi.mock('@alfanumrik/lib/supabase', () => {
  const builder: Record<string, unknown> = {};
  ['select', 'eq'].forEach((m) => { builder[m] = vi.fn().mockReturnValue(builder); });
  // NOTE: literal (not the SCHOOL_ID const) — vi.mock factories are hoisted
  // above module-scope const initialization.
  builder.maybeSingle = vi.fn().mockResolvedValue({
    data: { school_id: '11111111-1111-4111-a111-111111111111' },
    error: null,
  });
  return {
    supabase: {
      from: vi.fn(() => builder),
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok-123' } } }),
      },
    },
  };
});

// ── next/dynamic → React.lazy passthrough (the REAL SafeguardingQueue loads) ──
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

// ── next/link → plain anchor (href assertable, no app-router context) ─────────
vi.mock('next/link', async () => {
  const ReactMod = await import('react');
  return {
    __esModule: true,
    default: ({ href, children, ...rest }: any) =>
      ReactMod.createElement('a', { href, ...rest }, children),
  };
});

import SchoolAdminEscalationsPage from '@/app/school-admin/escalations/page';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const TEACHER_ROW = {
  id: 'esc-1',
  title: 'Escalation',
  message: 'Student needs attention in Maths.',
  is_read: false,
  created_at: '2026-08-01T10:00:00Z',
  student_id: null,
  class_id: null,
};

const SAFEGUARDING_ROW = {
  id: 'esc-2',
  title: 'Safeguarding case raised',
  message: 'A safeguarding case needs review.',
  is_read: false,
  created_at: '2026-08-02T10:00:00Z',
  student_id: null,
  class_id: null,
  type: 'safeguarding_escalation',
  typeLabel: 'Safeguarding',
  typeLabelHi: 'सुरक्षा',
  link: '/school-admin/escalations?tab=safeguarding',
};

// Pre-deploy row: safeguarding type but NONE of the additive label/link fields.
const LEGACY_SAFEGUARDING_ROW = {
  id: 'esc-3',
  title: '',
  message: 'Older safeguarding notification.',
  is_read: true,
  created_at: '2026-07-20T10:00:00Z',
  student_id: null,
  class_id: null,
  type: 'safeguarding_escalation',
};

const QUEUE_ROW = {
  id: CASE_ID,
  student_id: 'stu-1',
  school_id: SCHOOL_ID,
  category: 'self_harm',
  tier: 'tier_1',
  status: 'pending_review',
  created_at: '2026-08-03T09:00:00Z',
  reviewed_by: null,
  reviewed_at: null,
};

const DETAIL_ROW = {
  ...QUEUE_ROW,
  disclosure_excerpt: 'Excerpt: the student disclosed feeling unsafe.',
};

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  isHiValue = false;
  routerReplace.mockClear();
  window.history.pushState({}, '', '/school-admin/escalations');
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/school-admin/escalations')) {
      return jsonRes({ success: true, data: [TEACHER_ROW, SAFEGUARDING_ROW, LEGACY_SAFEGUARDING_ROW] });
    }
    if (url.includes('/api/school-admin/safeguarding?id=')) {
      return jsonRes({ row: DETAIL_ROW });
    }
    if (url.startsWith('/api/school-admin/safeguarding')) {
      return jsonRes({ rows: [QUEUE_ROW] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── (1) + (2) deep-link + queue fetch target ──────────────────────────────────
describe('deep-link ?tab=safeguarding', () => {
  it('renders the safeguarding tab on mount and fetches the safeguarding queue API', async () => {
    window.history.pushState({}, '', '/school-admin/escalations?tab=safeguarding');

    render(<SchoolAdminEscalationsPage />);

    // Page-level tab is selected…
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Safeguarding', selected: true })).toBeDefined(),
    );

    // …and the queue's list fetch went to the safeguarding API, status-scoped.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/school-admin/safeguarding?status=pending_review',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }),
        }),
      ),
    );

    // The queue row renders (tier + category badges from the fixture).
    expect(await screen.findByText('tier_1')).toBeDefined();
    expect(screen.getByText('self_harm')).toBeDefined();

    // The escalations API was NOT called while on the safeguarding tab.
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/school-admin/escalations')),
    ).toBe(false);
  });
});

// ── (3) + (4) detail drawer + dismiss-requires-notes ──────────────────────────
describe('safeguarding detail drawer', () => {
  it('fetches ?id= for the opened case, shows the excerpt, and gates Dismiss on notes', async () => {
    window.history.pushState({}, '', '/school-admin/escalations?tab=safeguarding');

    render(<SchoolAdminEscalationsPage />);

    // Open the case from the list.
    const rowButton = await screen.findByRole('button', { name: 'Open case detail' });
    fireEvent.click(rowButton);

    // Detail fetch fired against ?id=<case>.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/school-admin/safeguarding?id=${CASE_ID}`,
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }),
        }),
      ),
    );

    // Excerpt from the detail response is on screen.
    expect(
      await screen.findByText('Excerpt: the student disclosed feeling unsafe.'),
    ).toBeDefined();

    // Dismiss is disabled while notes are empty…
    const dismissBtn = screen.getByRole('button', { name: 'Dismissed' }) as HTMLButtonElement;
    expect(dismissBtn.disabled).toBe(true);

    // …other transitions are not notes-gated…
    const reviewedBtn = screen.getByRole('button', { name: 'Reviewed' }) as HTMLButtonElement;
    expect(reviewedBtn.disabled).toBe(false);

    // …and typing notes enables Dismiss.
    fireEvent.change(screen.getByLabelText('Review notes'), {
      target: { value: 'Spoke with counsellor; false alarm.' },
    });
    expect((screen.getByRole('button', { name: 'Dismissed' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

// ── (5) escalations-tab safeguarding rows: badge, link, bilingual, fallback ───
describe('escalations tab — safeguarding notification rows', () => {
  it('renders the EN type badge and links the row to the safeguarding tab; teacher rows unchanged', async () => {
    render(<SchoolAdminEscalationsPage />);

    // Wait for the list to render (row title), THEN count the label: it must
    // appear at least twice — the page-level tab label AND the row badge.
    // (findAllByText alone would resolve early on the tab label match.)
    expect(await screen.findByText('Safeguarding case raised')).toBeDefined();
    expect(screen.getAllByText('Safeguarding').length).toBeGreaterThanOrEqual(2);

    // Both safeguarding rows (labelled + legacy) link to the safeguarding tab.
    const links = screen.getAllByRole('link', { name: 'Open safeguarding queue' });
    expect(links).toHaveLength(2);
    links.forEach((a) => {
      expect(a.getAttribute('href')).toBe('/school-admin/escalations?tab=safeguarding');
    });

    // Teacher row renders exactly as before (heading + message), not a link.
    expect(screen.getByText('Teacher escalation')).toBeDefined();
    expect(screen.getByText('Student needs attention in Maths.')).toBeDefined();
  });

  it('renders the Hindi type label when isHi=true (typeLabelHi), with fallback for legacy rows', async () => {
    isHiValue = true;

    render(<SchoolAdminEscalationsPage />);

    // Wait for the list (legacy row message) — no crash on the legacy row.
    expect(await screen.findByText('Older safeguarding notification.')).toBeDefined();

    // Labelled row uses typeLabelHi; legacy row (no fields) falls back to the
    // built-in Hindi label — both resolve to 'सुरक्षा', plus the tab label → ≥3.
    expect(screen.getAllByText('सुरक्षा').length).toBeGreaterThanOrEqual(3);

    // Teacher heading is bilingual too (unchanged behavior). It appears both
    // as the page header title and the teacher card heading.
    expect(screen.getAllByText('शिक्षक एस्केलेशन').length).toBeGreaterThanOrEqual(2);
  });
});
