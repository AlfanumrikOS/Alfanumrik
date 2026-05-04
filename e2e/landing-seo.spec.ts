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
    // /welcome emits multiple JSON-LD scripts (Organization, WebApplication,
    // FAQPage, Review). Filter by content to grab the FAQPage one.
    const jsonLd = page
      .locator('script[type="application/ld+json"]')
      .filter({ hasText: 'FAQPage' })
      .first();
    await expect(jsonLd).toBeAttached();

    const content = await jsonLd.textContent();
    expect(content).toBeTruthy();

    const schema = JSON.parse(content!);
    expect(schema['@context']).toBe('https://schema.org');
    expect(schema['@type']).toBe('FAQPage');
    expect(schema.mainEntity).toBeInstanceOf(Array);
    expect(schema.mainEntity.length).toBe(10); // Phase 3 ships exactly 10 FAQs
    // Each FAQ item should have Question type and acceptedAnswer
    expect(schema.mainEntity[0]['@type']).toBe('Question');
    expect(schema.mainEntity[0].acceptedAnswer['@type']).toBe('Answer');
    // Markdown bold markers must be stripped from schema text
    schema.mainEntity.forEach((q: { acceptedAnswer: { text: string } }) => {
      expect(q.acceptedAnswer.text).not.toContain('**');
    });
  });

  test('welcome page contains Review JSON-LD schema with 3 testimonials', async ({ page }) => {
    await page.goto('/welcome');
    const jsonLd = page
      .locator('script[type="application/ld+json"]')
      .filter({ hasText: '"review"' })
      .first();
    await expect(jsonLd).toBeAttached();

    const content = await jsonLd.textContent();
    const schema = JSON.parse(content!);
    expect(schema['@type']).toBe('WebApplication');
    expect(schema.review).toBeInstanceOf(Array);
    expect(schema.review.length).toBe(3); // Phase 3: founder + teacher + parent

    schema.review.forEach((r: { '@type': string; author: { name: string }; reviewBody: string; reviewRating: { ratingValue: string } }) => {
      expect(r['@type']).toBe('Review');
      expect(r.author.name).toBeTruthy();
      expect(r.reviewBody.length).toBeGreaterThan(20);
      expect(r.reviewRating.ratingValue).toBe('5');
    });
  });

  test('about page contains BreadcrumbList JSON-LD with correct trail', async ({ page }) => {
    await page.goto('/about');
    const jsonLd = page
      .locator('script[type="application/ld+json"]')
      .filter({ hasText: 'BreadcrumbList' })
      .first();
    await expect(jsonLd).toBeAttached();

    const content = await jsonLd.textContent();
    const schema = JSON.parse(content!);
    expect(schema['@type']).toBe('BreadcrumbList');
    expect(schema.itemListElement).toBeInstanceOf(Array);
    expect(schema.itemListElement.length).toBe(2); // Home -> About
    expect(schema.itemListElement[0].name).toBe('Home');
    expect(schema.itemListElement[0].item).toContain('/welcome');
    expect(schema.itemListElement[1].name).toBe('About');
    // Last crumb has no `item` URL (current page)
    expect(schema.itemListElement[1].item).toBeUndefined();
  });

  test('for-parents page contains BreadcrumbList JSON-LD with Solutions intermediate (no link)', async ({ page }) => {
    await page.goto('/for-parents');
    const jsonLd = page
      .locator('script[type="application/ld+json"]')
      .filter({ hasText: 'BreadcrumbList' })
      .first();
    await expect(jsonLd).toBeAttached();

    const content = await jsonLd.textContent();
    const schema = JSON.parse(content!);
    expect(schema.itemListElement.length).toBe(3); // Home -> Solutions -> For Parents
    expect(schema.itemListElement[0].name).toBe('Home');
    expect(schema.itemListElement[1].name).toBe('Solutions');
    // Solutions intermediate has no item URL (no /solutions page exists)
    expect(schema.itemListElement[1].item).toBeUndefined();
    expect(schema.itemListElement[2].name).toBe('For Parents');
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

  // Keywords meta tag is intentionally NOT emitted on /welcome.
  // Google has ignored the keywords meta since 2009; emitting a 10-keyword
  // string can look like spam without any SEO benefit. This test guards
  // against accidental re-introduction of the obsolete tag.
  test('does not emit obsolete keywords meta tag', async ({ page }) => {
    await page.goto('/welcome');
    const keywords = page.locator('meta[name="keywords"]');
    await expect(keywords).not.toBeAttached();
  });

  // hreflang tags signal language/region availability to search engines.
  // Added in the same Phase 1 change that removed the keywords meta.
  test('emits hreflang link tags for en-IN, hi-IN, and x-default', async ({ page }) => {
    await page.goto('/welcome');
    const enIn = page.locator('link[rel="alternate"][hreflang="en-IN"]');
    const hiIn = page.locator('link[rel="alternate"][hreflang="hi-IN"]');
    const xDefault = page.locator('link[rel="alternate"][hreflang="x-default"]');
    await expect(enIn).toBeAttached();
    await expect(hiIn).toBeAttached();
    await expect(xDefault).toBeAttached();
    const enHref = await enIn.getAttribute('href');
    const hiHref = await hiIn.getAttribute('href');
    expect(enHref).toContain('alfanumrik.com/welcome');
    expect(hiHref).toContain('lang=hi');
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

  // Phase 1 dedup: the bare https://alfanumrik.com/ entry was removed
  // because the root redirects unauthenticated visitors to /welcome.
  // Two priority-1 entries pointing at the same destination is a
  // duplicate-content signal. This test guards against re-introduction.
  test('sitemap does not duplicate root and /welcome as priority 1', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    const body = await res.text();
    // Match <url><loc>https://alfanumrik.com/</loc> ... </url> blocks where
    // the loc is exactly the root (no path segment after the .com/).
    const rootEntry = /<loc>https:\/\/alfanumrik\.com\/<\/loc>/;
    expect(body).not.toMatch(rootEntry);
    // /welcome must still be present.
    expect(body).toContain('alfanumrik.com/welcome');
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
