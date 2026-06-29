import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import React from 'react';

/**
 * Tests for the v2 pricing teaser carousel.
 *
 * Source: src/components/landing/PricingTeaserV2.tsx
 *
 * Covers:
 *   - 4 plans render with the documented prices
 *     (Explorer ₹0 free, Starter ₹299, Pro ₹699 featured, Unlimited ₹1099)
 *     Unlimited derives from PRICING.unlimited.monthly, converged to ₹1099 by
 *     PAY-2 (REG-207, 2026-06-30); the old ₹1499 teaser value no longer exists.
 *   - 4 dot indicators render
 *   - Default active dot is index 1 (Starter centered)
 *   - Clicking a dot calls scrollIntoView on the corresponding card
 *   - Each dot is a real <button> with aria-label
 *
 * What we don't test in unit:
 *   - The CSS-driven mobile-vs-desktop layout. JSDOM does not compute CSS
 *     scroll-snap or media queries. We test layout behavior in Playwright E2E
 *     (e2e/welcome-v2.spec.ts) where real browsers honour viewport / CSS.
 *
 * Updated 2026-06-25: marketing pass changed from 3 plans
 * (Explorer/Pro/Family) to 4 plans (Explorer/Starter/Pro/Unlimited).
 *
 * Owning agent: testing.
 */

import PricingTeaserV2 from '@/components/landing/PricingTeaserV2';
import { WelcomeV2Provider } from '@/components/landing/WelcomeV2Context';

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
  return render(
    <WelcomeV2Provider>
      <PricingTeaserV2 />
    </WelcomeV2Provider>,
  );
}

describe('PricingTeaserV2 — plan content', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('renders 4 plan articles', () => {
    renderPricing();
    // Plan cards are <article> elements with role="listitem" inside the
    // <div role="list"> track. Use container query — getByRole('list')
    // is ambiguous (each plan also nests a <ul> features list).
    const articles = document.querySelectorAll('article[role="listitem"]');
    expect(articles).toHaveLength(4);
  });

  it('renders Explorer plan (Plan i) at ₹0', () => {
    renderPricing();
    // Price is split across nodes: ₹ text + <em>0</em> + <small>/mo</small>
    // Query the plan label and the numeric price separately.
    expect(screen.getByText(/Plan i · Explorer/i)).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders Starter plan (Plan ii) at ₹299', () => {
    renderPricing();
    expect(screen.getByText(/Plan ii · Starter/i)).toBeInTheDocument();
    expect(screen.getByText('299')).toBeInTheDocument();
  });

  it('renders Pro plan (Plan iii) at ₹699 and marks it featured', () => {
    renderPricing();
    expect(screen.getByText(/Plan iii · Pro/i)).toBeInTheDocument();
    expect(screen.getByText('699')).toBeInTheDocument();
    // The featured plan carries a "Most popular" tag
    expect(screen.getByText(/Most popular/i)).toBeInTheDocument();
  });

  it('renders Unlimited plan (Plan iv) at ₹1099', () => {
    renderPricing();
    expect(screen.getByText(/Plan iv · Unlimited/i)).toBeInTheDocument();
    expect(screen.getByText('1099')).toBeInTheDocument();
  });

  it('Explorer, Starter and Pro CTAs link to /login; Unlimited links to /pricing', () => {
    renderPricing();
    const links = screen.getAllByRole('link');
    const hrefs = links
      .map((el) => (el as HTMLAnchorElement).getAttribute('href'))
      .filter(Boolean);
    // Three of the four plan CTAs go to /login
    expect(hrefs.filter((h) => h === '/login').length).toBeGreaterThanOrEqual(3);
    expect(hrefs).toContain('/pricing');
  });
});

describe('PricingTeaserV2 — carousel dots', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('renders exactly 4 dot buttons', () => {
    renderPricing();
    const dotsList = screen.getByRole('tablist', { name: /Choose plan|योजना चुनें/ });
    const dotBtns = within(dotsList).getAllByRole('button');
    expect(dotBtns).toHaveLength(4);
  });

  it('dots are real <button>s with descriptive aria-label', () => {
    renderPricing();
    const dotsList = screen.getByRole('tablist', { name: /Choose plan|योजना चुनें/ });
    const dotBtns = within(dotsList).getAllByRole('button');
    for (let i = 0; i < dotBtns.length; i++) {
      expect(dotBtns[i].tagName).toBe('BUTTON');
      const label = dotBtns[i].getAttribute('aria-label') || '';
      expect(label).toMatch(new RegExp(`(Show plan ${i + 1}|योजना ${i + 1} दिखाएँ)`));
    }
  });

  it('default active dot is index 1 (Starter centered)', () => {
    renderPricing();
    const dotsList = screen.getByRole('tablist', { name: /Choose plan|योजना चुनें/ });
    const dotBtns = within(dotsList).getAllByRole('button');
    expect(dotBtns[1].className).toMatch(/active/);
    expect(dotBtns[0].className).not.toMatch(/active/);
    expect(dotBtns[2].className).not.toMatch(/active/);
    expect(dotBtns[3].className).not.toMatch(/active/);
  });

  it('clicking a dot scrolls the corresponding card into view', () => {
    renderPricing();
    const cards = Array.from(
      document.querySelectorAll('article[role="listitem"]'),
    ) as HTMLElement[];
    expect(cards).toHaveLength(4);

    // Stub scrollIntoView per-card.
    const spies = cards.map((c) => {
      const fn = vi.fn();
      (c as unknown as { scrollIntoView: typeof fn }).scrollIntoView = fn;
      return fn;
    });

    const dotsList = screen.getByRole('tablist', { name: /Choose plan|योजना चुनें/ });
    const dotBtns = within(dotsList).getAllByRole('button');
    fireEvent.click(dotBtns[3]); // jump to Unlimited (last plan)

    expect(spies[3]).toHaveBeenCalledTimes(1);
    expect(spies[3]).toHaveBeenCalledWith({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  });

  it('clicking dot 0 scrolls to Explorer card', () => {
    renderPricing();
    const cards = Array.from(
      document.querySelectorAll('article[role="listitem"]'),
    ) as HTMLElement[];
    const spy = vi.fn();
    (cards[0] as unknown as { scrollIntoView: typeof spy }).scrollIntoView = spy;

    const dotsList = screen.getByRole('tablist', { name: /Choose plan|योजना चुनें/ });
    const dotBtns = within(dotsList).getAllByRole('button');
    fireEvent.click(dotBtns[0]);
    expect(spy).toHaveBeenCalled();
  });
});
