import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

/**
 * Student-dashboard client fetchers MUST forward the Bearer token via authedFetch.
 *
 * REGRESSION (batch 1c, 2026-07-14): BoardScoreWidget and ReviewsDueCard each
 * issued a BARE `fetch()` to an `authorizeRequest`-protected API route. The
 * browser Supabase session lives in localStorage, NOT a cookie (plain
 * `createClient`, not `createBrowserClient`), so a cookie-only fetch carries no
 * session and the server returns 401 for EVERY student — both widgets silently
 * broke on every dashboard load (live P0). The fix repoints both at `authedFetch`
 * (from `@alfanumrik/lib/authed-fetch`), which injects
 * `Authorization: Bearer <access_token>` from the live session.
 *
 * This suite pins that contract at the smallest seam: each widget calls the
 * mocked `authedFetch` with its exact API path, and NEVER the bare global
 * `fetch`. A revert to plain `fetch` (which re-opens the 401) fails here — the
 * mocked authedFetch would go uncalled and the bare-fetch spy would fire.
 *
 * Seam: `@alfanumrik/lib/authed-fetch` is mocked (both widgets import it). A spy
 * is also installed on the global `fetch` to assert no bypass.
 */

// ── authedFetch seam (the module both widgets import) ──────────────────────────
vi.mock('@alfanumrik/lib/authed-fetch', () => ({
  authedFetch: vi.fn(),
  getAccessToken: vi.fn(async () => 'test-token'),
}));

// ── ReviewsDueCard's other client deps (isHi + router) ─────────────────────────
let mockIsHi = false;
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: mockIsHi }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// A real Response so `.ok` / `.json()` behave like the platform.
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let bareFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockIsHi = false;
  // Spy on the bare global fetch: a widget must NEVER call it directly (that is
  // exactly the 401-causing regression). authedFetch is mocked, so the real
  // helper's internal fetch does not run either — any hit here is a bypass.
  bareFetch = vi.fn(async () => jsonResponse({}));
  vi.stubGlobal('fetch', bareFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('BoardScoreWidget forwards the Bearer token via authedFetch (not bare fetch)', () => {
  it('calls authedFetch("/api/board-score") and never the bare global fetch', async () => {
    const { authedFetch } = await import('@alfanumrik/lib/authed-fetch');
    vi.mocked(authedFetch).mockResolvedValue(jsonResponse({ code: 'ok', data: [] }));

    const { default: BoardScoreWidget } = await import('@alfanumrik/ui/dashboard/os/BoardScoreWidget');
    render(React.createElement(BoardScoreWidget, { isHi: false, studentId: 'stu-1' }));

    await waitFor(() => expect(authedFetch).toHaveBeenCalledWith('/api/board-score'));
    // Regression guard: a revert to plain fetch would hit the bare global fetch.
    expect(bareFetch).not.toHaveBeenCalled();
  });

  it('does not fetch at all when there is no studentId (guarded — never a header-less request)', async () => {
    const { authedFetch } = await import('@alfanumrik/lib/authed-fetch');
    vi.mocked(authedFetch).mockResolvedValue(jsonResponse({ code: 'ok', data: [] }));

    const { default: BoardScoreWidget } = await import('@alfanumrik/ui/dashboard/os/BoardScoreWidget');
    render(React.createElement(BoardScoreWidget, { isHi: false, studentId: undefined }));

    expect(authedFetch).not.toHaveBeenCalled();
    expect(bareFetch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ReviewsDueCard forwards the Bearer token via authedFetch (real SWR, not bare fetch)', () => {
  it('its SWR fetcher calls authedFetch("/api/dashboard/reviews-due") and never the bare global fetch', async () => {
    const { authedFetch } = await import('@alfanumrik/lib/authed-fetch');
    vi.mocked(authedFetch).mockResolvedValue(
      jsonResponse({ success: true, data: { dueCount: 3, oldestDueDate: null, estimatedMinutes: 2 } }),
    );

    // Real SWR (NOT mocked here) so the fetcher actually runs. A fresh cache +
    // no dedup keeps this test independent of SWR's module-global cache.
    const { SWRConfig } = await import('swr');
    const { default: ReviewsDueCard } = await import('@alfanumrik/ui/dashboard/ReviewsDueCard');

    render(
      React.createElement(
        SWRConfig,
        { value: { provider: () => new Map(), dedupingInterval: 0 } },
        React.createElement(ReviewsDueCard),
      ),
    );

    await waitFor(() => expect(authedFetch).toHaveBeenCalledWith('/api/dashboard/reviews-due'));
    expect(bareFetch).not.toHaveBeenCalled();
    // The forwarded call resolved → the CTA renders (fetcher path exercised end-to-end).
    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument());
  });
});
