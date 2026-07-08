/**
 * /api/feature-flags/check — Lightweight client-side feature flag probe.
 *
 * Why this exists:
 *   - Client components (e.g. the AlfaBot landing widget) need to silently
 *     decide whether to mount based on a server-side flag.
 *   - The full `isFeatureEnabled` is server-only and cannot be imported in
 *     a client component.
 *   - Existing /api/* routes that gate on a flag return 404 when off; that
 *     works for endpoints, but for a mount-time probe we want a tiny,
 *     cacheable GET that returns `{ enabled: boolean }` without leaking the
 *     full flag map.
 *
 * Contract:
 *   GET /api/feature-flags/check?flag=ff_alfabot_v1
 *     → 200 { enabled: boolean }      (always — even unknown flags return false)
 *     → 400 { error: 'invalid_flag' } (when ?flag= missing or has invalid chars)
 *
 *   We intentionally never 404 here — the response shape is stable so the
 *   caller can branch on `enabled` alone.
 *
 * Privacy / abuse posture:
 *   - No auth required; the flag map is public knowledge (visible in the
 *     super-admin console anyway).
 *   - We do NOT echo the flag name in any error message — defense against
 *     someone probing for flag names.
 *   - Cached for 60s on the edge (Vercel CDN) to keep it cheap.
 *
 * Owner: backend (per ops). Reviewer: frontend (consumer), architect (auth
 * boundary — confirms this is OK to expose anon).
 */

import { NextRequest, NextResponse } from 'next/server';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';

// Flag names are snake_case with `ff_` prefix per repo convention. Reject
// anything else as a defense against arbitrary string probing.
const FLAG_NAME_RE = /^[a-z][a-z0-9_]{2,63}$/;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const flag = request.nextUrl.searchParams.get('flag');
  if (!flag || !FLAG_NAME_RE.test(flag)) {
    return NextResponse.json({ error: 'invalid_flag' }, { status: 400 });
  }
  const enabled = await isFeatureEnabled(flag, {});
  return NextResponse.json(
    { enabled },
    {
      headers: {
        // Edge cache 60s; client revalidates on focus via SWR.
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    },
  );
}
