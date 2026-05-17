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
import { logger } from '@/lib/logger';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { secureEqual } from '@/lib/secure-compare';

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
 * Verify that the request comes from an authenticated admin user.
 *
 * Phase G.1 (2026-05-17): now accepts an optional `requiredLevel` argument.
 * When provided, the caller's `admin_level` must satisfy `hasMinimumLevel`,
 * else 403 with code ADMIN_INSUFFICIENT_LEVEL. Default is `'support'` (the
 * floor — any active admin_users row passes), preserving today's behaviour
 * for routes that haven't yet declared their required level. Routes that
 * mutate sensitive state (impersonation, RBAC, feature flags, provisioning,
 * bulk-actions, demo) should pass `'super_admin'`.
 *
 * Phase G.2 (2026-05-17): removed the silent JWT-fallback that retried the
 * admin_users query with the caller's own token if the service-role query
 * returned empty. That fallback defeated tightened RLS on admin_users and
 * was a fail-soft path forbidden by the blueprint.
 */
export async function authorizeAdmin(
  request: NextRequest,
  requiredLevel: AdminLevel = 'support',
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
    // Extract token from Authorization header or session cookie
    let accessToken: string | null = null;
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      accessToken = authHeader.slice(7);
    }

    if (!accessToken) {
      const cookieHeader = request.headers.get('Cookie');
      if (cookieHeader) {
        const cookies = Object.fromEntries(
          cookieHeader.split(';').map(c => {
            const [k, ...v] = c.trim().split('=');
            return [k, v.join('=')];
          })
        );
        const authCookieKey = Object.keys(cookies).find(k => /^sb-.+-auth-token/.test(k));
        if (authCookieKey) {
          try {
            const decoded = decodeURIComponent(cookies[authCookieKey]);
            const parsed = JSON.parse(decoded);
            accessToken = parsed?.access_token || parsed?.[0]?.access_token || null;
          } catch {
            const prefix = authCookieKey.replace(/\.\d+$/, '');
            const chunks: string[] = [];
            for (let i = 0; i < 10; i++) {
              const chunk = cookies[`${prefix}.${i}`];
              if (chunk) chunks.push(chunk);
              else break;
            }
            if (chunks.length > 0) {
              try {
                const decoded = decodeURIComponent(chunks.join(''));
                const parsed = JSON.parse(decoded);
                accessToken = parsed?.access_token || null;
              } catch { /* invalid cookie data */ }
            }
          }
        }
      }
    }

    if (!accessToken) {
      return { authorized: false, response: NextResponse.json({ error: 'Please log in.', code: 'ADMIN_NO_TOKEN' }, { status: 401 }) };
    }

    // Verify token with Supabase GoTrue
    const userRes = await fetch(`${url}/auth/v1/user`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      return { authorized: false, response: NextResponse.json({ error: 'Session expired. Please log in again.', code: 'ADMIN_SESSION_EXPIRED' }, { status: 401 }) };
    }

    const userData = await userRes.json();
    const userId = userData.id;
    if (!userId) {
      return { authorized: false, response: NextResponse.json({ error: 'Invalid session.', code: 'ADMIN_INVALID_SESSION' }, { status: 401 }) };
    }

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

// Client-side session helpers are in @/lib/admin-session (safe for 'use client' components)
