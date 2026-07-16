import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

/**
 * Tests for the V3 landing page (landing-v3 makeover, 2026-07-16).
 *
 * Source: packages/ui/src/landing/v3/WelcomeV3.tsx (+ HeroV3, FAQV3,
 * TestimonialsV3, PricingTeaserV3, NavV3).
 *
 * Context: V3 is now the DEFAULT render on /welcome (WelcomeV2 stays
 * reachable via the ?v=2 rollback hatch — see welcome-v2-routing.test.ts).
 * This file pins the V3 contract that the e2e specs (welcome-landing,
 * landing-seo) and the SEO surfaces depend on:
 *
 *   - data-testid="welcome-root" shell + exactly ONE <h1>
 *   - hero CTA id="hero-cta" → /login
 *   - FAQ: 10 native <details> items + FAQPage JSON-LD with
 *     mainEntity.length === 10 (English-only, markdown-bold stripped)
 *   - REG-65: the literal "₹699" survives the V3 FAQ rewrite VERBATIM
 *   - price-bug fix pin: the retired "₹1,499" Unlimited price is ABSENT;
 *     the corrected "₹1,099" (= PRICING.unlimited.monthly) is present
 *   - Review JSON-LD: WebApplication with EXACTLY 2 reviews (Google-merge
 *     contract shared with JsonLd.tsx via @id)
 *   - P7: language toggle flips visible copy to Hindi
 *
 * Conventions follow landing-v2/PricingTeaserV2.test.tsx / NavV2.test.tsx
 * (provider is internal to WelcomeV3, so no wrapper needed; matchMedia stub;
 * localStorage reset).
 *
 * Owning agent: testing.
 */

// AlfaBotMount is loaded via next/dynamic ssr:false and probes a feature
// flag over fetch — stub next/dynamic so the widget never mounts (hermetic;
// same pattern as learn-chapter-load-error.test.tsx).
vi.mock('next/dynamic', () => ({ default: () => () => null }));

import WelcomeV3 from '@alfanumrik/ui/landing/v3/WelcomeV3';
import { PRICING, formatINR } from '@alfanumrik/lib/plans';

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

function renderWelcome() {
  // WelcomeV3 wraps itself in WelcomeV2Provider (version-agnostic language
  // provider) — no external wrapper required.
  return render(<WelcomeV3 />);
}

/** Parse every JSON-LD script currently in the document. */
function readJsonLd(): Record<string, unknown>[] {
  return Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  )
    .map((s) => s.textContent || '')
    .filter(Boolean)
    .map((text) => JSON.parse(text));
}

describe('WelcomeV3 — shell and hero contract', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    localStorage.clear();
    document.documentElement.removeAttribute('lang');
    delete document.body.dataset.theme;
  });
  afterEach(() => cleanup());

  it('renders the root shell with data-testid="welcome-root"', () => {
    renderWelcome();
    expect(screen.getByTestId('welcome-root')).toBeInTheDocument();
  });

  it('renders exactly ONE <h1> (hero headline)', () => {
    renderWelcome();
    const h1s = document.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0].id).toBe('welcome-v3-hero-title');
  });

  it('hero CTA has id="hero-cta" and links to /login', () => {
    renderWelcome();
    const cta = document.querySelector('#hero-cta');
    expect(cta).not.toBeNull();
    expect(cta!.tagName).toBe('A');
    expect(cta!.getAttribute('href')).toBe('/login');
    // EN default label
    expect(cta!.textContent).toMatch(/Start free/i);
  });
});

