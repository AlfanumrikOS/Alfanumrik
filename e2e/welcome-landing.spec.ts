import { test, expect } from '@playwright/test';

/**
 * E2E smoke — /welcome landing page (V3 default).
 *
 * UPDATED 2026-07-16 for the landing-v3 makeover (CEO-approved design,
 * design-previews/welcome-ultra.html). /welcome now renders WelcomeV3 by
 * DEFAULT (apps/host/src/app/welcome/page.tsx); the previous WelcomeV2 stays
 * reachable via the `?v=2` rollback hatch and keeps its own coverage in
 * e2e/welcome-v2.spec.ts. The Wave-1 V2 assertions this file used to carry
 * (role-based hero copy, "Four plans" header, StickyMobileCTA wiring) were
 * deliberately REPLACED with equivalent-or-stronger V3 pins — none deleted
 * without replacement:
 *
 *   - hero: single H1 "Every chapter …" + #hero-cta → /login (id unchanged
 *     from V2 — analytics and this spec share the stable hook)
 *   - pricing teaser: FOUR plan cards (Explorer/Starter/Pro/Unlimited) with
 *     the Pro "Most popular" badge (replaces the V2 "Plan i..iv ·" labels)
 *   - final CTA: V3 ships NO StickyMobileCTA; the sticky-wiring test became
 *     a FinalCtaV3 pin (ink band + /login CTA)
 *   - P7: EN⇆HI toggle surfaces Devanagari + <html lang="hi">
 *
 * Deliberately resilient (no pixel asserts, no computed-style brittleness) —
 * pins behaviour, not layout.
 *
 * Owner: testing.
 * Run: npx playwright test e2e/welcome-landing.spec.ts
 */

const DEVANAGARI = /[ऀ-ॿ]/; // any Devanagari codepoint (P7 sanity)

test.describe('Welcome landing — V3 smoke', () => {
  test('renders the V3 hero headline and a primary CTA', async ({ page }) => {
    await page.goto('/welcome');

    // V3 root shell renders (same testid as V2 — stable hook).
    await expect(page.getByTestId('welcome-root')).toBeVisible();

    // Exactly ONE <h1>: the hero headline ("Every chapter" + rotor word).
    const h1 = page.locator('h1');
    await expect(h1).toHaveCount(1);
    await expect(h1).toContainText(/Every chapter/i);

    // Primary hero CTA (id="hero-cta") links to /login.
    const heroCta = page.locator('#hero-cta');
    await expect(heroCta).toBeVisible();
    await expect(heroCta).toHaveAttribute('href', '/login');
  });

  test('pricing teaser shows FOUR plan cards with Pro featured', async ({ page }) => {
    await page.goto('/welcome');

    const pricing = page.locator('#pricing');
    await pricing.scrollIntoViewIfNeeded();
    await expect(pricing).toBeVisible();

    // V3 header copy (replaces V2's "Four plans" line).
    await expect(pricing.locator('#pricing-v3-title')).toContainText(
      /Less than a single tuition class/i,
    );

    // FOUR plan cards render as <article> elements.
    await expect(pricing.locator('article')).toHaveCount(4);
    for (const plan of ['Explorer', 'Starter', 'Pro', 'Unlimited']) {
      await expect(
        pricing.getByRole('heading', { name: plan, exact: true }),
      ).toBeVisible();
    }

    // Pro is the featured plan — assert the badge, not a ₹ value (paid prices
    // come from PRICING and drift; that drift broke the V2 spec before, so we
    // pin the featured plan structurally. Price↔SoT lock-step is unit-pinned
    // in apps/host/src/__tests__/landing-v3/.)
    await expect(pricing.getByText(/Most popular/i)).toBeVisible();
  });

  test('final CTA ink band renders with a /login CTA (V3 ships no sticky mobile bar)', async ({ page }) => {
    await page.goto('/welcome');

    // Replaces the V2 StickyMobileCTA-wiring test: WelcomeV3 intentionally has
    // no sticky bar (CEO-approved preview has none). The conversion surface at
    // the bottom of the page is FinalCtaV3.
    const finalCta = page.locator('section[aria-labelledby="final-cta-v3-title"]');
    await finalCta.scrollIntoViewIfNeeded();
    await expect(finalCta).toBeVisible();
    await expect(finalCta.locator('#final-cta-v3-title')).toContainText(
      /Tonight’s homework can be different|Tonight's homework can be different/,
    );
    await expect(finalCta.locator('a[href="/login"]')).toBeVisible();
  });

  test('renders in both EN and HI (P7): toggle surfaces Devanagari', async ({ page }) => {
    await page.goto('/welcome');

    // English baseline: pricing teaser header.
    await expect(page.locator('#pricing-v3-title')).toContainText(/tuition class/i);

    // NavV3 language toggle. In EN state its aria-label is the Hindi switch
    // label ("भाषा हिन्दी में बदलें") — same contract as V2's NavV2.
    const langToggle = page
      .locator('button[aria-label*="हिन्दी"], button[aria-label*="भाषा"]')
      .first();
    await expect(langToggle).toBeVisible();
    await langToggle.click();

    // Hindi pricing header: "महीने की एक ट्यूशन क्लास से भी कम।"
    await expect(page.locator('#pricing-v3-title')).toContainText('ट्यूशन');

    // Hero headline now carries Devanagari (P7).
    await expect(page.locator('h1').first()).toContainText(DEVANAGARI);

    // <html lang="hi"> mirrored by ThemedShell effect.
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  });
});
