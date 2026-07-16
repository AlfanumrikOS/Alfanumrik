import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

/**
 * `?lang=hi` real SSR — WelcomeV3 initialLang threading (SEO layer, 2026-07-16).
 *
 * The hreflang hi-IN alternate on /welcome points at `?lang=hi`, so crawlers
 * must receive Hindi HTML from the SERVER. welcome/page.tsx threads the URL
 * param into WelcomeV3 → WelcomeV2Provider as `initialLang`, which seeds the
 * useState initializer (first render = requested language).
 *
 * Contract pinned here:
 *  1. initialLang='hi' → Hindi hero copy present in the INITIAL render.
 *  2. Explicit param WINS over localStorage post-hydration.
 *  3. No param → behavior unchanged (EN default; localStorage still hydrates).
 *
 * Mock conventions copied from WelcomeV3.test.tsx (owning agent: testing).
 */

// AlfaBotMount loads via next/dynamic ssr:false and probes a feature flag —
// stub next/dynamic so the widget never mounts (hermetic).
vi.mock('next/dynamic', () => ({ default: () => () => null }));

import WelcomeV3 from '@alfanumrik/ui/landing/v3/WelcomeV3';

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

const HINDI_HERO = 'हर अध्याय'; // HeroV3 <h1> Hindi copy
const HINDI_CTA = 'मुफ्त शुरू करें'; // hero CTA Hindi label
const EN_CTA = 'Start free';

describe('WelcomeV3 — initialLang SSR seeding (?lang=hi)', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    localStorage.clear();
    document.documentElement.removeAttribute('lang');
    delete document.body.dataset.theme;
  });
  afterEach(() => cleanup());

  it('renders the Hindi hero copy in the initial render when initialLang="hi"', () => {
    render(<WelcomeV3 initialLang="hi" />);
    const h1 = document.querySelector('#welcome-v3-hero-title');
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toContain(HINDI_HERO);
    const cta = document.querySelector('#hero-cta');
    expect(cta!.textContent).toContain(HINDI_CTA);
    // The shell carries the lang attribute (set server-side in SSR).
    expect(document.querySelector('[data-testid="welcome-root"]')!.getAttribute('lang')).toBe('hi');
  });

  it('explicit URL param WINS over a conflicting localStorage preference', () => {
    localStorage.setItem('alf-welcome-lang', 'en');
    render(<WelcomeV3 initialLang="hi" />);
    // Post-hydration (effects have run in this render) — still Hindi.
    expect(document.querySelector('#hero-cta')!.textContent).toContain(HINDI_CTA);

    cleanup();
    localStorage.setItem('alf-welcome-lang', 'hi');
    render(<WelcomeV3 initialLang="en" />);
    // ?lang=en beats the stored 'hi' preference.
    expect(document.querySelector('#hero-cta')!.textContent).toContain(EN_CTA);
  });

  it('no initialLang → existing behavior unchanged (EN default, localStorage hydrates)', () => {
    render(<WelcomeV3 />);
    expect(document.querySelector('#hero-cta')!.textContent).toContain(EN_CTA);

    cleanup();
    localStorage.setItem('alf-welcome-lang', 'hi');
    render(<WelcomeV3 />);
    // Stored preference still hydrates when no explicit param was given.
    expect(document.querySelector('#hero-cta')!.textContent).toContain(HINDI_CTA);
  });
});
