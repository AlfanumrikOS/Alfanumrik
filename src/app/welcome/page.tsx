import { cookies } from 'next/headers';
import { isFeatureEnabled, WELCOME_FLAGS } from '@/lib/feature-flags';
import {
  ANON_ID_COOKIE,
  ANON_ID_MAX_AGE_SECONDS,
  generateAnonId,
} from '@/lib/anon-id';
import WelcomeV1 from './page-v1';
import WelcomeV2 from '@/components/landing-v2/WelcomeV2';

interface SearchParams {
  v?: string;
}

/**
 * `/welcome` server component — decides v1 vs v2 based on the
 * `ff_welcome_v2` feature flag and the `?v=` query string escape hatch.
 *
 * Decision matrix:
 *   ?v=2   → always v2 (QA preview, even when flag is off)
 *   ?v=1   → always v1 (rollback escape hatch)
 *   else   → flag.is_enabled + per-anon-id rollout %
 *
 * Anonymous-visitor stickiness: a long-lived `alf_anon_id` cookie (UUID v4)
 * is minted by middleware (src/proxy.ts → ensureAnonIdCookie, Layer 0.7) so
 * hashForRollout() in feature-flags.ts can deterministically sample anon
 * traffic (otherwise the existing fallback treats any rollout_percentage > 0
 * as 100% on for anon visitors and the canary breaks). This page reads that
 * cookie; the in-page mint below is defense-in-depth only.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams> | SearchParams;
}) {
  // In Next 15+/16, searchParams is a Promise; older versions pass it directly.
  const params: SearchParams = await Promise.resolve(searchParams);
  const force = params.v;

  // Force-on / force-off escape hatches
  if (force === '2') return <WelcomeV2 />;
  if (force === '1') return <WelcomeV1 />;

  // PRIMARY persistence path: src/proxy.ts middleware mints the alf_anon_id
  // cookie on the first matched request via ensureAnonIdCookie(). By the time
  // we reach this server component, request.cookies should already carry the
  // id. The block below is DEFENSE-IN-DEPTH for two narrow cases:
  //   1. The middleware matcher excludes the route (it doesn't today, but
  //      future config changes shouldn't silently break canary sampling).
  //   2. The middleware threw before reaching ensureAnonIdCookie().
  //
  // In a Server Component, cookies().set() is a no-op (only Route Handlers,
  // Server Actions, and Middleware can mutate cookies). So this block:
  //   - Always generates a transient id for THIS request's flag evaluation
  //     so rollout sampling stays deterministic, and
  //   - Best-effort calls set() in case a future Next version makes it work,
  //     wrapped in try/catch to avoid throwing the page.
  const cookieStore = await cookies();
  let anonId = cookieStore.get(ANON_ID_COOKIE)?.value;

  if (!anonId) {
    anonId = generateAnonId();
    // `cookies().set()` is allowed in Server Actions / Route Handlers /
    // Middleware. In a Server Component it throws / no-ops. Wrap in try/catch
    // so the page still renders. Persistence is owned by middleware
    // (src/proxy.ts → ensureAnonIdCookie); this is a safety net only.
    try {
      // set() exists at runtime in mutable contexts (route handlers,
      // server actions, middleware) but not in pure server components.
      // The optional-chained call avoids a TypeError in that case.
      (cookieStore as unknown as { set?: (opts: object) => void }).set?.({
        name: ANON_ID_COOKIE,
        value: anonId,
        httpOnly: false,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: ANON_ID_MAX_AGE_SECONDS,
        path: '/',
      });
    } catch {
      // Server Component context — cookie set is a no-op. The flag is still
      // evaluated deterministically against the freshly-generated id for
      // this single request. Persistence across requests is handled by the
      // middleware in src/proxy.ts (Layer 0.7, ensureAnonIdCookie).
    }
  }

  const useV2 = await isFeatureEnabled(WELCOME_FLAGS.WELCOME_V2, {
    userId: anonId,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });

  return useV2 ? <WelcomeV2 /> : <WelcomeV1 />;
}
