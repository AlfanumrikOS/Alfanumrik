/**
 * Admin authentication helper — server-side and client-side utilities.
 *
 * Security model:
 *  - Server routes: check `x-admin-secret` request header ONLY (never URL params).
 *  - Client: stores the secret in sessionStorage (cleared on tab close), never in the URL.
 *  - All admin actions are logged to admin_audit_log via logAdminAction().
 *
 * Also exports original session-based admin auth (authorizeAdmin) used by /api/super-admin/* routes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@alfanumrik/lib/logger';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { secureEqual } from '@alfanumrik/lib/secure-compare';

// ─── Types ────────────────────────────────────────────────────

/**
 * Phase G.1 (2026-05-17): typed admin level hierarchy. Each level grants every
 * permission of the levels below it. `support` is the floor — the lowest level
 * an `admin_users` row can hold and still pass `authorizeAdmin`. Routes declare
 * their minimum via `authorizeAdmin(request, 'super_admin')` etc.
 *
 * The order of values in this array IS the precedence (lowest → highest).
 * Adding a new level: insert it at the right precedence and add to the rank map.
 */
export const ADMIN_LEVELS = [
  'support',
  'analyst',
  'content_manager',
  'finance',
  'admin',
  'super_admin',
] as const;
export type AdminLevel = (typeof ADMIN_LEVELS)[number];

const LEVEL_RANK: Record<AdminLevel, number> = {
  support: 0,
  analyst: 1,
  content_manager: 2,
  finance: 3,
  admin: 4,
  super_admin: 5,
};

export function hasMinimumLevel(have: string | null | undefined, need: AdminLevel): boolean {
  if (!have) return false;
  if (!(have in LEVEL_RANK)) return false;
  return LEVEL_RANK[have as AdminLevel] >= LEVEL_RANK[need];
}

/**
 * Capability permissions projected by the V3 operator shell from the verified
 * `admin_users.admin_level`. These are deliberately narrower than API access:
 * APIs continue to enforce their own required admin level and RBAC permission.
 */
export function adminExperiencePermissions(level: string | null | undefined): readonly string[] {
  if (!level || !(level in LEVEL_RANK)) return [];
  const permissions = ['system.audit'];
  if (hasMinimumLevel(level, 'finance')) permissions.push('finance.view_revenue');
  if (hasMinimumLevel(level, 'admin')) permissions.push('role.manage');
  if (hasMinimumLevel(level, 'super_admin')) permissions.push('system.config');
  return permissions;
}

export interface AdminAuth {
  authorized: true;
  userId: string;
  adminId: string;
  email: string;
  name: string;
  adminLevel: AdminLevel | string;
}

export interface AdminAuthFailure {
  authorized: false;
  response: NextResponse;
}

export type AdminAuthResult = AdminAuth | AdminAuthFailure;

// ─── Internal helpers ─────────────────────────────────────────

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url: url || null, key: key || null };
}

// ─── Session-based admin auth (used by /api/super-admin/* routes) ─────────────

/**
 * Matches the @supabase/ssr session cookie name, unchunked
 * (`sb-<ref>-auth-token`) or chunked (`sb-<ref>-auth-token.0`, `.1`, ...).
 * Anchored so `sb-<ref>-auth-token-code-verifier` (PKCE verifier, not a
 * session) can never match.
 */
const AUTH_TOKEN_COOKIE_RE = /^(sb-.+-auth-token)(?:\.(\d+))?$/;

const BASE64_COOKIE_PREFIX = 'base64-';

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // not URI-encoded (e.g. raw base64url payload) — use as-is
  }
}

/** Decode a base64url (RFC 4648 §5, unpadded) string to UTF-8, or null. */
function base64UrlToUtf8(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(padded, 'base64').toString('utf-8');
    }
    // Edge-runtime fallback (no Buffer): atob + TextDecoder.
    const binary = atob(padded);
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/**
 * Given a reassembled cookie payload, return the session's access_token.
 * Handles the @supabase/ssr >= 0.4 `base64-<base64url(json)>` encoding
 * (the DEFAULT `cookieEncoding: 'base64url'` in v0.12 — what production
 * writes), plain-JSON payloads, and legacy auth-helpers array shapes.
 */
