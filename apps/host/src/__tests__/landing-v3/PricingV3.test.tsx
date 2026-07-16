import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import React from 'react';

/**
 * Tests for the V3 /pricing page (landing-v3 makeover, 2026-07-16).
 *
 * Source: packages/ui/src/landing/v3/PricingV3.tsx (+ PricingHeroV3,
 * PricingPlansV3, SchoolsBandV3, PricingFaqV3). Replaced the legacy
 * apps/host/src/app/pricing/PricingCards.tsx page in the same PR.
 *
 * Drift-proofing rule (P11-adjacent, REG-65 family): every rupee assertion
 * on the plan cards derives from `PRICING` / `yearlyPerMonth` imported from
 * `@alfanumrik/lib/plans` — NO hardcoded price literals in card assertions.
 * The only literal we pin is the FAQ's verbatim "₹699" copy (REG-65) plus a
 * lock-step check that it still equals the SoT value.
 *
 * Covers:
 *   - pricing-root shell + single H1 (tuition-class headline)
 *   - 4 plan cards (Explorer / Starter / Pro / Unlimited)
 *   - monthly prices from PRICING; yearly toggle swaps to yearly prices with
 *     the ≈/mo equivalent via yearlyPerMonth()
 *   - Pro carries the "Most popular" featured badge (and no other card does)
 *   - Schools band renders SCHOOL_PER_SEAT_MARKETING_LABEL from the SoT
 *   - "₹699" literal present in the pricing FAQ (annual-billing answer)
 *
 * Conventions follow landing-v2/PricingTeaserV2.test.tsx / NavV2.test.tsx.
 * Owning agent: testing.
 */

// ── Hermetic mocks ────────────────────────────────────────────────────────────
// Breadcrumbs calls usePathname() (Next app-router hook — unavailable in JSDOM).
vi.mock('next/navigation', () => ({
  usePathname: () => '/pricing',
}));
// PricingPlansV3 branches on auth state for its CTA (logged-out → /login link;
// logged-in → Razorpay checkout). We pin the anonymous marketing surface;
// the checkout flow itself is covered by useCheckout/payment suites.
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ isLoggedIn: false, isHi: false, student: null }),
}));
vi.mock('@alfanumrik/lib/hooks/useCheckout', () => ({
  useCheckout: () => ({ checkout: vi.fn(), loading: false, status: 'idle', error: null }),
}));

import PricingV3 from '@alfanumrik/ui/landing/v3/PricingV3';
import { PRICING, formatINR, yearlyPerMonth } from '@alfanumrik/lib/plans';
import { SCHOOL_PER_SEAT_MARKETING_LABEL } from '@alfanumrik/lib/pricing';

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function renderPricing() {
  // PricingV3 wraps itself in WelcomeV2Provider — no external wrapper needed.
  return render(<PricingV3 />);
}

/** The four plan cards are <article> elements inside the #plans section. */
function planCards(): HTMLElement[] {
  return Array.from(document.querySelectorAll('#plans article')) as HTMLElement[];
}

/** Find one plan card by its <h3> plan name (EN default). */
function cardByName(name: string): HTMLElement {
  const card = planCards().find(
    (c) => c.querySelector('h3')?.textContent === name,
  );
  expect(card, `plan card "${name}" should render`).toBeTruthy();
  return card as HTMLElement;
}

const PAID: { name: string; code: 'starter' | 'pro' | 'unlimited' }[] = [
  { name: 'Starter', code: 'starter' },
  { name: 'Pro', code: 'pro' },
  { name: 'Unlimited', code: 'unlimited' },
];

describe('PricingV3 — shell', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('renders the pricing-root shell with a single H1', () => {
    renderPricing();
    expect(screen.getByTestId('pricing-root')).toBeInTheDocument();
    const h1s = document.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    // The approved V3 headline (eyebrow carries "Pricing").
    expect(h1s[0].textContent).toMatch(/Less than a single tuition class/i);
  });
});

