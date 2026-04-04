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

// ─── Types ────────────────────────────────────────────────────

export interface AdminAuth {
  authorized: true;
  userId: string;
  adminId: string;
  email: string;
  name: string;
  adminLevel: string;
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
 * Checks Supabase session token, then looks up admin_users table.
 * Falls back to user's own token if service role query returns empty
 * (handles misconfigured service role key gracefully).
 */
export async function authorizeAdmin(request: NextRequest): Promise<AdminAuthResult> {
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

    let admins = await adminRes.json();

    // Fallback: retry with user's own token if service role returned empty
    if (Array.isArray(admins) && admins.length === 0) {
      const retryRes = await fetch(adminQuery, {
        headers: { 'apikey': key, 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });
      if (retryRes.ok) {
        const retryData = await retryRes.json();
        if (Array.isArray(retryData) && retryData.length > 0) {
          admins = retryData;
        }
      }
    }

    if (!Array.isArray(admins) || admins.length === 0) {
      return { authorized: false, response: NextResponse.json({ error: 'You are not an authorized administrator.', code: 'ADMIN_NOT_FOUND' }, { status: 403 }) };
    }

    const admin = admins[0];
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

/** Record an admin action to the audit trail (used by /api/super-admin/* routes). */
export async function logAdminAudit(
  admin: AdminAuth, action: string, entityType: string, entityId: string,
  details?: Record<string, unknown>, ipAddress?: string
) {
  try {
    const { url, key } = getSupabaseConfig();
    if (!url || !key) return;
    await fetch(`${url}/rest/v1/admin_audit_log`, {
      method: 'POST',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        admin_id: admin.userId, action, entity_type: entityType, entity_id: entityId,
        details: { ...details, admin_name: admin.name, admin_email: admin.email, admin_level: admin.adminLevel },
        ip_address: ipAddress || null,
      }),
    });
  } catch (e) {
    logger.error('admin_audit_log_failed', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: 'admin-auth',
      action,
      entityType,
      entityId,
      adminId: admin.userId,
    });
  }
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
  if (!provided || provided !== expected) {
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