function accessTokenFromSessionPayload(raw: string): string | null {
  let payload = raw;
  if (payload.startsWith(BASE64_COOKIE_PREFIX)) {
    const decoded = base64UrlToUtf8(payload.slice(BASE64_COOKIE_PREFIX.length));
    if (decoded === null) return null;
    payload = decoded;
  }
  try {
    const parsed = JSON.parse(payload);
    if (typeof parsed?.access_token === 'string') return parsed.access_token;
    // Legacy @supabase/auth-helpers shapes.
    if (typeof parsed?.[0]?.access_token === 'string') return parsed[0].access_token;
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && parsed[0].split('.').length === 3) {
      return parsed[0];
    }
  } catch {
    /* not a parseable session payload */
  }
  return null;
}

/**
 * Extract the access token from the httpOnly `sb-*-auth-token` cookie set by
 * /api/super-admin/login (and refreshed by the proxy).
 *
 * 2026-07-20 RCA fix (super-admin lockout): @supabase/ssr v0.12 writes the
 * session cookie as `base64-<base64url(JSON.stringify(session))>` (default
 * `cookieEncoding: 'base64url'`) and CHUNKS it into `sb-<ref>-auth-token.0`,
 * `.1`, ... whenever the URI-encoded value exceeds 3180 bytes — which our
 * session JSON always does. The previous parser only understood plain-JSON
 * values, so both the chunked and unchunked base64 shapes returned null,
 * authorizeAdmin saw no cookie candidate, and every post-login request 401'd
 * back to the login page. This version handles all four combinations
 * (chunked/unchunked × base64-/plain-JSON), tolerates URI-encoded chunk
 * values, reassembles chunks in numeric order regardless of header order,
 * and returns null (never throws) on malformed input.
 */
export function extractCookieAccessToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k) cookies[k] = part.slice(eq + 1).trim();
  }

  // Group auth cookies by base name: unchunked value and/or numbered chunks.
  const unchunked = new Map<string, string>();
  const chunked = new Map<string, Map<number, string>>();
  for (const [name, value] of Object.entries(cookies)) {
    const m = name.match(AUTH_TOKEN_COOKIE_RE);
    if (!m) continue;
    const base = m[1];
    if (m[2] === undefined) {
      unchunked.set(base, value);
    } else {
      let chunkMap = chunked.get(base);
      if (!chunkMap) {
        chunkMap = new Map<number, string>();
        chunked.set(base, chunkMap);
      }
      chunkMap.set(Number(m[2]), value);
    }
  }

  for (const base of new Set([...unchunked.keys(), ...chunked.keys()])) {
    const candidates: string[] = [];
    // Mirror @supabase/ssr combineChunks precedence: unchunked value first.
    const whole = unchunked.get(base);
    if (whole) candidates.push(safeDecodeURIComponent(whole));
    const chunkMap = chunked.get(base);
    if (chunkMap) {
      // Reassemble strictly by chunk index (.0, .1, ...) — header order is
      // not guaranteed. Stop at the first gap, as the ssr chunker does.
      const parts: string[] = [];
      for (let i = 0; chunkMap.has(i); i++) {
        parts.push(safeDecodeURIComponent(chunkMap.get(i) as string));
      }
      if (parts.length > 0) candidates.push(parts.join(''));
    }
    for (const candidate of candidates) {
      const token = accessTokenFromSessionPayload(candidate);
      if (token) return token;
    }
  }
  return null;
}

