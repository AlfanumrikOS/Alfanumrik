/**
 * Phase 3B — School Command Center (Wave A): user-context client + school
 * resolution for the three read-only RPC routes.
 *
 * ─── Why a user-context client (NOT supabase-admin) ──────────────────────────
 * The three read models (get_school_overview / get_classes_at_risk /
 * get_teacher_engagement) are SECURITY DEFINER and enforce school-scope
 * INTERNALLY via `school_admins.auth_user_id = auth.uid()`. For `auth.uid()` to
 * resolve, the RPC MUST be invoked through a client that carries the caller's
 * session/JWT. The service-role client (`@/lib/supabase-admin`) has NO
 * `auth.uid()`, so the in-RPC guard would raise 42501 for every request.
 *
 * This builds the same dual-credential client the platform already uses for
 * authed read routes (cookies for web SWR; Bearer passthrough for mobile),
 * mirroring `authorizeRequest`'s token resolution in `src/lib/rbac.ts:383-419`
 * and the user-context RPC pattern in `src/app/api/dive/state/route.ts:92-99` /
 * `src/app/api/payments/status/route.ts:23-37`.
 *
 * ─── School resolution (server-side, never trust client) ─────────────────────
 * Resolve the caller's active school_admin membership(s) THROUGH the
 * user-context client (RLS policy "School admins can view own record":
 * `auth_user_id = auth.uid()` — baseline). An optional `?school_id=` is honored
 * ONLY when it matches one of the caller's active memberships, else 403.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authorizeRequest } from '@/lib/rbac';
import { logger } from '@/lib/logger';

/** Permission gating all Command Center read routes (P9). Wave A reuses the */
/** existing INSTITUTION_VIEW_ANALYTICS — no new permission is added here. */
export const COMMAND_CENTER_PERMISSION = 'institution.view_analytics';

/** Standard cache header for authed read routes (platform convention). */
export const COMMAND_CENTER_CACHE_CONTROL =
  'private, max-age=30, stale-while-revalidate=60';

/**
 * Cache header for the Wave D reporting read routes. Reports change slowly (they
 * aggregate across a whole school's roster), so a longer TTL than the live
 * Command Center surfaces is appropriate. Stays `private` (per-caller, never a
 * shared/CDN cache) so no cross-tenant data is ever cached publicly (P13).
 */
export const COMMAND_CENTER_REPORTS_CACHE_CONTROL =
  'private, max-age=60, stale-while-revalidate=120';

export interface CommandCenterContext {
  /** User-context Supabase client (carries caller JWT → auth.uid() resolves). */
  supabase: SupabaseClient;
  /** The resolved, validated school the caller administers. */
  schoolId: string;
  /** The caller's auth user id. */
  userId: string;
}

export type CommandCenterResolution =
  | { ok: true; ctx: CommandCenterContext }
  | { ok: false; response: NextResponse };

/**
 * Build a user-context Supabase client that resolves `auth.uid()` for the
 * caller. Prefers cookies (web SWR); if an `Authorization: Bearer` header is
 * present (mobile), it is passed through so the RPC's PostgREST request carries
 * the JWT. This is the SAME credential surface `authorizeRequest` accepts.
 */
function buildUserContextClient(request: NextRequest): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const authHeader = request.headers.get('Authorization');
  const global =
    authHeader?.startsWith('Bearer ')
      ? { global: { headers: { Authorization: authHeader } } }
      : {};

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll() {
        // Read-only routes never mutate the session cookie.
      },
    },
    ...global,
  }) as unknown as SupabaseClient;
}

function forbidden(message: string): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status: 403 });
}

/**
 * Authorize + resolve the Command Center context for a read route.
 *
 * Order:
 *   1. P9 RBAC gate via authorizeRequest(institution.view_analytics).
 *      On failure, returns its 401/403 response UNCHANGED.
 *   2. Build the user-context client (so the SECURITY DEFINER RPC sees auth.uid()).
 *   3. Resolve active school_admin membership(s) for the caller via that client.
 *   4. Apply optional ?school_id (must match an active membership, else 403).
 *
 * The returned `supabase` client is the one routes MUST use to call the RPC.
 */
