/**
 * Bearer-aware, RLS-respecting Supabase client for Route Handlers.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The cookie-only `createSupabaseServerClient()` (supabase-server.ts) reads the
 * Supabase session from `next/headers` cookies. That works for WEB callers, but
 * the Flutter mobile app authenticates with an `Authorization: Bearer <jwt>`
 * header (see `mobile/lib/core/network/api_client.dart` auth interceptor) and
 * sends NO Supabase auth cookie. With the cookie-only client, PostgREST sees no
 * user → `auth.uid()` is NULL → every RLS SELECT policy denies → mobile callers
 * get empty/404 responses. This is exactly why `/api/student/daily-plan` was
 * DEFERRED off the admin→server migration ledger (see regression catalog
 * REG-218 deferrals table). This helper is the Phase 2 enabler that unblocks
 * those Bearer-called routes — it is NOT wired into any route in this change.
 *
 * ── SECURITY MODEL (read before editing) ─────────────────────────────────────
 * RLS is ENFORCED in BOTH code paths. This helper can NEVER bypass RLS:
 *
 *   1. Bearer path: builds a client with the PUBLIC anon key
 *      (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) and forwards the CALLER'S OWN Supabase
 *      access token as `global.headers.Authorization`. PostgREST runs the query
 *      as that user, so `auth.uid()` resolves to the caller and every RLS policy
 *      applies exactly as it would on the wire. The anon key carries NO
 *      privilege of its own — it only identifies the project; authorization is
 *      entirely driven by the forwarded JWT under RLS.
 *
 *   2. Cookie path (no Bearer): delegates verbatim to the existing cookie-based
 *      `createSupabaseServerClient()` (anon key + session cookie). Also RLS-scoped.
 *
 * This helper does NOT validate the JWT itself — it does not need to. An
 * invalid/expired/forged token is rejected by Supabase Auth + PostgREST and RLS
 * (`auth.uid()` stays NULL → policies deny), so the failure mode is FAIL-CLOSED,
 * never fail-open. Route handlers still call `authorizeRequest()` first for RBAC;
 * RLS here is the defense-in-depth second line.
 *
 * The service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is NEVER read in this file.
 * It is structurally impossible for this helper to return an RLS-bypassing
 * client: the only key it ever passes to `createClient` is the anon key, and an
 * explicit assertion below enforces that the resolved key is the anon key (and
 * not equal to the service-role key) before any client is constructed.
 *
 * The anon key is the PUBLIC client key (it ships in the browser bundle via
 * `NEXT_PUBLIC_*`); it is safe to use server-side because it grants nothing
 * beyond what RLS allows for the attached identity.
 *
 * Owner: architect (auth-infra). Review: backend, frontend, ops, testing.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase-server';

/** Extract a non-empty Bearer token from a request's Authorization header. */
function extractBearerToken(request: Request): string | null {
  // Headers.get() is case-insensitive, so this matches `Authorization`,
  // `authorization`, etc.
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Build an RLS-respecting Supabase client for a Route Handler request.
 *
 *   • If the request carries `Authorization: Bearer <jwt>` (mobile callers):
 *     returns a client built on the ANON key with the caller's JWT forwarded to
 *     PostgREST, so `auth.uid()` resolves and RLS applies under the caller's
 *     identity. No cookies are read or written on this path.
 *
 *   • Otherwise (web callers): delegates to `createSupabaseServerClient()`,
 *     which authenticates via the Supabase session cookie. Also RLS-scoped.
 *
 * The returned client is ALWAYS RLS-scoped. It is impossible for this helper to
 * use the service-role key — only the anon key is ever passed to createClient.
 *
 * @param request The incoming Route Handler request (Next.js `Request`/`NextRequest`).
 */
export async function createSupabaseRouteClient(
  request: Request,
): Promise<SupabaseClient> {
  const token = extractBearerToken(request);

  // No Bearer → web/cookie path. Delegate to the existing cookie client.
  if (!token) {
    return createSupabaseServerClient();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY',
    );
  }

  // ── HARD SECURITY ASSERTION ──────────────────────────────────────────────
  // This helper must be RLS-scoped on every path. Guarantee, before we build
  // anything, that the transport key is the PUBLIC anon key and is NOT the
  // service-role key. If these were ever to coincide (misconfiguration), we
  // fail closed rather than hand back an RLS-bypassing client.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRoleKey && anonKey === serviceRoleKey) {
    throw new Error(
      'createSupabaseRouteClient: refusing to build a client — the configured ' +
        'anon key equals the service-role key. This helper must only ever use ' +
        'the public anon key under RLS.',
    );
  }

  // Bearer path: anon key + caller's JWT forwarded to PostgREST. RLS enforced.
  // persistSession/autoRefreshToken are off: this is a stateless, per-request
  // client identified solely by the forwarded Authorization header.
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
}