/**
 * Verify that the request comes from an authenticated admin user.
 *
 * Phase G.1 (2026-05-17): accepts a `requiredLevel` argument. The caller's
 * `admin_level` must satisfy `hasMinimumLevel`, else 403 with code
 * ADMIN_INSUFFICIENT_LEVEL. Routes that mutate sensitive state (impersonation,
 * RBAC, feature flags, provisioning, bulk-actions, demo) should pass
 * `'super_admin'`.
 *
 * 2026-06-11 (money-route under-gating prevention): `requiredLevel` is now a
 * REQUIRED parameter — the `= 'support'` default was removed so that no call
 * site can silently inherit the lowest tier. Every route must declare its
 * floor explicitly; `tsc` enforces completeness. `'support'` (the floor — any
 * active admin_users row passes) must be passed explicitly where that level
 * is intended.
 *
 * Phase G.2 (2026-05-17): removed the silent JWT-fallback that retried the
 * admin_users query with the caller's own token if the service-role query
 * returned empty. That fallback defeated tightened RLS on admin_users and
 * was a fail-soft path forbidden by the blueprint.
 */
export async function authorizeAdmin(
  request: NextRequest,
  requiredLevel: AdminLevel,
): Promise<AdminAuthResult> {
  const { url, key } = getSupabaseConfig();

  if (!url) {
    logger.error('admin_auth_config_missing', { detail: 'SUPABASE_URL not configured' });
    return { authorized: false, response: NextResponse.json({ error: 'Server configuration error' }, { status: 500 }) };
  }
  if (!key) {
    logger.error('admin_auth_config_missing', { detail: 'SERVICE_ROLE_KEY not configured' });
    return { authorized: false, response: NextResponse.json({ error: 'Server configuration error' }, { status: 500 }) };
  }

  try {
    // Collect candidate access tokens in priority order: Bearer header first
    // (explicit caller intent), then the httpOnly sb-* session cookie.
    //
    // 2026-07-20 RCA fix (admin session split-brain): the httpOnly cookie is
    // the single reliable session source; the Bearer header is an optional
    // optimization the client attaches when it happens to hold a session.
    // Previously a STALE Bearer short-circuited to 401 even when the request
    // carried a VALID cookie session. Now each candidate is verified with
    // GoTrue in order and we deny only when EVERY candidate fails. Deny codes
    // and shapes are unchanged: ADMIN_NO_TOKEN when no candidate exists,
    // otherwise the failure produced by the LAST candidate tried (the cookie,
    // when both are present).
    const candidates: string[] = [];
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      candidates.push(authHeader.slice(7));
    }
    const cookieToken = extractCookieAccessToken(request.headers.get('Cookie'));
    if (cookieToken && !candidates.includes(cookieToken)) {
      candidates.push(cookieToken);
    }

    if (candidates.length === 0) {
      return { authorized: false, response: NextResponse.json({ error: 'Please log in.', code: 'ADMIN_NO_TOKEN' }, { status: 401 }) };
    }

    // Verify candidates with Supabase GoTrue; first valid one wins.
    let userData: { id?: string; email?: string } | null = null;
    let denial: AdminAuthFailure | null = null;
    for (const candidate of candidates) {
      const userRes = await fetch(`${url}/auth/v1/user`, {
        headers: { 'apikey': key, 'Authorization': `Bearer ${candidate}` },
      });

      if (!userRes.ok) {
        denial = { authorized: false, response: NextResponse.json({ error: 'Session expired. Please log in again.', code: 'ADMIN_SESSION_EXPIRED' }, { status: 401 }) };
        continue;
      }

      const parsed = await userRes.json();
      if (!parsed?.id) {
        denial = { authorized: false, response: NextResponse.json({ error: 'Invalid session.', code: 'ADMIN_INVALID_SESSION' }, { status: 401 }) };
        continue;
      }

      userData = parsed;
      break;
    }

    if (!userData) return denial as AdminAuthFailure;
    const userId = userData.id as string;

    // Look up admin_users table
    const adminQuery = `${url}/rest/v1/admin_users?select=id,name,email,admin_level&auth_user_id=eq.${userId}&is_active=eq.true&limit=1`;
    const adminRes = await fetch(adminQuery, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    });

    if (!adminRes.ok) {
      logger.error('admin_auth_lookup_failed', { status: adminRes.status });
      return { authorized: false, response: NextResponse.json({ error: 'Authorization check failed.', code: 'ADMIN_LOOKUP_FAILED' }, { status: 500 }) };
    }

    const admins = await adminRes.json();

    if (!Array.isArray(admins) || admins.length === 0) {
      return { authorized: false, response: NextResponse.json({ error: 'You are not an authorized administrator.', code: 'ADMIN_NOT_FOUND' }, { status: 403 }) };
    }

    const admin = admins[0];

    // Phase G.1 (2026-05-17): enforce minimum admin_level. Caller's level must
    // satisfy LEVEL_RANK[level] >= LEVEL_RANK[requiredLevel].
    if (!hasMinimumLevel(admin.admin_level, requiredLevel)) {
      logger.warn('admin_auth_level_denied', {
        userId,
        haveLevel: admin.admin_level ?? null,
        needLevel: requiredLevel,
        route: new URL(request.url).pathname,
      });
      return {
        authorized: false,
        response: NextResponse.json(
          {
            error: `This action requires admin level "${requiredLevel}" or higher.`,
            code: 'ADMIN_INSUFFICIENT_LEVEL',
            required_level: requiredLevel,
          },
          { status: 403 },
        ),
      };
    }

    return {
      authorized: true,
      userId,
      adminId: admin.id,
      email: admin.email || userData.email || '',
      name: admin.name,
      adminLevel: admin.admin_level,
    };
  } catch (err) {
    logger.error('admin_auth_exception', { error: err instanceof Error ? err : new Error(String(err)) });
    return { authorized: false, response: NextResponse.json({ error: 'Authorization failed.', code: 'ADMIN_AUTH_EXCEPTION' }, { status: 500 }) };
  }
}

