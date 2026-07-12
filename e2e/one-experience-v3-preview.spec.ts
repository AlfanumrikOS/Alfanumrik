import { expect, test, type Page } from '@playwright/test';

const previewCode = process.env.EXPERIENCE_V3_PREVIEW_CODE;
const expectProductionDenial = process.env.V3_EXPECT_PREVIEW_404 === 'true';
const roles = ['student', 'teacher', 'parent', 'school-admin', 'super-admin'] as const;

function previewUrl(role: typeof roles[number], options?: { locale?: 'hi'; copy?: 'long' }) {
  const query = new URLSearchParams({ role, code: previewCode! });
  if (options?.locale) query.set('locale', options.locale);
  if (options?.copy) query.set('copy', options.copy);
  return `/dev/experience-v3?${query.toString()}`;
}

async function openPreview(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#main-content').waitFor({ state: 'visible' });
  await page.locator('[data-experience="v3"] main.v3-main').waitFor({ state: 'visible' });
  // DOMContentLoaded is sufficient for layout checks, but interaction cases
  // must wait until React has attached handlers. This avoids the persistent
  // HMR connection that makes `networkidle` unsuitable in Next.js dev mode.
  await page.waitForFunction(() => {
    const control = document.querySelector('.v3-bottom-nav button');
    return control && Object.keys(control).some((key) => key.startsWith('__reactProps$'));
  });
  return response;
}

const viewports = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x800', width: 360, height: 800 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '820x1180', width: 820, height: 1180 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const;

test.describe('One Experience V3 responsive preview', () => {
  test.skip(!previewCode || expectProductionDenial, 'Development preview code is required.');

  for (const role of roles) {
    for (const viewport of viewports) {
      test(`${role} ${viewport.name} keeps one usable responsive shell`, async ({ page }) => {
        await page.setViewportSize(viewport);
        const response = await openPreview(page, previewUrl(role));
        expect(response?.status()).toBe(200);
        await expect(page.locator('[data-experience="v3"]')).toHaveCount(1);
        await expect(page.locator('#main-content')).toBeVisible();
        await expect(page.locator('main')).toHaveCount(1);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);

        if (viewport.width < 768) {
          await expect(page.locator('.v3-bottom-nav')).toBeVisible();
          await expect(page.locator('.v3-sidebar')).toBeHidden();
        } else {
          await expect(page.locator('.v3-sidebar')).toBeVisible();
          await expect(page.locator('.v3-bottom-nav')).toBeHidden();
        }
      });
    }
  }

  test('keyboard skip link reaches the canonical main region with a visible focus indicator', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openPreview(page, previewUrl('teacher'));

    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-nav')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    const notifications = page.getByRole('button', { name: 'Notifications' }).first();
    await notifications.focus();
    const focusStyle = await notifications.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle };
    });
    expect(focusStyle.width).toBeGreaterThanOrEqual(2);
    expect(focusStyle.style).not.toBe('none');
  });

  test('mobile More behaves as a keyboard-contained sheet and restores focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPreview(page, previewUrl('school-admin'));
    const essentialOnly = page.getByRole('button', { name: 'Essential Only' });
    if (await essentialOnly.isVisible()) await essentialOnly.click();
    const more = page.getByRole('button', { name: 'More' });
    await more.click();

    const dialog = page.getByRole('dialog', { name: 'More' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('#main-content')).toHaveAttribute('inert', '');
    await expect(dialog.getByRole('navigation', { name: 'More destinations' }).getByRole('link')).toHaveCount(4);
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(dialog.locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(more).toBeFocused();
  });

  test('reduced-motion preference collapses V3 transitions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 768, height: 1024 });
    await openPreview(page, previewUrl('student'));
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    const durations = await page.locator('.v3-button').first().evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        animation: style.animationDuration.split(',').map(Number.parseFloat),
        transition: style.transitionDuration.split(',').map(Number.parseFloat),
      };
    });
    expect(Math.max(...durations.animation, ...durations.transition)).toBeLessThanOrEqual(0.001);
  });

  const localizedCases = [
    { role: 'student', width: 320, height: 568 },
    { role: 'parent', width: 390, height: 844 },
    { role: 'teacher', width: 768, height: 1024 },
    { role: 'school-admin', width: 820, height: 1180 },
    { role: 'super-admin', width: 1280, height: 800 },
  ] as const;

  for (const localized of localizedCases) {
    test(`${localized.role} long Hindi copy reflows at ${localized.width}px`, async ({ page }) => {
      await page.setViewportSize({ width: localized.width, height: localized.height });
      await openPreview(page, previewUrl(localized.role, { locale: 'hi', copy: 'long' }));
      const content = page.getByTestId('v3-preview-content');
      await expect(content).toHaveAttribute('lang', 'hi');
      await expect(content).toHaveAttribute('data-preview-copy', 'long');
      await expect(page.getByTestId('preview-limitations')).toContainText('मैनुअल ब्राउज़र प्रमाणन');
      const metricTrust = page.getByTestId('preview-metric-trust');
      await metricTrust.locator('summary').click();
      await expect(metricTrust).toContainText('स्रोत की ताज़गी');
      await expect(metricTrust).toContainText('सहायक प्रमाण —');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  test('200% large text preserves 320px reflow and primary mobile navigation', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await openPreview(page, previewUrl('parent', { locale: 'hi', copy: 'long' }));
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expect(page.locator('.v3-bottom-nav')).toBeVisible();
    await expect(page.locator('#main-content')).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('One Experience V3 coarse-pointer preview', () => {
  test.skip(!previewCode || expectProductionDenial, 'Development preview code is required.');
  test.use({ hasTouch: true });

  test('touch input can open and close the mobile More sheet', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await openPreview(page, previewUrl('super-admin'));
    const essentialOnly = page.getByRole('button', { name: 'Essential Only' });
    if (await essentialOnly.isVisible()) await essentialOnly.click();
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await page.getByRole('button', { name: 'More' }).tap();
    await expect(page.getByRole('dialog', { name: 'More' })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).tap();
    await expect(page.getByRole('dialog', { name: 'More' })).toBeHidden();
  });
});

test('production build denies the preview route', async ({ page }) => {
  test.skip(!expectProductionDenial, 'Run against next start with V3_EXPECT_PREVIEW_404=true.');
  // Use the same non-secret code that opens the local development preview.
  // This proves production mode wins over a valid code instead of merely
  // proving that an invalid credential is rejected.
  const code = previewCode || 'ci-preview-code-not-configured';
  const response = await page.goto(`/dev/experience-v3?role=student&code=${encodeURIComponent(code)}`);
  expect(response?.status()).toBe(404);
});
