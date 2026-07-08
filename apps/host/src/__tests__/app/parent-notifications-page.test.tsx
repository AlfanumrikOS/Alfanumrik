/**
 * /parent/notifications page — Phase C.5 render tests.
 *
 * Pins:
 *   - Page renders the list returned by /api/parent/notifications.
 *   - Empty state shows "You're all caught up" when items=[].
 *   - "Mark all as read" CTA is disabled when unreadCount=0 and POSTs
 *     to /api/parent/notifications/mark-all-read otherwise.
 *   - Click-to-expand reveals the row body.
 *   - Bilingual: Hindi copy renders when isHi=true.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SWRConfig } from 'swr';
import React from 'react';

// ── next/navigation mock ─────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// ── supabase mock (used by authedFetch) ─────────────────────────────
vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
  },
}));

// ── AuthContext mock ────────────────────────────────────────────────
const authMock = vi.hoisted(() => ({ isHi: false }));
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ ...authMock, authUserId: 'u-1', activeRole: 'guardian' }),
}));

// ── fetch mock ──────────────────────────────────────────────────────
type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  authMock.isHi = false;
  global.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function loadPage() {
  const mod = await import('@/app/parent/notifications/page');
  return mod.default;
}

// Render with a fresh SWR cache. Without this, SWR shares cache across
// tests by URL key and stale data from one test leaks into the next.
function renderWithFreshSWR(Page: React.ComponentType): ReturnType<typeof render> {
  return render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        dedupingInterval: 0,
        revalidateOnFocus: false,
        revalidateOnMount: true,
      }}
    >
      <Page />
    </SWRConfig>,
  );
}

const SAMPLE_ITEMS = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    title: 'Quiz score posted',
    message: 'Aarav scored 80% on math',
    body: 'Long-form details about the quiz attempt.',
    type: 'quiz_score',
    data: {},
    is_read: false,
    read_at: null,
    created_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    delivery_channel: 'in_app',
  },
];

// ── Tests ────────────────────────────────────────────────────────────

describe('/parent/notifications page', () => {
  it('renders the list returned by /api/parent/notifications', async () => {
    (global.fetch as FetchMock).mockResolvedValueOnce(
      jsonResponse({ success: true, items: SAMPLE_ITEMS, nextCursor: null, unreadCount: 1 }),
    );
    const Page = await loadPage();
    renderWithFreshSWR(Page);
    await waitFor(() => {
      expect(screen.getByText('Quiz score posted')).toBeInTheDocument();
    });
    expect(screen.getByText(/Aarav scored 80% on math/)).toBeInTheDocument();
  });

  it('renders the empty state when items is empty', async () => {
    (global.fetch as FetchMock).mockResolvedValueOnce(
      jsonResponse({ success: true, items: [], nextCursor: null, unreadCount: 0 }),
    );
    const Page = await loadPage();
    renderWithFreshSWR(Page);
    await waitFor(() => {
      expect(screen.getByTestId('notifications-empty')).toBeInTheDocument();
    });
    expect(screen.getByText(/No notifications yet/i)).toBeInTheDocument();
  });

  it('disables the Mark All Read CTA when unreadCount is 0', async () => {
    (global.fetch as FetchMock).mockResolvedValueOnce(
      jsonResponse({ success: true, items: [], nextCursor: null, unreadCount: 0 }),
    );
    const Page = await loadPage();
    renderWithFreshSWR(Page);
    await waitFor(() => {
      const btn = screen.getByTestId('mark-all-read');
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('POSTs to /api/parent/notifications/mark-all-read when the CTA is clicked', async () => {
    // First call: initial GET. Second: mark-all-read. Third: revalidation GET.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({ success: true, items: SAMPLE_ITEMS, nextCursor: null, unreadCount: 1 }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true, updated: 1 }))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          items: SAMPLE_ITEMS.map(i => ({ ...i, is_read: true })),
          nextCursor: null,
          unreadCount: 0,
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const Page = await loadPage();
    renderWithFreshSWR(Page);
    await waitFor(() => screen.getByTestId('mark-all-read'));
    fireEvent.click(screen.getByTestId('mark-all-read'));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(c => c[0]);
      expect(calls.some((u: string) => u === '/api/parent/notifications/mark-all-read')).toBe(true);
    });
  });

  it('expands a row to show the body when clicked', async () => {
    // Use an already-read row so the click only expands and does not
    // trigger a PATCH (auto-mark-on-expand fires only for unread rows).
    const readItem = [{ ...SAMPLE_ITEMS[0], is_read: true, read_at: new Date().toISOString() }];
    (global.fetch as FetchMock).mockResolvedValue(
      jsonResponse({ success: true, items: readItem, nextCursor: null, unreadCount: 0 }),
    );
    const Page = await loadPage();
    renderWithFreshSWR(Page);
    await waitFor(() => screen.getByText('Quiz score posted'));
    // Body is hidden until expand.
    expect(screen.queryByText(/Long-form details/)).toBeNull();
    fireEvent.click(screen.getByText('Quiz score posted'));
    expect(await screen.findByText(/Long-form details/)).toBeInTheDocument();
  });

  it('renders Hindi copy when isHi=true', async () => {
    authMock.isHi = true;
    (global.fetch as FetchMock).mockResolvedValueOnce(
      jsonResponse({ success: true, items: [], nextCursor: null, unreadCount: 0 }),
    );
    const Page = await loadPage();
    renderWithFreshSWR(Page);
    await waitFor(() => {
      expect(screen.getByText('सूचनाएँ')).toBeInTheDocument();
    });
    expect(screen.getByText('अभी कोई सूचना नहीं')).toBeInTheDocument();
  });
});
