/**
 * /parent/billing — page contract & render tests (Phase C.4).
 *
 * The page is a Client Component that mounts inside ParentShell. We
 * combine source-level contract assertions (the cheap, durable kind that
 * survive UI refactors) with focused render tests using the testing-library
 * stack and a `fetch` mock. This mirrors what the support-page tests do:
 * keep the page render assertions narrow and pin the load-bearing contract
 * with file-level checks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import fs from 'node:fs/promises';
import path from 'node:path';

// ── next/navigation router mock ──────────────────────────────────────────
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/parent/billing',
}));

// ── AuthContext mock — guardian-mode parent by default ───────────────────
let authState: { authUserId: string | null; activeRole: string; isHi: boolean } = {
  authUserId: 'user-1',
  activeRole: 'guardian',
  isHi: false,
};
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── supabase client mock — session helper only ───────────────────────────
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: 'fake.jwt' } } }),
    },
  },
}));

import ParentBillingPage from '@/app/parent/billing/page';

const PAGE_PATH = 'src/app/parent/billing/page.tsx';
const ROUTE_PATH = 'src/app/api/parent/billing/route.ts';
const SHELL_PATH = 'src/app/parent/_components/ParentShell.tsx';

async function readSrc(rel: string): Promise<string> {
  return fs.readFile(path.resolve(process.cwd(), rel), 'utf8');
}

function fetchMock(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(payload),
  });
}

beforeEach(() => {
  mockPush.mockClear();
  authState = { authUserId: 'user-1', activeRole: 'guardian', isHi: false };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── 1. Renders a child's plan, billing cycle, and price ────────────────
describe('/parent/billing page — render', () => {
  it('renders the current plan, billing cycle, and price for each linked child', async () => {
    globalThis.fetch = fetchMock({
      success: true,
      data: {
        children: [
          {
            student_id: 'stu-1',
            student_name: 'Aanya',
            grade: '8',
            plan_code: 'pro',
            plan_name: 'Pro',
            status: 'active',
            billing_cycle: 'monthly',
            auto_renew: true,
            current_period_end: '2026-06-01T00:00:00.000Z',
            next_billing_at: '2026-06-01T00:00:00.000Z',
            price_inr: 499,
            is_in_grace: false,
            is_cancel_scheduled: false,
            razorpay_subscription_id: 'sub_rzp_a',
          },
        ],
        payment_history: [],
        summary: {
          total_active_subscriptions: 1,
          total_monthly_spend_inr: 499,
          any_in_grace: false,
          any_cancel_scheduled: false,
        },
      },
    }) as unknown as typeof fetch;

    render(<ParentBillingPage />);

    await waitFor(() => {
      expect(screen.getByText('Aanya')).toBeInTheDocument();
    });
    expect(screen.getByText('Pro')).toBeInTheDocument();
    // Price is rendered with ₹ formatting — appears in both the summary
    // and the per-child card, so use getAllByText.
    expect(screen.getAllByText(/₹499/).length).toBeGreaterThan(0);
    // Active subscription badge in the summary.
    expect(screen.getByText('All plans active')).toBeInTheDocument();
  });

  it('shows an empty-state CTA when the parent has no linked children', async () => {
    globalThis.fetch = fetchMock({
      success: true,
      data: {
        children: [],
        payment_history: [],
        summary: {
          total_active_subscriptions: 0,
          total_monthly_spend_inr: 0,
          any_in_grace: false,
          any_cancel_scheduled: false,
        },
      },
    }) as unknown as typeof fetch;

    render(<ParentBillingPage />);

    await waitFor(() => {
      expect(screen.getByTestId('no-children-state')).toBeInTheDocument();
    });
    expect(screen.getByText('Link a Child')).toBeInTheDocument();
  });

  it('surfaces the "ending in N days" warning when cancel is scheduled within 30d', async () => {
    const tenDaysOut = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    globalThis.fetch = fetchMock({
      success: true,
      data: {
        children: [
          {
            student_id: 'stu-1',
            student_name: 'Aanya',
            grade: '8',
            plan_code: 'pro',
            plan_name: 'Pro',
            status: 'active',
            billing_cycle: 'monthly',
            auto_renew: false,
            current_period_end: tenDaysOut,
            next_billing_at: null,
            price_inr: 499,
            is_in_grace: false,
            is_cancel_scheduled: true,
            razorpay_subscription_id: 'sub_rzp_a',
          },
        ],
        payment_history: [],
        summary: {
          total_active_subscriptions: 1,
          total_monthly_spend_inr: 499,
          any_in_grace: false,
          any_cancel_scheduled: true,
        },
      },
    }) as unknown as typeof fetch;

    render(<ParentBillingPage />);

    await waitFor(() => {
      expect(screen.getByTestId('ending-warning-stu-1')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ending-warning-stu-1').textContent).toMatch(/\d+/);
    expect(screen.getByText('Cancellation scheduled')).toBeInTheDocument();
  });

  it('rejects link-code mode (no real auth) with a sign-in prompt', async () => {
    authState = { authUserId: null, activeRole: 'none', isHi: false };
    // fetch should not be called at all
    const fm = fetchMock({ success: false });
    globalThis.fetch = fm as unknown as typeof fetch;

    render(<ParentBillingPage />);

    await waitFor(() => {
      expect(screen.getByText(/Billing requires a parent account/)).toBeInTheDocument();
    });
    expect(fm).not.toHaveBeenCalled();
  });

  it('renders the Hindi locale headings when isHi=true', async () => {
    authState = { authUserId: 'user-1', activeRole: 'guardian', isHi: true };
    globalThis.fetch = fetchMock({
      success: true,
      data: {
        children: [],
        payment_history: [],
        summary: {
          total_active_subscriptions: 0,
          total_monthly_spend_inr: 0,
          any_in_grace: false,
          any_cancel_scheduled: false,
        },
      },
    }) as unknown as typeof fetch;

    render(<ParentBillingPage />);

    await waitFor(() => {
      // Top-level "Billing" heading in Hindi
      expect(screen.getByRole('heading', { level: 1, name: 'बिलिंग' })).toBeInTheDocument();
    });
  });
});

// ─── 2. Source-level contract — durable across UI refactors ──────────────
describe('/parent/billing page — source-level contract', () => {
  it('the page module file exists', async () => {
    const stat = await fs.stat(path.resolve(process.cwd(), PAGE_PATH));
    expect(stat.isFile()).toBe(true);
  });

  it('the API route module file exists', async () => {
    const stat = await fs.stat(path.resolve(process.cwd(), ROUTE_PATH));
    expect(stat.isFile()).toBe(true);
  });

  it('the page reuses the existing Razorpay endpoints — no parallel payment surface', async () => {
    const src = await readSrc(PAGE_PATH);
    // Upgrade routes the user to the existing /pricing checkout, or fires
    // /api/payments/subscribe. Cancel fires /api/payments/cancel. Either
    // is acceptable but the page MUST NOT introduce a brand-new endpoint.
    expect(src).toMatch(/\/api\/payments\/cancel/);
    // No new payment endpoints under /api/parent/payments/* etc.
    expect(src).not.toMatch(/\/api\/parent\/payments\//);
    expect(src).not.toMatch(/\/api\/parent\/billing\/cancel/);
    expect(src).not.toMatch(/\/api\/parent\/billing\/subscribe/);
  });

  it('the page sends an Authorization Bearer header to /api/parent/billing', async () => {
    const src = await readSrc(PAGE_PATH);
    expect(src).toMatch(/Bearer/);
    expect(src).toMatch(/\/api\/parent\/billing/);
  });

  it('Billing nav item is registered in ParentShell and hidden in link-code mode', async () => {
    const src = await readSrc(SHELL_PATH);
    expect(src).toMatch(/\/parent\/billing/);
    // Link-code mode should not see the billing tab.
    expect(src).toMatch(/\/parent\/billing.*return\s+false|link-code[\s\S]*\/parent\/billing/);
  });
});