/**
 * Record an admin action to the audit trail.
 *
 * Phase G.4 (2026-05-17): dual-writes to `audit_logs` (canonical, actor_type=
 * 'admin') AND `admin_audit_log` (legacy, kept for backwards compatibility
 * with existing /super-admin/logs reads). Either side failing is logged but
 * never blocks the calling action. A future migration will backfill
 * audit_logs from admin_audit_log history and switch the read paths over.
 *
 * Optional `opts.before` / `opts.after` snapshots populate audit_logs.before_state /
 * after_state for diff-based forensics. Pass them when the mutation produces
 * a meaningful state diff (e.g. role elevation, plan change, suspend).
 */
export async function logAdminAudit(
  admin: AdminAuth,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>,
  ipAddress?: string,
  opts?: { before?: Record<string, unknown>; after?: Record<string, unknown>; userAgent?: string; schoolId?: string | null },
) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return;

  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };
  const enrichedDetails = { ...details, admin_name: admin.name, admin_email: admin.email };

  // 1. Canonical write: audit_logs with actor_type='admin'
  const canonicalWrite = fetch(`${url}/rest/v1/audit_logs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      auth_user_id: admin.userId,
      actor_type: 'admin',
      admin_level: admin.adminLevel,
      action,
      resource_type: entityType,
      resource_id: entityId,
      details: enrichedDetails,
      before_state: opts?.before ?? null,
      after_state: opts?.after ?? null,
      ip_address: ipAddress || null,
      user_agent: opts?.userAgent || null,
      school_id: opts?.schoolId ?? null,
      status: 'success',
    }),
  }).catch((e) => {
    logger.error('audit_logs_admin_write_failed', {
      error: e instanceof Error ? e : new Error(String(e)),
      action, entityType, entityId, adminId: admin.userId,
    });
    return null;
  });

  // 2. Legacy back-compat write: admin_audit_log
  const legacyWrite = fetch(`${url}/rest/v1/admin_audit_log`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      admin_id: admin.userId, action, entity_type: entityType, entity_id: entityId,
      details: { ...enrichedDetails, admin_level: admin.adminLevel },
      ip_address: ipAddress || null,
    }),
  }).catch((e) => {
    logger.error('admin_audit_log_failed', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: 'admin-auth', action, entityType, entityId, adminId: admin.userId,
    });
    return null;
  });

  // Don't await — audit is fire-and-forget. But also don't drop the
  // microtask if Node hasn't scheduled it (the function awaits a promise
  // resolving to undefined immediately so the caller can keep going).
  await Promise.allSettled([canonicalWrite, legacyWrite]);
}

/**
 * Variant of logAdminAudit for routes gated by `authorizeRequest()` (RBAC
 * permission check) rather than `authorizeAdmin()` (x-admin-secret gate).
 *
 * `authorizeRequest` returns only userId — admin name/email/level live in
 * admin_users and can be joined at read time. This helper writes the same
 * admin_audit_log row but skips the convenience-copy enrichment.
 */
export async function logAdminAuditByUserId(
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>,
  ipAddress?: string,
  opts?: { before?: Record<string, unknown>; after?: Record<string, unknown>; userAgent?: string; schoolId?: string | null; adminLevel?: string | null },
) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return;

  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };

  // 1. Canonical: audit_logs
  const canonicalWrite = fetch(`${url}/rest/v1/audit_logs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      auth_user_id: userId,
      actor_type: 'admin',
      admin_level: opts?.adminLevel ?? null,
      action,
      resource_type: entityType,
      resource_id: entityId,
      details: details ?? {},
      before_state: opts?.before ?? null,
      after_state: opts?.after ?? null,
      ip_address: ipAddress || null,
      user_agent: opts?.userAgent || null,
      school_id: opts?.schoolId ?? null,
      status: 'success',
    }),
  }).catch((e) => {
    logger.error('audit_logs_admin_write_failed', {
      error: e instanceof Error ? e : new Error(String(e)),
      action, entityType, entityId, adminId: userId,
    });
    return null;
  });

  // 2. Legacy back-compat: admin_audit_log
  const legacyWrite = fetch(`${url}/rest/v1/admin_audit_log`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      admin_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details: details ?? {},
      ip_address: ipAddress || null,
    }),
  }).catch((e) => {
    logger.error('admin_audit_log_failed', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: 'admin-auth', action, entityType, entityId, adminId: userId,
    });
    return null;
  });

  await Promise.allSettled([canonicalWrite, legacyWrite]);
}

