import { test, expect } from '@playwright/test';

/**
 * E2E SEO Tests -- Verify structured data, meta tags, sitemap, and robots.txt.
 * These tests ensure search engine crawlability and proper indexing signals.
 *
 * Run: npx playwright test e2e/landing-seo.spec.ts
 */

test.describe('JSON-LD Structured Data', () => {
  test('welcome page contains FAQPage JSON-LD schema', async ({ page }) => {
    await page.goto('/welcome');
    const jsonLd = page.locator('script[type="application/ld+json"]');
    await expect(jsonLd).toBeAttached();

    const content = await jsonLd.textContent();
    expect(content).toBeTruthy();

    const schema = JSON.parse(content!);
    expect(schema['@context']).toBe('https://schema.org');
    expect(schema['@type']).toBe('FAQPage');
    expect(schema.mainEntity).toBeInstanceOf(Array);
    expect(schema.mainEntity.length).toBeGreaterThan(0);
    // Each FAQ item should have Question type
    expect(schema.mainEntity[0]['@type']).toBe('Question');
    expect(schema.mainEntity[0].acceptedAnswer['@type']).toBe('Answer');
  });
});

test.describe('Meta Tags - Welcome Page', () => {
  test('has og:title meta tag', async ({ page }) => {
    await page.goto('/welcome');
    const ogTitle = page.locator('meta[property="og:title"]');
    await expect(ogTitle).toBeAttached();
    const content = await ogTitle.getAttribute('content');
    expect(content).toBeTruthy();
    expect(content).toContain('Alfanumrik');
  });

  test('has og:description meta tag', async ({ page }) => {
    await page.goto('/welcome');
    const ogDesc = page.locator('meta[property="og:description"]');
    await expect(ogDesc).toBeAttached();
    const content = await ogDesc.getAttribute('content');
    expect(content).toBeTruthy();
    expect(content!.length).toBeGreaterThan(20);
  });

  test('has canonical URL meta tag', async ({ page }) => {
    await page.goto('/welcome');
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toBeAttached();
    const href = await canonical.getAttribute('href');
    expect(href).toContain('alfanumrik.com/welcome');
  });

  test('has description meta tag', async ({ page }) => {
    await page.goto('/welcome');
    const desc = page.locator('meta[name="description"]');
    await expect(desc).toBeAttached();
    const content = await desc.getAttribute('content');
    expect(content).toBeTruthy();
    expect(content!.length).toBeGreaterThan(50);
  });

  test('has keywords meta tag', async ({ page }) => {
    await page.goto('/welcome');
    const keywords = page.locator('meta[name="keywords"]');
    await expect(keywords).toBeAttached();
    const content = await keywords.getAttribute('content');
    expect(content).toContain('CBSE');
  });

  test('has twitter card meta tag', async ({ page }) => {
    await page.goto('/welcome');
    const twitterCard = page.locator('meta[name="twitter:card"]');
    await expect(twitterCard).toBeAttached();
    const content = await twitterCard.getAttribute('content');
    expect(content).toBe('summary_large_image');
  });

  test('does not block indexing (no noindex)', async ({ page }) => {
    await page.goto('/welcome');
    const robots = page.locator('meta[name="robots"]');
    // Either robots meta is absent (allowing indexing by default)
    // or if present, it should not contain "noindex"
    const count = await robots.count();
    if (count > 0) {
      const content = await robots.getAttribute('content');
      expect(content).not.toContain('noindex');
    }
    // If no robots meta, indexing is allowed by default -- test passes
  });
});

test.describe('Meta Tags - Pricing Page', () => {
  test('has og:title and og:description', async ({ page }) => {
    await page.goto('/pricing');
    const ogTitle = page.locator('meta[property="og:title"]');
    await expect(ogTitle).toBeAttached();
    const titleContent = await ogTitle.getAttribute('content');
    expect(titleContent).toContain('Pricing');

    const ogDesc = page.locator('meta[property="og:description"]');
    await expect(ogDesc).toBeAttached();
  });

  test('has canonical URL for pricing', async ({ page }) => {
    await page.goto('/pricing');
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toBeAttached();
    const href = await canonical.getAttribute('href');
    expect(href).toContain('alfanumrik.com/pricing');
  });
});

test.describe('Sitemap and Robots', () => {
  test('sitemap.xml is accessible and returns XML', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const contentType = res.headers()['content-type'];
    expect(contentType).toMatch(/xml/);
    const body = await res.text();
    expect(body).toContain('urlset');
    expect(body).toContain('alfanumrik');
  });

  test('robots.txt is accessible', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    // robots.txt should have at least a User-agent directive
    expect(body).toContain('User-agent');
  });

  test('robots.txt references sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt');
    const body = await res.text();
    // A well-configured robots.txt should reference the sitemap
    expect(body.toLowerCase()).toContain('sitemap');
  });

  test('robots.txt does not disallow all', async ({ request }) => {
    const res = await request.get('/robots.txt');
    const body = await res.text();
    // Should not have "Disallow: /" for all user-agents (that blocks everything)
    // It's OK to disallow specific paths
    const lines = body.split('\n').map(l => l.trim());
    const hasDisallowAll = lines.some(
      (line, i) => {
        if (line === 'Disallow: /') {
          // Check if the preceding User-agent is "*" -- that would block all crawlers
          for (let j = i - 1; j >= 0; j--) {
            if (lines[j].startsWith('User-agent:')) {
              return lines[j].includes('*');
            }
          }
        }
        return false;
      }
    );
    expect(hasDisallowAll).toBe(false);
  });
});

test.describe('Product Page SEO', () => {
  test('product page has og:title', async ({ page }) => {
    await page.goto('/product');
    const ogTitle = page.locator('meta[property="og:title"]');
    await expect(ogTitle).toBeAttached();
    const content = await ogTitle.getAttribute('content');
    expect(content).toContain('Product');
  });
});
