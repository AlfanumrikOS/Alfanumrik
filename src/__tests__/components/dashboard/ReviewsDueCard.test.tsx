import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

/**
 * ReviewsDueCard — Phase 2.D spaced-repetition CTA on the student dashboard.
 *
 * Covers:
 *   1. dueCount === 0 → renders nothing (return null)
 *   2. loading state shows shimmer (aria-busy)
 *   3. error state renders nothing (silent fail)
 *   4. English copy: "{n} reviews due — {m} min"
 *   5. Hindi copy: "{n} रिव्यू बाकी — {m} मिनट"
 *   6. Click navigates to /review?due_only=1
 *   7. aria-label set for accessibility (full sentence, not just count)
 *   8. SWR hook called with refreshInterval=60_000
 */

// ── AuthContext mock ─────────────────────────────────────────────────────────
let mockIsHi = false;
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: mockIsHi }),
}));

// ── Router mock ──────────────────────────────────────────────────────────────
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// ── SWR mock ─────────────────────────────────────────────────────────────────
type SwrCall = {
  key: unknown;
  fetcher: unknown;
  options: Record<string, unknown> | undefined;
};
const swrCalls: SwrCall[] = [];

let mockSwrState: {
  data: unknown;
  error: unknown;
  isLoading: boolean;
} = { data: undefined, error: null, isLoading: false };

vi.mock('swr', () => ({
  default: (key: unknown, fetcher: unknown, options: Record<string, unknown> | undefined) => {
    swrCalls.push({ key, fetcher, options });
    return {
      data: mockSwrState.data,
      error: mockSwrState.error,
      isLoading: mockSwrState.isLoading,
    };
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
async function renderCard() {
  const { default: ReviewsDueCard } = await import('@/components/dashboard/ReviewsDueCard');
  return render(React.createElement(ReviewsDueCard));
}

beforeEach(() => {
  vi.clearAllMocks();
  swrCalls.length = 0;
  mockIsHi = false;
  mockSwrState = { data: undefined, error: null, isLoading: false };
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ReviewsDueCard', () => {
  it('renders nothing when dueCount === 0 (empty state is null)', async () => {
    mockSwrState = {
      data: { success: true, data: { dueCount: 0, oldestDueDate: null, estimatedMinutes: 2 } },
      error: null,
      isLoading: false,
    };
    const { container } = await renderCard();
    expect(container.firstChild).toBeNull();
  });

  it('renders shimmer skeleton during loading (aria-busy)', async () => {
    mockSwrState = { data: undefined, error: null, isLoading: true };
    await renderCard();
    const skel = screen.getByLabelText(/Loading reviews/i);
    expect(skel).toBeDefined();
    expect(skel.getAttribute('aria-busy')).toBe('true');
  });

  it('renders nothing when SWR returns an error (silent fail)', async () => {
    mockSwrState = { data: undefined, error: new Error('500'), isLoading: false };
    const { container } = await renderCard();
    expect(container.firstChild).toBeNull();
  });

  it('renders English copy when isHi=false', async () => {
    mockIsHi = false;
    mockSwrState = {
      data: { success: true, data: { dueCount: 5, oldestDueDate: '2026-04-20', estimatedMinutes: 3 } },
      error: null,
      isLoading: false,
    };
    await renderCard();
    expect(screen.getByText(/5 reviews due — 3 min/i)).toBeDefined();
    expect(screen.getByText(/Quick review locks in what you learnt last week/i)).toBeDefined();
  });

  it('renders Hindi copy when isHi=true (Hinglish loanword "रिव्यू")', async () => {
    mockIsHi = true;
    mockSwrState = {
      data: { success: true, data: { dueCount: 5, oldestDueDate: '2026-04-20', estimatedMinutes: 3 } },
      error: null,
      isLoading: false,
    };
    await renderCard();
    // Hinglish: "5 रिव्यू बाकी — 3 मिनट"
    expect(screen.getByText(/5 रिव्यू बाकी — 3 मिनट/)).toBeDefined();
    expect(screen.getByText(/पिछले हफ्ते का याद ताज़ा करें/)).toBeDefined();
  });

  it('navigates to /review?due_only=1 when clicked', async () => {
    mockSwrState = {
      data: { success: true, data: { dueCount: 2, oldestDueDate: '2026-04-20', estimatedMinutes: 2 } },
      error: null,
      isLoading: false,
    };
    await renderCard();
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(mockPush).toHaveBeenCalledWith('/review?due_only=1');
  });

  it('exposes a descriptive aria-label for accessibility', async () => {
    mockSwrState = {
      data: { success: true, data: { dueCount: 3, oldestDueDate: '2026-04-20', estimatedMinutes: 2 } },
      error: null,
      isLoading: false,
    };
    await renderCard();
    const btn = screen.getByRole('button');
    const aria = btn.getAttribute('aria-label') ?? '';
    // Full descriptive sentence, not just the count
    expect(aria).toMatch(/3 reviews due/);
    expect(aria.length).toBeGreaterThan(20);
  });

  it('configures SWR with refreshInterval=60_000 and revalidateOnFocus', async () => {
    mockSwrState = {
      data: { success: true, data: { dueCount: 1, oldestDueDate: '2026-04-20', estimatedMinutes: 2 } },
      error: null,
      isLoading: false,
    };
    await renderCard();
    expect(swrCalls.length).toBeGreaterThan(0);
    const opts = swrCalls[0].options ?? {};
    expect(opts.refreshInterval).toBe(60_000);
    expect(opts.revalidateOnFocus).toBe(true);
    // Hits /api/dashboard/reviews-due
    expect(swrCalls[0].key).toBe('/api/dashboard/reviews-due');
  });
});
