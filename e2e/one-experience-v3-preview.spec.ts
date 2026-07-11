import { expect, test } from '@playwright/test';

const previewCode = process.env.EXPERIENCE_V3_PREVIEW_CODE;
const expectProductionDenial = process.env.V3_EXPECT_PREVIEW_404 === 'true';

const roles = ['student', 'teacher', 'parent', 'school-admin', 'super-admin'] as const;
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
        const response = await page.goto(
          `/dev/experience-v3?role=${role}&code=${encodeURIComponent(previewCode!)}`,
          { waitUntil: 'networkidle' },
        );
        expect(response?.status()).toBe(200);
        await expect(page.locator('[data-experience="v3"]')).toHaveCount(1);
        await expect(page.locator('main#main-content')).toBeVisible();

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
});

test('production build denies the preview route', async ({ page }) => {
  test.skip(!expectProductionDenial, 'Run against next start with V3_EXPECT_PREVIEW_404=true.');
  const response = await page.goto('/dev/experience-v3?role=student&code=invalid');
  expect(response?.status()).toBe(404);
});
