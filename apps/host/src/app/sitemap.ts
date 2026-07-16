import { MetadataRoute } from 'next';

/**
 * Maintained content date for every sitemap entry (SEO layer, 2026-07-16).
 *
 * Previously each entry used `new Date()`, which stamped every URL as
 * "modified now" on every request — a false freshness signal that teaches
 * crawlers to distrust the field. Bump this constant when marketing/legal
 * content meaningfully changes.
 */
const LAST_MODIFIED = new Date('2026-07-16');

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://alfanumrik.com';

  // NOTE (SEO layer, 2026-07-16): the former "App pages" block (/dashboard,
  // /foxy, /leaderboard, /progress, /exams, /scan, /stem-centre) was removed.
  // Each page was verified to redirect unauthenticated visitors to /login
  // (client-side AuthContext gate — see proxy.ts STUDENT_PROTECTED comment),
  // so crawlers can never index real content there; listing them only burned
  // crawl budget and produced soft-404 signals. They are also disallowed in
  // public/robots.txt.
  //
  // The bare https://alfanumrik.com/ root entry stays intentionally ABSENT
  // (root redirects to /welcome — duplicate-content signal; pinned by
  // e2e/landing-seo.spec.ts).
  return [
    // Public / marketing pages (highest SEO value)
    { url: `${baseUrl}/welcome`, lastModified: LAST_MODIFIED, changeFrequency: 'weekly', priority: 1 },
    { url: `${baseUrl}/product`, lastModified: LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${baseUrl}/pricing`, lastModified: LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${baseUrl}/for-schools`, lastModified: LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/for-parents`, lastModified: LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/for-teachers`, lastModified: LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/demo`, lastModified: LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/about`, lastModified: LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/careers`, lastModified: LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${baseUrl}/contact`, lastModified: LAST_MODIFIED, changeFrequency: 'yearly', priority: 0.6 },
    { url: `${baseUrl}/press`, lastModified: LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/help`, lastModified: LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.5 },

    // Research & methodology (public SEO page)
    { url: `${baseUrl}/research`, lastModified: LAST_MODIFIED, changeFrequency: 'monthly', priority: 0.7 },

    // Legal / policy pages
    { url: `${baseUrl}/privacy`, lastModified: LAST_MODIFIED, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/refunds`, lastModified: LAST_MODIFIED, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified: LAST_MODIFIED, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/security`, lastModified: LAST_MODIFIED, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
