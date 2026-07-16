import type { Metadata } from 'next';

/**
 * marketing-metadata — single builder for every public/marketing page's
 * <head> metadata (landing v3 SEO layer, 2026-07-16).
 *
 * Why this exists:
 *  - BUG FIX: Next.js metadata merging is SHALLOW per top-level key. A child
 *    segment that exports `openGraph: { title, url }` REPLACES the root
 *    layout's entire openGraph object — silently dropping og:image on every
 *    marketing page that customised its OG copy. This builder therefore
 *    ALWAYS emits a complete openGraph object including `images`.
 *  - hreflang trio format is pinned by e2e/landing-seo.spec.ts
 *    ("emits hreflang link tags for en-IN, hi-IN, and x-default"):
 *      en-IN     → canonical URL
 *      hi-IN     → canonical URL + `?lang=hi`
 *      x-default → canonical URL
 *  - `keywords` is deliberately NOT emitted here. The e2e suite pins exactly
 *    ONE keywords meta site-wide (emitted by the root layout); per-page
 *    keywords would duplicate it (landing-seo.spec.ts "keywords meta tag is
 *    not duplicated on /welcome").
 *  - `title` is emitted as `{ absolute }` so the root layout's
 *    `%s | Alfanumrik` template does not double-brand titles that already
 *    carry the brand (e.g. "… — Alfanumrik | Alfanumrik").
 */

export const MARKETING_BASE_URL = 'https://alfanumrik.com';

/** OG image variants served by /api/og?v=… (see src/app/api/og/route.tsx). */
export type OgVariant = 'default' | 'product' | 'pricing' | 'parents' | 'teachers' | 'schools';

export interface MarketingMetadataInput {
  /** Route path starting with '/', e.g. '/welcome'. */
  path: string;
  /** Full page title (used verbatim — no root template suffix). */
  title: string;
  /** Meta description. Target 150–160 chars: CBSE/NCERT/Class 6–12 + differentiator + CTA. */
  description: string;
  /** Optional OG image variant; omitted → the default /api/og image. */
  ogVariant?: OgVariant;
  /** Emit the en-IN / hi-IN / x-default hreflang trio (bilingual marketing pages only). */
  bilingual?: boolean;
}

export function buildMarketingMetadata({
  path,
  title,
  description,
  ogVariant,
  bilingual,
}: MarketingMetadataInput): Metadata {
  const url = `${MARKETING_BASE_URL}${path}`;
  const ogImage = '/api/og' + (ogVariant ? `?v=${ogVariant}` : '');

  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: url,
      ...(bilingual
        ? {
            languages: {
              'en-IN': url,
              'hi-IN': `${url}?lang=hi`,
              'x-default': url,
            },
          }
        : {}),
    },
    openGraph: {
      title,
      description,
      url,
      siteName: 'Alfanumrik',
      type: 'website',
      locale: 'en_IN',
      alternateLocale: ['hi_IN'],
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: title,
          type: 'image/png',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  };
}
