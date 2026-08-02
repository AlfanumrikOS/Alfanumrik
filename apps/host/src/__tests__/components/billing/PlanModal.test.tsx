/**
 * PlanModal — screen 15 "Plan" (packages/ui/src/billing/v2/PlanModal.tsx).
 *
 * PRESENTATION ONLY — every read is a prop. Pins:
 *   - closed/loading/error/success states
 *   - the reset banner leads the modal and never invents a limit/count
 *   - pricing rendered is BYTE-IDENTICAL to @alfanumrik/lib/plans (no local
 *     literal) for both monthly and yearly cycles
 *   - checkout reuses useCheckout() unchanged — same plan_code/billing_cycle
 *     contract UpgradeModal already uses; no amount is ever sent by the client
 *   - the current plan is marked CURRENT and is not clickable
 *   - the under-18 advisory is informational only and never disables a CTA
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlanModal, {
  type PlanModalProps,
  type PlanModalUsageEntry,
  nextDailyReset,
  formatResetCountdown,
  formatResetClock,
} from '@alfanumrik/ui/billing/v2/PlanModal';
import { PRICING, formatINR, yearlyPerMonth } from '@alfanumrik/lib/plans';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const checkout = vi.fn();
const useCheckoutMock = vi.fn(() => ({
  checkout,
  loading: false,
  status: 'idle' as const,
  error: null as string | null,
}));

vi.mock('@alfanumrik/lib/hooks/useCheckout', () => ({
  useCheckout: () => useCheckoutMock(),
}));

const FIXED_NOW = new Date(2026, 0, 15, 20, 30, 0); // 15 Jan 2026, 8:30 PM local

function baseProps(overrides: Partial<PlanModalProps> = {}): PlanModalProps {
  return {
    isOpen: true,
    onClose: vi.fn(),
    isHi: false,
    loading: false,
    error: false,
    onRetry: vi.fn(),
    currentPlanCode: 'free',
    usage: [],
    isMinor: false,
    parentConsentEmail: null,
    pricingHref: '/pricing',
    onUpgradeSuccess: vi.fn(),
    now: FIXED_NOW,
    ...overrides,
  };
}

describe('PlanModal — pure helpers', () => {
  it('nextDailyReset returns the caller-local next midnight', () => {
    const result = nextDailyReset(FIXED_NOW);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(16);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
  });

  it('formatResetCountdown renders hours+minutes, never negative', () => {
    const resetAt = nextDailyReset(FIXED_NOW); // 3h30m away from 20:30
    expect(formatResetCountdown(FIXED_NOW, resetAt, false)).toBe('in 3h 30m');
    expect(formatResetCountdown(FIXED_NOW, resetAt, true)).toContain('में');
  });

  it('formatResetCountdown floors to "resetting now" once past the boundary', () => {
    const past = new Date(FIXED_NOW.getTime() - 60_000);
    expect(formatResetCountdown(FIXED_NOW, past, false)).toBe('resetting now');
  });

  it('formatResetClock renders a locale time string', () => {
    const resetAt = nextDailyReset(FIXED_NOW);
    expect(formatResetClock(resetAt, false)).toMatch(/12:00/);
  });
});

describe('PlanModal — states', () => {
  beforeEach(() => {
    checkout.mockReset();
    useCheckoutMock.mockReset();
    useCheckoutMock.mockReturnValue({ checkout, loading: false, status: 'idle', error: null });
  });

  it('closed: renders nothing', () => {
    const { container } = render(<PlanModal {...baseProps({ isOpen: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('loading: renders the skeleton, no plans/reset content', () => {
    render(<PlanModal {...baseProps({ loading: true })} />);
    expect(screen.getByTestId('plan-modal-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-modal-reset')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-modal-tier-pro')).not.toBeInTheDocument();
  });

  it('error: renders EmptyState with retry wired to onRetry', () => {
    const onRetry = vi.fn();
    render(<PlanModal {...baseProps({ error: true, onRetry })} />);
    expect(screen.getByTestId('plan-modal-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    render(<PlanModal {...baseProps({ onClose })} />);
    fireEvent.click(screen.getByTestId('plan-modal-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PlanModal — reset banner (leads the modal)', () => {
  beforeEach(() => {
    checkout.mockReset();
    useCheckoutMock.mockReset();
    useCheckoutMock.mockReturnValue({ checkout, loading: false, status: 'idle', error: null });
  });

  it('no usage data: generic message with the computed local reset clock', () => {
    render(<PlanModal {...baseProps({ usage: [] })} />);
    const banner = screen.getByTestId('plan-modal-reset');
    expect(banner.textContent).toMatch(/reset/i);
    expect(banner.textContent).toMatch(/12:00/);
  });

  it('finite exhausted quota: shows count/limit and a countdown, never invents a number', () => {
    const usage: PlanModalUsageEntry[] = [
      { feature: 'quiz', limit: 5, count: 5, remaining: 0, allowed: false },
    ];
    render(<PlanModal {...baseProps({ usage })} />);
    const row = screen.getByTestId('plan-modal-usage-quiz');
    expect(row.textContent).toContain('5/5');
    expect(row.textContent).toMatch(/in 3h 30m/);
  });

  it('unlimited quota (sentinel 999999): shows "Unlimited", not a countdown', () => {
    const usage: PlanModalUsageEntry[] = [
      { feature: 'foxy_chat', limit: 999999, count: 12, remaining: 999987, allowed: true },
    ];
    render(<PlanModal {...baseProps({ usage })} />);
    const row = screen.getByTestId('plan-modal-usage-foxy_chat');
    expect(row.textContent).toContain('Unlimited');
  });
});

describe('PlanModal — pricing is byte-identical to the SoT', () => {
  beforeEach(() => {
    checkout.mockReset();
    useCheckoutMock.mockReset();
    useCheckoutMock.mockReturnValue({ checkout, loading: false, status: 'idle', error: null });
  });

  it('monthly cycle renders PRICING.<tier>.monthly for every tier, no hardcoded number', () => {
    render(<PlanModal {...baseProps()} />);
    for (const tier of ['starter', 'pro', 'unlimited'] as const) {
      const card = screen.getByTestId(`plan-modal-tier-${tier}`);
      expect(card.textContent).toContain(formatINR(PRICING[tier].monthly));
    }
  });

  it('yearly cycle renders the yearly-per-month figure derived from PRICING, plus the yearly total', () => {
    render(<PlanModal {...baseProps()} />);
    fireEvent.click(screen.getByTestId('plan-modal-cycle-yearly'));
    for (const tier of ['starter', 'pro', 'unlimited'] as const) {
      const card = screen.getByTestId(`plan-modal-tier-${tier}`);
      expect(card.textContent).toContain(formatINR(yearlyPerMonth(PRICING[tier].yearly)));
      expect(card.textContent).toContain(formatINR(PRICING[tier].yearly));
    }
  });

  it('the current plan is marked CURRENT and its CTA is disabled', () => {
    render(<PlanModal {...baseProps({ currentPlanCode: 'starter' })} />);
    const cta = screen.getByTestId('plan-modal-cta-starter') as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    expect(cta.textContent).toMatch(/current plan/i);
  });

  it('a legacy/aliased plan code (e.g. "premium") still resolves to the correct CURRENT tier', () => {
    render(<PlanModal {...baseProps({ currentPlanCode: 'premium' })} />);
    const cta = screen.getByTestId('plan-modal-cta-pro') as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });
});

describe('PlanModal — checkout reuses useCheckout() unchanged', () => {
  beforeEach(() => {
    checkout.mockReset();
    useCheckoutMock.mockReset();
    useCheckoutMock.mockReturnValue({ checkout, loading: false, status: 'idle', error: null });
  });

  it('clicking Upgrade opens the confirm dialog; confirming calls checkout() with plan_code + billing_cycle only', () => {
    render(<PlanModal {...baseProps({ currentPlanCode: 'free' })} />);
    fireEvent.click(screen.getByTestId('plan-modal-cta-pro'));

    // SubscriptionConfirm renders its own confirm button
    fireEvent.click(screen.getByRole('button', { name: /subscribe now|pay now/i }));

    expect(checkout).toHaveBeenCalledTimes(1);
    const arg = checkout.mock.calls[0][0];
    expect(arg.planCode).toBe('pro');
    expect(arg.billingCycle).toBe('monthly');
    expect(arg).not.toHaveProperty('amount');
    expect(arg).not.toHaveProperty('price');
  });

  it('onSuccess shows the success screen; continuing calls onClose and onUpgradeSuccess with the plan code', () => {
    checkout.mockImplementation(({ onSuccess }: { onSuccess?: (p: string) => void }) => {
      onSuccess?.('pro');
    });
    const onClose = vi.fn();
    const onUpgradeSuccess = vi.fn();
    render(<PlanModal {...baseProps({ onClose, onUpgradeSuccess })} />);

    fireEvent.click(screen.getByTestId('plan-modal-cta-pro'));
    fireEvent.click(screen.getByRole('button', { name: /subscribe now|pay now/i }));

    expect(screen.getByTestId('plan-modal-success')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('plan-modal-continue'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUpgradeSuccess).toHaveBeenCalledWith('pro');
  });

  it('surfaces a checkout error from the hook without inventing its own copy', () => {
    useCheckoutMock.mockReturnValue({ checkout, loading: false, status: 'failed', error: 'Payment failed. Please try again.' });
    render(<PlanModal {...baseProps()} />);
    expect(screen.getByTestId('plan-modal-error-message').textContent).toBe('Payment failed. Please try again.');
  });
});

describe('PlanModal — under-18 advisory is informational only', () => {
  beforeEach(() => {
    checkout.mockReset();
    useCheckoutMock.mockReset();
    useCheckoutMock.mockReturnValue({ checkout, loading: false, status: 'idle', error: null });
  });

  it('renders the advisory when isMinor is true, including the parent email', () => {
    render(<PlanModal {...baseProps({ isMinor: true, parentConsentEmail: 'parent@example.com' })} />);
    const banner = screen.getByTestId('plan-modal-minor-advisory');
    expect(banner.textContent).toContain('parent@example.com');
  });

  it('does NOT disable the upgrade CTA for a minor — no client-only gate is invented', () => {
    render(<PlanModal {...baseProps({ isMinor: true, currentPlanCode: 'free' })} />);
    const cta = screen.getByTestId('plan-modal-cta-pro') as HTMLButtonElement;
    expect(cta.disabled).toBe(false);
    fireEvent.click(cta);
    expect(screen.getByRole('button', { name: /subscribe now|pay now/i })).toBeInTheDocument();
  });

  it('omits the advisory entirely when isMinor is false', () => {
    render(<PlanModal {...baseProps({ isMinor: false })} />);
    expect(screen.queryByTestId('plan-modal-minor-advisory')).not.toBeInTheDocument();
  });
});