export async function resolveCommandCenterContext(
  request: NextRequest,
  routeName: string,
): Promise<CommandCenterResolution> {
  // 1. P9: permission gate. Reuse the platform RBAC path; pass through its
  //    error response verbatim so 401/403 semantics stay identical to peers.
  const auth = await authorizeRequest(request, COMMAND_CENTER_PERMISSION);
  if (!auth.authorized) {
    return { ok: false, response: auth.errorResponse as unknown as NextResponse };
  }
  const userId = auth.userId!;

  // 2. User-context client — REQUIRED for auth.uid() inside the RPC.
  let supabase: SupabaseClient;
  try {
    supabase = buildUserContextClient(request);
  } catch (err) {
    logger.error('command_center_client_build_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: routeName,
    });
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Service unavailable' },
        { status: 503 },
      ),
    };
  }

  // 3. Resolve active memberships THROUGH the user-context client (RLS-scoped
  //    to the caller's own rows). We never accept a school_id from the body.
  const { data: memberships, error: membershipErr } = await supabase
    .from('school_admins')
    .select('school_id')
    .eq('is_active', true);

  if (membershipErr) {
    // Don't leak SQL to the client (P13). Log server-side via redacting logger.
    logger.error('command_center_membership_lookup_failed', {
      error: new Error(membershipErr.message),
      route: routeName,
    });
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Failed to verify school admin status' },
        { status: 500 },
      ),
    };
  }

  const activeSchoolIds = Array.from(
    new Set(
      (memberships ?? [])
        .map((m) => (m as { school_id: string | null }).school_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );

  if (activeSchoolIds.length === 0) {
    return { ok: false, response: forbidden('Not an active school administrator') };
  }

  // 4. Optional ?school_id — honored only if it is one of the caller's active
  //    memberships. Any other value (incl. another school's id) → 403.
  const requested = new URL(request.url).searchParams.get('school_id')?.trim();
  let schoolId: string;
  if (requested) {
    if (!activeSchoolIds.includes(requested)) {
      return { ok: false, response: forbidden('school_id is not one of your active schools') };
    }
    schoolId = requested;
  } else if (activeSchoolIds.length === 1) {
    schoolId = activeSchoolIds[0];
  } else {
    // Multiple memberships and no explicit selection — require disambiguation
    // rather than guessing. The defense-in-depth RPC guard would also reject a
    // wrong pick, but a clear 400 is the better contract.
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: 'Multiple schools — specify ?school_id',
          school_ids: activeSchoolIds,
        },
        { status: 400 },
      ),
    };
  }

  return { ok: true, ctx: { supabase, schoolId, userId } };
}

/**
 * Map an RPC error to an HTTP response without leaking SQL.
 * - Postgres 42501 (raised by the in-RPC scope guard) → 403.
 * - Anything else → 500, logged server-side via the redacting logger (P13).
 */
export function rpcErrorResponse(
  err: { code?: string; message?: string } | null,
  routeName: string,
): NextResponse {
  if (err?.code === '42501') {
    return forbidden('Not authorized for this school');
  }
  logger.error('command_center_rpc_failed', {
    error: new Error(err?.message ?? 'RPC failed'),
    route: routeName,
  });
  return NextResponse.json(
    { success: false, error: 'Internal server error' },
    { status: 500 },
  );
}

/**
 * Parse + clamp ?limit (default 20, 1..100) and ?offset (default 0, min 0).
 * Mirrors the RPC's own internal clamp so the wire echo matches what SQL applied.
 */
export function parsePagination(
  request: NextRequest,
  defaultLimit: number,
  maxLimit: number,
): { limit: number; offset: number } {
  const params = new URL(request.url).searchParams;

  const rawLimit = parseInt(params.get('limit') ?? '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(maxLimit, Math.max(1, rawLimit))
    : defaultLimit;

  const rawOffset = parseInt(params.get('offset') ?? '', 10);
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  return { limit, offset };
}
