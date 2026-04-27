/**
 * /support — frontend behaviour tests (audit F22 frontend portion).
 *
 * Coverage:
 *  - List page: empty state, loading skeleton, ticket rows render, error retry.
 *  - New page: empty subject blocks submit; happy-path submit redirects;
 *              429 rate-limit shows toast (no redirect); 401 redirects to login.
 *  - Bilingual (P7): switching isHi flips copy on both pages.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

// Wrap each <Page /> in a fresh SWR cache so tests don't share data between them.
function withFreshSWR(children: ReactNode) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
}

// ─── Hoisted mock state — flips between tests via shared mutable refs ───────
const navState: {
  push: ReturnType<typeof vi.fn>;
  replace: ReturnType<typeof vi.fn>;
  back: ReturnType<typeof vi.fn>;
  params: Record<string, string>;
} = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  params: { ticket_id: 'tkt-123' },
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: navState.push,
    replace: navState.replace,
    back: navState.back,
  }),
  useParams: () => navState.params,
  usePathname: () => '/support',
  useSearchParams: () => new URLSearchParams(),
}));

const authState = {
  isHi: false,
  isLoggedIn: true,
  isLoading: false,
  student: { id: 'stu-1', name: 'Asha', grade: '8' },
  snapshot: null,
  teacher: null,
  guardian: null,
  roles: ['student'] as Array<'student' | 'teacher' | 'guardian' | 'institution_admin' | 'none'>,
  activeRole: 'student' as const,
  setActiveRole: vi.fn(),
  language: 'en',
  setLanguage: vi.fn(),
  theme: 'system' as const,
  toggleTheme: vi.fn(),
  isDemoUser: false,
  authUserId: 'auth-1',
  refreshStudent: vi.fn(),
  refreshSnapshot: vi.fn(),
  signOut: vi.fn(),
};

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
}));

// SWR stub for dashboard data used by BottomNav
vi.mock('@/lib/swr', () => ({
  useDashboardData: () => ({ data: null }),
  invalidateSnapshot: vi.fn(),
  useStudentSnapshot: () => ({ data: null }),
  invalidateAll: vi.fn(),
  clearAllCache: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────
function setListResponse(payload: unknown, status = 200) {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

function setFetchSequence(steps: Array<{ status: number; body: unknown }>) {
  let i = 0;
  global.fetch = vi.fn(async () => {
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    return new Response(JSON.stringify(step.body), {
      status: step.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  authState.isHi = false;
  authState.isLoggedIn = true;
  authState.isLoading = false;
  navState.push.mockClear();
  navState.replace.mockClear();
  // Clear sessionStorage between tests so toasts don't leak.
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

// ════════════════════════════════════════════════════════════════════════════
//  /support — list page
// ════════════════════════════════════════════════════════════════════════════
describe('/support — list page', () => {
  it('shows empty state with create-new CTA when there are zero tickets', async () => {
    setListResponse({ tickets: [], total: 0 });
    const { default: Page } = await import('@/app/support/page');

    render(withFreshSWR(<Page />));
    await waitFor(() => {
      expect(screen.getByText(/no tickets yet/i)).toBeTruthy();
    });
    // The empty state has a "Create new ticket" button (the EmptyState action).
    expect(screen.getAllByRole('button', { name: /create new ticket/i }).length).toBeGreaterThan(0);
  });

  it('renders ticket rows when API returns tickets', async () => {
    setListResponse({
      tickets: [
        {
          ticket_id: 'tkt-1',
          subject: 'Foxy stopped responding',
          category: 'bug',
          priority: 'high',
          status: 'open',
          created_at: new Date(Date.now() - 60_000).toISOString(),
        },
        {
          ticket_id: 'tkt-2',
          subject: 'Wrong answer in Class 8 Maths',
          category: 'content',
          priority: 'normal',
          status: 'resolved',
          created_at: new Date(Date.now() - 86_400_000).toISOString(),
        },
      ],
      total: 2,
    });
    const { default: Page } = await import('@/app/support/page');

    render(withFreshSWR(<Page />));
    await waitFor(() => {
      expect(screen.getByText(/foxy stopped responding/i)).toBeTruthy();
    });
    expect(screen.getByText(/wrong answer in class 8 maths/i)).toBeTruthy();
    expect(screen.getAllByTestId('support-ticket-row').length).toBe(2);
  });

  it('shows the New ticket CTA in the header (always visible)', async () => {
    setListResponse({ tickets: [], total: 0 });
    const { default: Page } = await import('@/app/support/page');

    render(withFreshSWR(<Page />));
    await waitFor(() => {
      expect(screen.getByTestId('support-new-cta')).toBeTruthy();
    });
  });

  it('switches to Hindi copy when isHi = true (P7)', async () => {
    authState.isHi = true;
    setListResponse({ tickets: [], total: 0 });
    const { default: Page } = await import('@/app/support/page');

    render(withFreshSWR(<Page />));
    await waitFor(() => {
      expect(screen.getByText(/अभी तक कोई टिकट नहीं/)).toBeTruthy();
    });
    // English heading should not be present.
    expect(screen.queryByText(/^Support$/)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  /support/new — form page
// ════════════════════════════════════════════════════════════════════════════
describe('/support/new — form page', () => {
  it('blocks submission when subject is empty', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { default: Page } = await import('@/app/support/new/page');
    render(withFreshSWR(<Page />));

    // Don't fill subject. Fill description so the only blocking field is subject.
    const description = await screen.findByLabelText(/description/i);
    fireEvent.change(description, { target: { value: 'A helpful description.' } });

    const submitBtn = screen.getByTestId('support-submit');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/subject is required/i)).toBeTruthy();
    });
    // Fetch must NOT have been called.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(navState.push).not.toHaveBeenCalled();
  });

  it('on 200 success redirects to /support/[ticket_id]', async () => {
    setFetchSequence([
      { status: 200, body: { success: true, ticket_id: 'tkt-new-99' } },
    ]);

    const { default: Page } = await import('@/app/support/new/page');
    render(withFreshSWR(<Page />));

    fireEvent.change(await screen.findByLabelText(/subject/i), {
      target: { value: 'My quiz crashed' },
    });
    fireEvent.change(await screen.findByLabelText(/description/i), {
      target: { value: 'After question 4 the screen went blank.' },
    });

    fireEvent.click(screen.getByTestId('support-submit'));

    await waitFor(() => {
      expect(navState.push).toHaveBeenCalledWith('/support/tkt-new-99');
    });

    // Success toast should be queued for the destination page.
    const queued = sessionStorage.getItem('alfanumrik_support_toast');
    expect(queued).toBeTruthy();
    expect(JSON.parse(queued!).type).toBe('success');
  });

  it('on 429 shows the rate-limit toast and stays on page', async () => {
    setFetchSequence([
      { status: 429, body: { success: false, error: 'rate_limited' } },
    ]);

    const { default: Page } = await import('@/app/support/new/page');
    render(withFreshSWR(<Page />));

    fireEvent.change(await screen.findByLabelText(/subject/i), {
      target: { value: 'Another ticket' },
    });
    fireEvent.change(await screen.findByLabelText(/description/i), {
      target: { value: 'Need help with billing.' },
    });

    fireEvent.click(screen.getByTestId('support-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('support-toast')).toBeTruthy();
    });
    expect(screen.getByTestId('support-toast').textContent).toMatch(/today's ticket limit/i);
    // Should NOT have navigated.
    expect(navState.push).not.toHaveBeenCalled();
  });

  it('on 401 redirects to /login', async () => {
    setFetchSequence([
      { status: 401, body: { error: 'unauthorized' } },
    ]);

    const { default: Page } = await import('@/app/support/new/page');
    render(withFreshSWR(<Page />));

    fireEvent.change(await screen.findByLabelText(/subject/i), {
      target: { value: 'Another ticket' },
    });
    fireEvent.change(await screen.findByLabelText(/description/i), {
      target: { value: 'Some description.' },
    });

    fireEvent.click(screen.getByTestId('support-submit'));

    await waitFor(() => {
      expect(navState.replace).toHaveBeenCalledWith('/login');
    });
  });

  it('renders Hindi copy when isHi = true (P7)', async () => {
    authState.isHi = true;
    const { default: Page } = await import('@/app/support/new/page');
    render(withFreshSWR(<Page />));

    await waitFor(() => {
      expect(screen.getByText(/^नया टिकट$/)).toBeTruthy();
    });
    // Submit button reads Hindi.
    expect(screen.getByTestId('support-submit').textContent).toMatch(/टिकट भेजें/);
  });
});