describe('WelcomeV3 — FAQ (10 items + FAQPage JSON-LD)', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('renders exactly 10 native <details> FAQ items inside #faq', () => {
    renderWelcome();
    const faqDetails = document.querySelectorAll('#faq details');
    expect(faqDetails).toHaveLength(10);
    // No stray <details> elsewhere on the page (V3 footer has no accordion).
    expect(document.querySelectorAll('details')).toHaveLength(10);
  });

  it('emits FAQPage JSON-LD with mainEntity.length === 10, bold stripped', () => {
    renderWelcome();
    const schemas = readJsonLd();
    const faq = schemas.find((s) => s['@type'] === 'FAQPage') as
      | { mainEntity: { '@type': string; name: string; acceptedAnswer: { '@type': string; text: string } }[] }
      | undefined;
    expect(faq).toBeTruthy();
    expect(Array.isArray(faq!.mainEntity)).toBe(true);
    expect(faq!.mainEntity).toHaveLength(10);
    for (const q of faq!.mainEntity) {
      expect(q['@type']).toBe('Question');
      expect(q.acceptedAnswer['@type']).toBe('Answer');
      // Google policy: markdown bold markers must be stripped from JSON-LD.
      expect(q.acceptedAnswer.text).not.toContain('**');
    }
  });

  it('REG-65: the literal "₹699" stays VERBATIM in the plans FAQ answer', () => {
    renderWelcome();
    const faqSection = document.querySelector('#faq');
    expect(faqSection).not.toBeNull();
    expect(faqSection!.textContent).toContain('₹699');
    // Lock-step guard: the verbatim literal equals the SoT-derived Pro price,
    // so any PRICING change surfaces here as a deliberate copy decision.
    expect(formatINR(PRICING.pro.monthly)).toBe('₹699');
  });

  it('price-bug fix pin: "₹1,499" is ABSENT everywhere; corrected "₹1,099" is present', () => {
    renderWelcome();
    // The Unlimited price previously (wrongly) read ₹1,499/month in the FAQ.
    // Corrected 2026-07 (CEO-confirmed) to ₹1,099 = PRICING.unlimited.monthly.
    expect(document.body.textContent).not.toContain('₹1,499');
    // JSON-LD payloads must be clean too (that is what Google indexes).
    for (const schema of readJsonLd()) {
      expect(JSON.stringify(schema)).not.toContain('₹1,499');
    }
    expect(document.body.textContent).toContain('₹1,099');
    expect(formatINR(PRICING.unlimited.monthly)).toBe('₹1,099');
  });
});

describe('WelcomeV3 — Review JSON-LD (SEO contract)', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('emits a WebApplication schema with EXACTLY 2 five-star reviews', () => {
    renderWelcome();
    const schemas = readJsonLd();
    const app = schemas.find((s) => Array.isArray((s as { review?: unknown }).review)) as
      | {
          '@type': string;
          '@id': string;
          review: { '@type': string; author: { name: string }; reviewBody: string; reviewRating: { ratingValue: string } }[];
        }
      | undefined;
    expect(app).toBeTruthy();
    expect(app!['@type']).toBe('WebApplication');
    // Same @id as JsonLd.tsx so Google merges the entities.
    expect(app!['@id']).toBe('https://alfanumrik.com/#webapp');
    expect(app!.review).toHaveLength(2);
    for (const r of app!.review) {
      expect(r['@type']).toBe('Review');
      expect(r.author.name).toBeTruthy();
      expect(r.reviewBody.length).toBeGreaterThan(20);
      expect(r.reviewRating.ratingValue).toBe('5');
    }
  });
});

describe('WelcomeV3 — language toggle (P7)', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    localStorage.clear();
    document.documentElement.removeAttribute('lang');
  });
  afterEach(() => cleanup());

  it('toggling language flips the hero CTA copy to Hindi and persists', () => {
    renderWelcome();
    const cta = document.querySelector('#hero-cta')!;
    expect(cta.textContent).toContain('Start free');

    // NavV3 language toggle (EN state → aria-label is the Hindi switch label).
    const langBtn = screen.getByLabelText('भाषा हिन्दी में बदलें');
    fireEvent.click(langBtn);

    expect(cta.textContent).toContain('मुफ्त शुरू करें');
    // Same localStorage key as V2 — the en/hi preference survives V2 ⇄ V3
    // rollback flips (WelcomeV2Provider is version-agnostic by design).
    expect(localStorage.getItem('alf-welcome-lang')).toBe('hi');
    // ThemedShell mirrors lang to <html> for screen readers.
    expect(document.documentElement.getAttribute('lang')).toBe('hi');
  });
});
