import { test, expect } from '@playwright/test';

/**
 * E2E Accessibility Tests -- Verify basic accessibility requirements.
 * Checks: button labels, heading hierarchy, alt text, form labels, aria attributes.
 *
 * Run: npx playwright test e2e/accessibility.spec.ts
 */

test.describe('Landing Page Accessibility', () => {
  test('all buttons have accessible names', async ({ page }) => {
    await page.goto('/welcome');
    await page.waitForLoadState('networkidle');

    const buttons = page.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      const visible = await button.isVisible();
      if (!visible) continue;

      // Each button should have either text content, aria-label, or aria-labelledby
      const text = (await button.textContent())?.trim();
      const ariaLabel = await button.getAttribute('aria-label');
      const ariaLabelledBy = await button.getAttribute('aria-labelledby');
      const title = await button.getAttribute('title');

      const hasAccessibleName = (text && text.length > 0) || ariaLabel || ariaLabelledBy || title;
      expect(
        hasAccessibleName,
        `Button at index ${i} has no accessible name. Text: "${text}", aria-label: "${ariaLabel}"`
      ).toBeTruthy();
    }
  });

  test('heading hierarchy has no skips (h1 before h2, h2 before h3)', async ({ page }) => {
    await page.goto('/welcome');
    await page.waitForLoadState('networkidle');

    // Get all headings in document order
    const headings = await page.evaluate(() => {
      const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      return Array.from(elements).map(el => ({
        tag: el.tagName.toLowerCase(),
        level: parseInt(el.tagName[1]),
        text: el.textContent?.trim().substring(0, 50) || '',
      }));
    });

    expect(headings.length).toBeGreaterThan(0);

    // First heading should be h1
    expect(headings[0].level).toBe(1);

    // Check no heading level is skipped (e.g., h1 then h3 without h2)
    let maxLevelSeen = 0;
    for (const heading of headings) {
      // Allow going back up (e.g., h3 then h2), but going down should not skip
      if (heading.level > maxLevelSeen + 1 && heading.level > maxLevelSeen) {
        // Only fail if we jump more than one level deeper
        expect(
          heading.level,
          `Heading "${heading.text}" (${heading.tag}) skips a level after max level ${maxLevelSeen}`
        ).toBeLessThanOrEqual(maxLevelSeen + 1);
      }
      maxLevelSeen = Math.max(maxLevelSeen, heading.level);
    }
  });

  test('page has exactly one h1', async ({ page }) => {
    await page.goto('/welcome');
    await page.waitForLoadState('networkidle');

    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBe(1);
  });

  test('language toggle has aria-label', async ({ page }) => {
    await page.goto('/welcome');

    // The LangToggle button has aria-label
    const langToggle = page.locator('button[aria-label]').filter({
      has: page.locator('text=EN'),
    });
    await expect(langToggle).toBeVisible();

    const ariaLabel = await langToggle.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    // Should describe the toggle action
    expect(ariaLabel!.length).toBeGreaterThan(5);
  });

  test('language toggle aria-label updates after switching to Hindi', async ({ page }) => {
    await page.goto('/welcome');

    const langToggle = page.locator('button[aria-label]').filter({
      has: page.locator('text=EN'),
    });

    // In English mode, aria-label should be in Hindi (telling Hindi speakers to switch)
    const englishLabel = await langToggle.getAttribute('aria-label');
    expect(englishLabel).toContain('हिन्दी');

    // Switch to Hindi
    await langToggle.click();

    // In Hindi mode, aria-label should be in English (telling English speakers to switch)
    const hindiLabel = await langToggle.getAttribute('aria-label');
    expect(hindiLabel).toContain('English');
  });

  test('links to login pages have descriptive text', async ({ page }) => {
    await page.goto('/welcome');

    // CTA links should have meaningful text, not just "click here"
    const ctaLinks = page.locator('a[href="/login"]');
    const count = await ctaLinks.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const link = ctaLinks.nth(i);
      const visible = await link.isVisible();
      if (!visible) continue;

      const text = (await link.textContent())?.trim();
      const ariaLabel = await link.getAttribute('aria-label');
      const hasLabel = (text && text.length > 2) || ariaLabel;
      expect(
        hasLabel,
        `Login link at index ${i} has no descriptive text`
      ).toBeTruthy();
    }
  });
});

test.describe('Login Page Accessibility', () => {
  test('login form inputs have associated labels or aria-label', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const inputs = page.locator('input:visible');
    const count = await inputs.count();

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const type = await input.getAttribute('type');
      // Skip hidden inputs and submit buttons
      if (type === 'hidden' || type === 'submit') continue;

      const id = await input.getAttribute('id');
      const ariaLabel = await input.getAttribute('aria-label');
      const ariaLabelledBy = await input.getAttribute('aria-labelledby');
      const placeholder = await input.getAttribute('placeholder');

      // Check if there's a label element associated via "for" attribute
      let hasLabel = false;
      if (id) {
        const label = page.locator(`label[for="${id}"]`);
        hasLabel = (await label.count()) > 0;
      }

      const hasAccessibleLabel = hasLabel || ariaLabel || ariaLabelledBy || placeholder;
      expect(
        hasAccessibleLabel,
        `Input at index ${i} (type="${type}") has no accessible label`
      ).toBeTruthy();
    }
  });

  test('role tab buttons have accessible text', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=Student')).toBeVisible({ timeout: 10_000 });

    const roleTabs = page.locator('button').filter({
      hasText: /Student|Teacher|Parent/,
    });
    const count = await roleTabs.count();
    expect(count).toBe(3);

    for (let i = 0; i < count; i++) {
      const tab = roleTabs.nth(i);
      const text = await tab.textContent();
      expect(text?.trim().length).toBeGreaterThan(0);
    }
  });
});

test.describe('Not Found Page Accessibility', () => {
  test('404 page has proper heading structure', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await page.waitForLoadState('networkidle');

    const h1 = page.locator('h1');
    await expect(h1).toBeVisible({ timeout: 10_000 });
    await expect(h1).toContainText('Page Not Found');
  });

  test('404 page Back to Dashboard link has aria-label', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    const backLink = page.locator('a[aria-label="Go back to dashboard"]');
    await expect(backLink).toBeVisible({ timeout: 10_000 });
  });

  test('404 page alternative nav has aria-label', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    const altNav = page.locator('nav[aria-label="Additional navigation"]');
    await expect(altNav).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Pricing Page Accessibility', () => {
  test('pricing page has proper heading hierarchy', async ({ page }) => {
    await page.goto('/pricing');
    await page.waitForLoadState('networkidle');

    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    await expect(h1).toContainText('Pricing');

    // h2 elements should exist for subsections
    const h2Count = await page.locator('h2').count();
    expect(h2Count).toBeGreaterThan(0);
  });
});
