import WelcomeV2 from '@alfanumrik/ui/landing/WelcomeV2';
import WelcomeV3 from '@alfanumrik/ui/landing/v3/WelcomeV3';

/**
 * /welcome — V3 (CEO-approved landing redesign, 2026-07) is the DEFAULT render.
 *
 * Rollback escape hatch: `?v=2` renders the previous WelcomeV2, which stays
 * fully wired until a later cleanup PR removes it. (`?v=1` has no target —
 * legacy WelcomeV1 was deleted long ago — so it falls through to the default
 * like any other value.)
 *
 * Server component: async only because Next.js 16 delivers `searchParams` as
 * a Promise. No flag/bucketing logic — the version switch is the query param.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const v = Array.isArray(params.v) ? params.v[0] : params.v;
  // `?lang=hi|en` → real SSR language (SEO layer, 2026-07-16). The hreflang
  // hi-IN alternate points at ?lang=hi, so crawlers must receive Hindi HTML
  // from the server — not after hydration. Only a VALID explicit param is
  // threaded; no/unknown param keeps existing behavior (EN first paint +
  // localStorage hydration inside WelcomeV2Provider).
  const langParam = Array.isArray(params.lang) ? params.lang[0] : params.lang;
  const initialLang =
    langParam === 'hi' ? ('hi' as const) : langParam === 'en' ? ('en' as const) : undefined;
  if (v === '2') return <WelcomeV2 />;
  return <WelcomeV3 initialLang={initialLang} />;
}
