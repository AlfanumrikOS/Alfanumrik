/**
 * Public API v1 — Key Authentication & Tenant-Scoping Boundary
 * ============================================================================
 * Track A.6 (white-label school SaaS public API). This is a REAL security
 * boundary, equivalent in weight to RBAC `authorizeRequest()` (P9): a LEAKED key
 * must expose ONLY the issuing school's data, at the granted scope, and NEVER
 * any other tenant's data. Tenant isolation is non-negotiable.
 *
 * ── THE /api/public/v1/* CONTRACT (every public endpoint MUST follow this) ────
 *   1. AUTHENTICATE with this helper — `authorizePublicApiKey(request, scope)` —
 *      as the FIRST thing in the handler, before any DB I/O. If
 *      `result.authorized` is false, immediately `return result.errorResponse`.
 *   2. DERIVE the tenant from the KEY, never from the request. Use
 *      `result.schoolId` for EVERY query's `.eq('school_id', result.schoolId)`.
 *      NEVER read a school_id / tenant id from the path, query string, or body.
 *      A request that names a school_id is IGNORED — the key is the only source
 *      of tenant truth. (This closes the cross-tenant vector: a key for school A
 *      can never be tricked into returning school B's rows.)
 *   3. SCOPE-GATE with the `requiredScope` argument: the helper already verified
 *      the key carries that scope; the route just declares which scope it needs.
 *   4. RATE-LIMIT is enforced INSIDE this helper, keyed by the API key id (never
 *      by IP) — a 429 is returned as `errorResponse` when the per-key budget is
 *      exhausted. Every response (including 429) carries the standard
 *      `X-RateLimit-*` headers; the helper exposes `rateLimitHeaders` so success
 *      responses attach them too.
 *   5. RETURN stable, versioned shapes. `v1` field shapes do not change in place;
 *      additive-only. PII exposure is forbidden by P13 (e.g. student email is
 *      never returned through the public API).
 *
 * ── WHY school_api_keys (not a new table) ─────────────────────────────────────
 *   The baseline `school_api_keys` table already models exactly what a public-API
 *   key needs: a SHA-256 `key_hash` (raw key never stored), a TEXT[] scope column
 *   (`permissions`), `expires_at`, `is_active`, and a NOT NULL `school_id` FK with
 *   own-school RLS. Track A.6 reuses it as-is — no new key table, no new columns.
 *   The scope vocabulary is the same `permissions` strings already issued by
 *   POST /api/school-admin/api-keys (e.g. 'students.read', 'reports.read').
 *
 * ── HASHING / PII (P13) ───────────────────────────────────────────────────────
 *   Keys are compared by SHA-256 HASH only — the raw key is never stored and is
 *   never logged. On any failure we log a generic reason + the key PREFIX at most
 *   (never the full key, never PII). The raw key exists only transiently in this
 *   function's local scope for the duration of the hash.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { checkApiRateLimit } from '@alfanumrik/lib/api-rate-limit';
import { logger } from '@alfanumrik/lib/logger';

// ── Constants ────────────────────────────────────────────────
/** Per-key request budget per window (mirrors api-rate-limit default). */
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

// ── Types ────────────────────────────────────────────────────

/** Standard rate-limit headers attached to EVERY public-API response. */
export type RateLimitHeaders = Record<
  'X-RateLimit-Limit' | 'X-RateLimit-Remaining' | 'X-RateLimit-Reset',
  string
>;

export interface PublicApiAuthResult {
  /** True only when the key is valid, active, unexpired, scope-granted, and under rate limit. */
  authorized: boolean;
  /**
   * The school this key belongs to — the ONLY source of tenant truth. Every query
   * in the route MUST scope to this value. Null when not authorized.
   */
  schoolId: string | null;
  /** All scopes granted to this key (the key's `permissions` array). */
  scopes: string[];
  /** The API key record id (used as the rate-limit bucket + for audit). Null when not authorized. */
  keyId: string | null;
  /**
   * Standard rate-limit headers to attach to the SUCCESS response (the helper has
   * already attached them to any error response it builds). Present on both the
   * authorized and the 429 path; empty on auth failures that never reached the
   * limiter.
   */
  rateLimitHeaders: Partial<RateLimitHeaders>;
  /** Pre-built error response to return as-is when `authorized` is false. */
  errorResponse?: Response;
}

// ── Helpers ──────────────────────────────────────────────────

