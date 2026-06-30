import { test, expect } from '@playwright/test';

/**
 * E2E smoke — Alfa Momentum Wave 1 (landing elevation).
 *
 * This spec is FOCUSED on the three Wave 1 bug fixes plus the two invariants
 * those fixes depend on. It is deliberately resilient (no pixel asserts, no
 * computed-style brittleness) — it pins behaviour, not layout.
 *
 *   Bug fix 1 — StickyMobileCTA observes the REAL final-CTA id.
 *     FinalCtaV2 renders <section id="cta">. The sticky bar previously watched
 *     a nonexistent "#final-cta", so its "hide on final CTA" branch never
 *     fired. We assert the wiring the fix depends on is present: the sticky
 *     bar element exists and a section with id="cta" exists. (Visibility of the
 *     bar itself is scroll/IntersectionObserver-driven and mobile-only — out of
 *     scope for a resilient smoke; presence of both endpoints is the load-
 *     bearing assertion.)
 *
 *   Bug fix 2 — Pricing copy "Three" → "Four" plans (EN + HI).
 *     PricingTeaserV2 now renders FOUR plan cards (Explorer, Starter, Pro,
 *     Unlimited) and the header reads "Four plans" / "चार योजनाएँ". We assert
 *     four cards render and the header no longer says "Three".
 *
 *   Bug fix 3 — WelcomeV2 dropped the vestigial <LangProvider> wrapper.
 *     The whole tree reads language from WelcomeV2Context. We assert the page
 *     still renders and the language toggle still works (EN ⇆ HI) — P7.
 *
 * /welcome renders WelcomeV2 unconditionally (src/app/welcome/page.tsx), so no
 * feature-flag credentials are required to exercise V2 here.
 *
 * Owner: testing.
 * Run: npx playwright test e2e/welcome-landing.spec.ts
 */

const DEVANAGARI = /[ऀ-ॿ]/; // any Devanagari codepoint (P7 sanity)

test.describe('Welcome landing — Alfa Momentum Wave 1 smoke', () => {
  test('renders hero headline and a primary CTA', async ({ page }) => {
    await page.goto('/welcome');

    // Hero <h1> is present and visible.
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible();

    // Default role = parent → headline "Tonight's homework / can be different."
    await expect(h1).toContainText(/different/i);

    // Primary hero CTA (id="hero-cta") links to /login.
    const heroCta = page.locator('#hero-cta');
    await expect(heroCta).toBeVisible();
    await expect(heroCta).toHaveAttribute('href', '/login');
  });

  test('pricing shows FOUR plan cards and header no longer says "Three"', async ({ page }) => {
    await page.goto('/welcome');

    const pricing = page.locator('#pricing');
    await pricing.scrollIntoViewIfNeeded();
    await expect(pricing).toBeVisible();

    // Bug fix: the header copy is "Four plans", not "Three".
    const heading = pricing.locator('#pricing-title');
    await expect(heading).toContainText(/Four/i);
    await expect(heading).not.toContainText(/Three/i);

    // FOUR plan cards render (role="listitem" inside the pricing track).
    const cards = pricing.locator('[role="list"] [role="listitem"]');
    await expect(cards).toHaveCount(4);

    // The four named plans are present.
    await expect(pricing.getByText('Plan i · Explorer')).toBeVisible();
    await expect(pricing.getByText('Plan ii · Starter')).toBeVisible();
    await expect(pricing.getByText('Plan iii · Pro')).toBeVisible();
    await expect(pricing.getByText('Plan iv · Unlimited')).toBeVisible();
  });

  test('sticky-CTA wiring is present: final CTA section has id="cta" and sticky bar exists', async ({ page }) => {
    await page.goto('/welcome');

    // The id the StickyMobileCTA now observes (was the nonexistent "#final-cta").
    const finalCta = page.locator('section#cta');
    await expect(finalCta).toHaveCount(1);

    // The sticky mobile bar is rendered into the DOM (it is sm:hidden + slides
    // via transform; it always exists in markup regardless of viewport).
    const stickyStart = page.locator('a:has-text("Start Free")');
    await expect(stickyStart.first()).toHaveCount(1);

    // The hero CTA anchor the sticky bar observes for the "show" branch exists.
    await expect(page.locator('#hero-cta')).toHaveCount(1);
  });

  test('renders in both EN and HI (P7): toggle surfaces Devanagari', async ({ page }) => {
    await page.goto('/welcome');

    // English baseline: pricing header reads "Four plans".
    await expect(page.locator('#pricing-title')).toContainText(/Four/i);

    // Toggle language. Desktop toggle aria-label is "भाषा हिन्दी में बदलें"
    // when EN; mobile menu toggle is "Toggle language". Match either.
    const langToggle = page
      .locator('button[aria-label*="हिन्दी"], button[aria-label*="भाषा"]')
      .first();
    await expect(langToggle).toBeVisible();
    await langToggle.click();

    // Hindi pricing header: "चार योजनाएँ".
    await expect(page.locator('#pricing-title')).toContainText('चार');

    // Hero headline now carries Devanagari (P7).
    await expect(page.locator('h1').first()).toHaveText(DEVANAGARI);

    // <html lang="hi"> mirrored by ThemedShell effect.
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  });
});
