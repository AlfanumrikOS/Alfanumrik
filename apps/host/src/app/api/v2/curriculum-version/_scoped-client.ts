/**
 * RLS-SCOPED Supabase client for GET /api/v2/curriculum-version.
 *
 * WHY THIS EXISTS (P8 — the admin-client footprint is FROZEN)
 * ==========================================================
 * This route originally used the RLS-BYPASSING service-role client
 * (`@alfanumrik/lib/supabase-admin`), mirroring the grandfathered sibling
 * `/api/v2/learn/curriculum`. `api-admin-client-allowlist.test.ts` correctly
 * rejected that: the 273-route admin footprint may only RATCHET DOWN, and this
 * route provably does not need service-role rights —
 *
 *   1. The grade lookup reads the caller's OWN `students` row, which the
 *      baseline policy `students_select_merged` already permits:
 *        USING (auth_user_id = auth.uid() OR is_teacher_of(id) OR is_guardian_of(id))
 *   2. `get_curriculum_versions` is `SECURITY DEFINER` and is GRANTed EXECUTE to
 *      `authenticated` (migration 20260717120000). Definer rights let it read the
 *      service_role-only `curriculum_version_watermark` table on the caller's
 *      behalf, so an RLS-scoped caller gets the identical answer.
 *
 * So RLS costs nothing here and buys a real second line of defense behind
 * `authorizeRequest` (P8/P9 defense-in-depth).
 *
 * WHY NOT `createSupabaseServerClient()` FROM `@alfanumrik/lib/supabase-server`
 * ============================================================================
 * That helper is COOKIE-ONLY (it reads `cookies()` and never forwards an
 * `Authorization` header). This endpoint is polled by the Flutter app, whose v2
 * client authenticates with a bearer token and sends NO cookies
 * (`mobile/lib/core/network/v2_api_client.dart` → `setBearerAuth('bearerAuth', …)`;
 * the contract is documented in `src/app/api/v2/README.md`). Under a cookie-only
 * client every mobile caller would resolve to `auth.uid() = NULL`, fail the RLS
 * self-read, and silently degrade to `{ scopes: {} }` FOREVER — the poll would
 * never detect stale content, and it would fail SILENTLY (HTTP 200), because the
 * route is deliberately built never to 5xx.
 *
 * So we build the same RLS-scoped anon client, but transport-agnostic: forward
 * the bearer token when present, else fall back to cookies. This mirrors the
 * established `apps/host/src/app/api/parent/notifications/_scoped-client.ts`
 * pattern (and 8+ parent routes).
 *
 * PRECEDENCE: bearer-then-cookie, matching `authorizeRequest`'s own resolution
 * order (`packages/lib/src/rbac.ts` — bearer first, cookie fallback). Keeping the
 * two in the same order guarantees the RLS identity is the SAME principal that
 * RBAC authorized; a mismatch could otherwise authorize user A and read as user B.
 *
 * NOTE: no `supabase-admin` import here, by construction. The allowlist gate only
 * scans `route.ts`, so a helper is NOT a place to smuggle service-role rights back
 * in — this file uses the anon key and is subject to RLS like any client.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

export async function createCurriculumVersionClient(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const authHeader = request.headers.get('Authorization');
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // A version poll is a pure read — it never mutates auth cookies.
      },
    },
    // Bearer (mobile) wins over cookies (web) when both are present, matching
    // authorizeRequest's precedence so RBAC and RLS resolve the same principal.
    ...(authHeader ? { global: { headers: { Authorization: authHeader } } } : {}),
  });
}
