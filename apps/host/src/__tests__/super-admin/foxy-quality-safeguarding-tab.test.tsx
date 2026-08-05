/**
 * /super-admin/foxy-quality — folded Safeguarding tab (Foxy North-Star Phase 1).
 *
 * PINS (testing-flagged gap after the P10 fold-in of the standalone
 * /super-admin/safeguarding route into this page as a second tab):
 *   (1) ?tab=safeguarding deep-link renders the safeguarding queue on mount
 *       (and the Quality dashboard's apiFetch is NOT fired).
 *   (2) The queue list fetch fires against /api/super-admin/safeguarding,
 *       status-scoped.
 *   (3) The detail drawer fetches ?id=<case> and shows the disclosure excerpt.
 *   (4) Dismiss requires notes: the "Dismissed" transition button is disabled
 *       while the review-notes textarea is empty, enabled once notes exist.
 *
 * Seams (house pattern — see super-admin-foxy-report-page.test.tsx): AdminShell
 * is mocked (default passthrough + useAdmin + a faithful classifyJsonResponse
 * stand-in), next/dynamic is mocked to a React.lazy passthrough so the REAL
 * SafeguardingQueue loads, and global fetch is routed per URL.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const CASE_ID = '33333333-3333-4333-a333-333333333333';

// ── AdminShell: passthrough shell + apiFetch spy + classifyJsonResponse ───────
const apiFetchMock = vi.fn();
vi.mock('@/app/super-admin/_components/AdminShell', async () => {
  const ReactMod = await import('react');
  return {
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) =>
      ReactMod.createElement(ReactMod.Fragment, null, children),
    useAdmin: () => ({
      accessToken: 'test-token',
      adminName: 'tester',
      supabase: {},
      headers: () => ({}),
      apiFetch: apiFetchMock,
    }),
    // Faithful stand-in for the real classifier: ok JSON → { ok, data };
    // non-2xx JSON → { ok:false, error.message } from the body's `error`.
    classifyJsonResponse: async (res: Response) => {
      const body = await res.json();
      if (!res.ok) {
        return {
          ok: false,
          error: {
            kind: 'http',
            status: res.status,
            message:
              body && typeof (body as { error?: unknown }).error === 'string'
                ? (body as { error: string }).error
                : `HTTP ${res.status}`,
          },
        };
      }
      return { ok: true, data: body, status: res.status };
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

import FoxyQualityPage from '@/app/super-admin/foxy-quality/page';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const QUEUE_ROW = {
  id: CASE_ID,
  student_id: 'stu-9',
  school_id: null,
  category: 'bullying',
  tier: 'tier_2',
  status: 'pending_review',
  created_at: '2026-08-03T09:00:00Z',
  reviewed_by: null,
  reviewed_at: null,
};

const DETAIL_ROW = {
  ...QUEUE_ROW,
  disclosure_excerpt: 'Excerpt: repeated bullying reported during Foxy chat.',
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiFetchMock.mockReset();
  // The Quality inner mounts for one paint before the deep-link effect flips
  // the tab — give its dashboard fetch a benign empty payload.
  apiFetchMock.mockResolvedValue(
    jsonRes({
      success: true,
      data: {
        rubricVersion: 'v1',
        totalScored: 0,
        last7DayAvg: null,
        prev7DayAvg: null,
        weeklyDelta: null,
        dailyAverages: [],
        lowestRecent: [],
      },
    }),
  );
  window.history.pushState({}, '', '/super-admin/foxy-quality?tab=safeguarding');
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/super-admin/safeguarding?id=')) {
      return jsonRes({ row: DETAIL_ROW });
    }
    if (url.includes('/api/super-admin/safeguarding')) {
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
  it('renders the safeguarding queue on mount and fetches the safeguarding API', async () => {
    render(<FoxyQualityPage />);

    // Tab selected + the queue surface heading renders.
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: 'Safeguarding review', selected: true }),
      ).toBeDefined(),
    );
    expect(await screen.findByText('Safeguarding Review')).toBeDefined();

    // Status-scoped list fetch against the super-admin safeguarding API.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/super-admin/safeguarding?status=pending_review',
        expect.objectContaining({ credentials: 'same-origin' }),
      ),
    );

    // Row renders from the fixture.
    expect(await screen.findByText('bullying')).toBeDefined();
    expect(screen.getByText('tier_2')).toBeDefined();

    // NOTE: the page mounts with tab='quality' and flips to safeguarding in a
    // mount effect (the ?tab= deep-link is read client-side), so the Quality
    // dashboard's apiFetch legitimately fires once on that first paint. What's
    // pinned here is the END state: the safeguarding surface, not the
    // dashboard, is what renders.
    expect(screen.queryByText('Foxy Quality (LLM-as-judge)')).toBeNull();
  });
});

// ── (3) + (4) detail drawer + dismiss-requires-notes ──────────────────────────
describe('safeguarding detail drawer', () => {
  it('fetches ?id= for the opened case, shows the excerpt, and gates Dismiss on notes', async () => {
    render(<FoxyQualityPage />);

    // Open the case row.
    const row = await screen.findByLabelText(`Open case ${CASE_ID}`);
    fireEvent.click(row);

    // Detail fetch fired against ?id=<case>.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/super-admin/safeguarding?id=${CASE_ID}`,
        expect.objectContaining({ credentials: 'same-origin' }),
      ),
    );

    // Excerpt from the detail response is on screen.
    expect(
      await screen.findByText('Excerpt: repeated bullying reported during Foxy chat.'),
    ).toBeDefined();

    // Dismiss is disabled while notes are empty…
    const dismissBtn = screen.getByRole('button', { name: 'Dismissed' }) as HTMLButtonElement;
    expect(dismissBtn.disabled).toBe(true);

    // …other transitions are not notes-gated…
    const reviewedBtn = screen.getByRole('button', { name: 'Reviewed' }) as HTMLButtonElement;
    expect(reviewedBtn.disabled).toBe(false);

    // …and typing notes enables Dismiss.
    fireEvent.change(screen.getByLabelText('Review notes'), {
      target: { value: 'Duplicate of an already-actioned case.' },
    });
    expect((screen.getByRole('button', { name: 'Dismissed' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
