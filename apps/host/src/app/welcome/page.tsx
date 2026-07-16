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
  if (v === '2') return <WelcomeV2 />;
  return <WelcomeV3 />;
}
