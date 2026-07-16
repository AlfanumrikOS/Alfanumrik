import { describe, it, expect } from 'vitest';
import {
  buildMarketingMetadata,
  MARKETING_BASE_URL,
} from '@/lib/marketing-metadata';

/**
 * Unit tests for the marketing metadata builder (landing v3 SEO layer).
 *
 * Pins the contracts the e2e specs depend on:
 *  - canonical = https://alfanumrik.com + path (landing-seo.spec.ts)
 *  - hreflang trio EXACT shape when bilingual (en-IN / hi-IN=?lang=hi / x-default)
 *  - openGraph is COMPLETE and always includes og:image (regression: child
 *    openGraph objects used to replace the root one and lose og:image)
 *  - no per-page `keywords` (exactly one keywords meta site-wide, on root)
 *  - title emitted as { absolute } so the root `%s | Alfanumrik` template
 *    cannot double-brand marketing titles
 *
 * Owning agent: frontend (builder) — testing reviews.
 */

const BASE_INPUT = {
  path: '/pricing',
  title: 'Pricing — CBSE Learning App, Free & Paid Plans',
  description:
    'Transparent pricing for Alfanumrik’s CBSE learning app (Class 6–12). Start free with Foxy, upgrade for unlimited AI tutoring, quizzes & NCERT practice.',
};

describe('buildMarketingMetadata — canonical + hreflang', () => {
  it('sets canonical to base URL + path', () => {
    const md = buildMarketingMetadata(BASE_INPUT);
    expect(md.alternates?.canonical).toBe('https://alfanumrik.com/pricing');
    expect(MARKETING_BASE_URL).toBe('https://alfanumrik.com');
  });

  it('emits the EXACT hreflang trio when bilingual (e2e-pinned format)', () => {
    const md = buildMarketingMetadata({ ...BASE_INPUT, bilingual: true });
    expect(md.alternates?.languages).toEqual({
      'en-IN': 'https://alfanumrik.com/pricing',
      'hi-IN': 'https://alfanumrik.com/pricing?lang=hi',
      'x-default': 'https://alfanumrik.com/pricing',
    });
  });

  it('omits hreflang languages entirely when not bilingual', () => {
    const md = buildMarketingMetadata(BASE_INPUT);
    expect(md.alternates).not.toHaveProperty('languages');
  });
});

describe('buildMarketingMetadata — openGraph completeness (og:image bug fix)', () => {
  it('always includes og:image with 1200x630 dimensions', () => {
    const md = buildMarketingMetadata(BASE_INPUT);
    const images = md.openGraph?.images as Array<{ url: string; width: number; height: number }>;
    expect(Array.isArray(images)).toBe(true);
    expect(images).toHaveLength(1);
    expect(images[0].url).toBe('/api/og');
    expect(images[0].width).toBe(1200);
    expect(images[0].height).toBe(630);
  });

  it('appends ?v=<variant> to the OG image URL when ogVariant is given', () => {
    const md = buildMarketingMetadata({ ...BASE_INPUT, ogVariant: 'pricing' });
    const images = md.openGraph?.images as Array<{ url: string }>;
    expect(images[0].url).toBe('/api/og?v=pricing');
    // twitter image tracks the same variant
    expect(md.twitter?.images).toEqual(['/api/og?v=pricing']);
  });

  it('emits a complete openGraph object (url, siteName, type, locale, alternateLocale)', () => {
    const md = buildMarketingMetadata(BASE_INPUT);
    expect(md.openGraph).toMatchObject({
      title: BASE_INPUT.title,
      description: BASE_INPUT.description,
      url: 'https://alfanumrik.com/pricing',
      siteName: 'Alfanumrik',
      type: 'website',
      locale: 'en_IN',
      alternateLocale: ['hi_IN'],
    });
  });
});

describe('buildMarketingMetadata — twitter card + title strategy', () => {
  it('emits twitter summary_large_image card with title + description', () => {
    const md = buildMarketingMetadata(BASE_INPUT);
    expect(md.twitter).toMatchObject({
      card: 'summary_large_image',
      title: BASE_INPUT.title,
      description: BASE_INPUT.description,
    });
  });

  it('emits title as { absolute } so the root template cannot double-brand it', () => {
    const md = buildMarketingMetadata(BASE_INPUT);
    expect(md.title).toEqual({ absolute: BASE_INPUT.title });
  });
});

describe('buildMarketingMetadata — keywords must never be emitted per-page', () => {
  it('does not include a keywords field (site-wide keywords lives on root layout only)', () => {
    const md = buildMarketingMetadata({ ...BASE_INPUT, bilingual: true, ogVariant: 'pricing' });
    expect(md).not.toHaveProperty('keywords');
  });
});
