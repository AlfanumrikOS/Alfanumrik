import WelcomeV3 from '@alfanumrik/ui/landing/v3/WelcomeV3';

/**
 * /welcome — V3 (CEO-approved landing redesign, 2026-07) is the only render.
 *
 * The `?v=2` rollback escape hatch to the old WelcomeV2 page was retired
 * 2026-09-05 (CEO-approved) now that V3 is confirmed stable — `?v=2` falls
 * through to the default exactly like `?v=1` already did (legacy WelcomeV1
 * was deleted long before this). The underlying WelcomeV2 component,
 * WelcomeV2Context/Provider, and welcome-v2.module.css were deliberately
 * NOT deleted here: WelcomeV2Context/Provider is shared, load-bearing
 * infrastructure for the current V3 pages, /about, /for-parents, and the
 * site-wide AlfaBot widget (confirmed via a full importer sweep before this
 * change) despite its name — retiring/renaming that is a separate, much
 * larger refactor, not a route-hatch removal.
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
  // `?lang=hi|en` → real SSR language (SEO layer, 2026-07-16). The hreflang
  // hi-IN alternate points at ?lang=hi, so crawlers must receive Hindi HTML
  // from the server — not after hydration. Only a VALID explicit param is
  // threaded; no/unknown param keeps existing behavior (EN first paint +
  // localStorage hydration inside WelcomeV2Provider).
  const langParam = Array.isArray(params.lang) ? params.lang[0] : params.lang;
  const initialLang =
    langParam === 'hi' ? ('hi' as const) : langParam === 'en' ? ('en' as const) : undefined;
  return <WelcomeV3 initialLang={initialLang} />;
}