export function supabaseAdminHeaders(prefer: string = 'count=exact') {
  const { key } = getSupabaseConfig();
  if (!key) throw new Error('Service role key not configured');
  return { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': prefer };
}

export function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export function supabaseAdminUrl(table: string, params: string = ''): string {
  const { url } = getSupabaseConfig();
  if (!url) throw new Error('Supabase URL not configured');
  return `${url}/rest/v1/${table}${params ? `?${params}` : ''}`;
}

// ─── Secret-based admin auth (used by /api/internal/admin/* routes) ──────────

/**
 * Validates the x-admin-secret header on a server request.
 * Returns 401 NextResponse if invalid, null if valid.
 */
export function requireAdminSecret(request: NextRequest): NextResponse | null {
  const provided = request.headers.get('x-admin-secret');
  const expected = process.env.SUPER_ADMIN_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'Admin not configured' }, { status: 503 });
  }
  // Constant-time compare — naive `!==` short-circuits at the first differing
  // byte and leaks the secret through response timing.
  if (!provided || !secureEqual(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null; // auth OK
}

/**
 * Log an admin action to admin_audit_log (fire-and-forget).
 * Used by /api/internal/admin/* routes.
 */
export async function logAdminAction(opts: {
  action: string;
  entity_type: string;
  entity_id?: string;
  details?: Record<string, unknown>;
  ip?: string;
}): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from('admin_audit_log').insert({
      admin_id: null, // set to admin_users.id when proper admin accounts are used
      action: opts.action,
      entity_type: opts.entity_type,
      entity_id: opts.entity_id ?? null,
      details: opts.details ?? {},
      ip_address: opts.ip ?? null,
    });
  } catch {
    // Never let audit log failures break the main flow
  }
}

// Client-side session helpers are in @alfanumrik/lib/admin-session (safe for 'use client' components)