/** SHA-256 hex of a value (Edge + Node compatible via Web Crypto). */
async function sha256Hex(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Extract the raw key from either header form:
 *   Authorization: Bearer <key>   (preferred)
 *   x-api-key: <key>              (convenience)
 * Returns null if neither is present / non-empty.
 */
function extractKey(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (authHeader) {
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (m && m[1].trim()) return m[1].trim();
  }
  const xApiKey = request.headers.get('x-api-key');
  if (xApiKey && xApiKey.trim()) return xApiKey.trim();
  return null;
}

/** Build a JSON error Response with optional rate-limit headers. */
function errorJson(
  status: number,
  error: string,
  extraHeaders?: Record<string, string>,
): Response {
  return NextResponse.json({ success: false, error }, { status, headers: extraHeaders });
}

// ── Main boundary ────────────────────────────────────────────

/**
 * Authenticate + tenant-scope + scope-gate + rate-limit a public-API v1 request.
 *
 * @param request       Incoming request (reads Authorization / x-api-key headers).
 * @param requiredScope The scope this endpoint requires (e.g. 'students.read').
 *                      Pass null/'' ONLY for a scope-agnostic endpoint (rare).
 * @returns {@link PublicApiAuthResult}. On failure, return `errorResponse` as-is.
 *
 * Tenant-isolation guarantee: the returned `schoolId` is read from the key
 * record, NEVER from request input. The caller must scope all queries to it.
 */
export async function authorizePublicApiKey(
  request: Request,
  requiredScope: string | null,
): Promise<PublicApiAuthResult> {
  const deny = (
    status: number,
    error: string,
    headers?: Record<string, string>,
  ): PublicApiAuthResult => ({
    authorized: false,
    schoolId: null,
    scopes: [],
    keyId: null,
    rateLimitHeaders: {},
    errorResponse: errorJson(status, error, headers),
  });

  // 1. Extract the key (no key → 401, generic message; never echo the input).
  const rawKey = extractKey(request);
  if (!rawKey) {
    return deny(401, 'Missing API key. Provide it as `Authorization: Bearer <key>` or `x-api-key`.');
  }

  let keyHash: string;
  try {
    keyHash = await sha256Hex(rawKey);
  } catch (err) {
    logger.error('public_api_key_hash_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return deny(500, 'Internal authentication error');
  }

  // 2. Look up by HASH. RLS is bypassed here intentionally (service role) because
  //    the key itself IS the credential; the lookup is constrained to the exact
  //    hash + active flag, so it can only ever match the one issuing school.
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('school_api_keys')
    .select('id, school_id, permissions, expires_at, is_active')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    logger.error('public_api_key_lookup_failed', { error: new Error(error.message) });
    return deny(500, 'Internal authentication error');
  }

  // Invalid key → 401. Identical generic message for not-found vs expired vs
  // inactive so the boundary does not leak which keys exist.
  if (!data) {
    return deny(401, 'Invalid or expired API key');
  }

  // 3. Expiry check.
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return deny(401, 'Invalid or expired API key');
  }

  const keyId: string = data.id;
  const schoolId: string = data.school_id;
  const scopes: string[] = Array.isArray(data.permissions) ? data.permissions : [];

  // 4. Rate limit BEFORE scope-gating so a scoped-out caller still can't hammer
  //    the lookup for free. Bucket is keyed by the API key id (never IP).
  const rl = await checkApiRateLimit(keyId, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  const rateLimitHeaders: RateLimitHeaders = {
    'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
    'X-RateLimit-Remaining': String(Math.max(0, rl.remaining)),
    'X-RateLimit-Reset': String(rl.resetAt),
  };

  if (!rl.allowed) {
    const retryAfter = Math.max(1, rl.resetAt - Math.ceil(Date.now() / 1000));
    return {
      authorized: false,
      schoolId: null,
      scopes: [],
      keyId,
      rateLimitHeaders,
      errorResponse: errorJson(429, 'Rate limit exceeded', {
        'Retry-After': String(retryAfter),
        ...rateLimitHeaders,
      }),
    };
  }

  // 5. Scope gate. The key must carry the required scope. 403 (authenticated but
  //    not permitted) — distinct from the 401 invalid-key path.
  if (requiredScope && !scopes.includes(requiredScope)) {
    return {
      authorized: false,
      schoolId: null,
      scopes: [],
      keyId,
      rateLimitHeaders,
      errorResponse: errorJson(
        403,
        `API key does not have the required scope: ${requiredScope}`,
        rateLimitHeaders,
      ),
    };
  }

  // 6. Best-effort last_used_at touch (fire-and-forget; never blocks/raises).
  void supabase
    .from('school_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyId)
    .then(
      () => {},
      () => {},
    );

  return {
    authorized: true,
    schoolId,
    scopes,
    keyId,
    rateLimitHeaders,
  };
}