describe('PricingV3 — plan cards (prices from @alfanumrik/lib/plans SoT)', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('renders exactly 4 plan cards: Explorer, Starter, Pro, Unlimited', () => {
    renderPricing();
    const cards = planCards();
    expect(cards).toHaveLength(4);
    expect(cards.map((c) => c.querySelector('h3')?.textContent)).toEqual([
      'Explorer',
      'Starter',
      'Pro',
      'Unlimited',
    ]);
  });

  it('Explorer is free (₹0 via formatINR(0), no card required)', () => {
    renderPricing();
    const explorer = cardByName('Explorer');
    expect(explorer.textContent).toContain(formatINR(0));
    expect(explorer.textContent).toMatch(/Free forever/i);
  });

  it('monthly (default) shows PRICING.<plan>.monthly with the yearly cross-sell line', () => {
    renderPricing();
    for (const { name, code } of PAID) {
      const card = cardByName(name);
      expect(card.textContent).toContain(`${formatINR(PRICING[code].monthly)}/mo`);
      expect(card.textContent).toContain(
        `or ${formatINR(PRICING[code].yearly)} billed yearly`,
      );
    }
  });

  it('yearly toggle swaps every paid card to PRICING.<plan>.yearly + ≈/mo equivalent (yearlyPerMonth)', () => {
    renderPricing();
    const yearlyBtn = screen.getByRole('button', { name: 'Yearly' });
    const monthlyBtn = screen.getByRole('button', { name: 'Monthly' });
    expect(monthlyBtn).toHaveAttribute('aria-pressed', 'true');
    expect(yearlyBtn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(yearlyBtn);
    expect(yearlyBtn).toHaveAttribute('aria-pressed', 'true');
    expect(monthlyBtn).toHaveAttribute('aria-pressed', 'false');

    for (const { name, code } of PAID) {
      const card = cardByName(name);
      expect(card.textContent).toContain(`${formatINR(PRICING[code].yearly)}/yr`);
      // ≈/mo equivalent derives from the SAME helper the component uses —
      // any rounding-rule change shows up as a deliberate diff here.
      expect(card.textContent).toContain(
        `≈ ${formatINR(yearlyPerMonth(PRICING[code].yearly))}/mo, billed yearly`,
      );
    }
  });

  it('Pro (and ONLY Pro) carries the "Most popular" featured badge', () => {
    renderPricing();
    const pro = cardByName('Pro');
    expect(within(pro).getByText(/Most popular/i)).toBeInTheDocument();
    for (const name of ['Explorer', 'Starter', 'Unlimited']) {
      expect(
        within(cardByName(name)).queryByText(/Most popular/i),
      ).toBeNull();
    }
  });

  it('anonymous visitors get /login CTAs on all four cards (no checkout button)', () => {
    renderPricing();
    for (const card of planCards()) {
      const cta = card.querySelector('a[href="/login"]');
      expect(cta).not.toBeNull();
      expect(card.querySelector('button')).toBeNull();
    }
  });
});

describe('PricingV3 — schools band (per-seat price from SoT)', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('renders SCHOOL_PER_SEAT_MARKETING_LABEL next to /student/mo (REG-154 family)', () => {
    renderPricing();
    const band = document
      .querySelector('#schools-band-title')
      ?.closest('section') as HTMLElement;
    expect(band).toBeTruthy();
    expect(band.textContent).toContain(SCHOOL_PER_SEAT_MARKETING_LABEL);
    expect(band.textContent).toContain('/student/mo');
    // Both B2B CTAs present.
    expect(band.querySelector('a[href="/contact"]')).not.toBeNull();
    expect(band.querySelector('a[href="/demo"]')).not.toBeNull();
  });
});

describe('PricingV3 — FAQ (REG-65 verbatim "₹699")', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('the annual-billing FAQ answer quotes "₹699" verbatim, in lock-step with PRICING', () => {
    renderPricing();
    const faq = document.querySelector('#faq');
    expect(faq).not.toBeNull();
    expect(faq!.textContent).toContain('₹699');
    // Lock-step: the pinned literal must equal the SoT Pro monthly price.
    expect(formatINR(PRICING.pro.monthly)).toBe('₹699');
    // The same answer quotes the yearly figure — also SoT-locked.
    expect(faq!.textContent).toContain(formatINR(PRICING.pro.yearly));
    // The retired ₹1,499 Unlimited price must not resurface anywhere.
    expect(document.body.textContent).not.toContain('₹1,499');
  });

  it('renders the four pricing FAQs as native <details>', () => {
    renderPricing();
    expect(document.querySelectorAll('#faq details')).toHaveLength(4);
  });
});
