import { NextRequest, NextResponse } from 'next/server';

/**
 * Admin Authorization Module
 *
 * Replaces the insecure shared-secret pattern with proper per-user
 * Supabase session-based authentication + admin_users DB verification.
 *
 * Every admin API route must call authorizeAdmin() which:
 * 1. Extracts the Supabase session from cookie or Authorization header
 * 2. Verifies the user exists in auth.users via Supabase GoTrue API
 * 3. Checks the user is in admin_users table with is_active=true
 * 4. Returns the admin's identity for audit logging
 */

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

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return { url, key };
}

/**
 * Authorize an admin request using Supabase session + admin_users DB check.
 * Uses direct REST/GoTrue API calls — no Supabase JS client needed.
 */
export async function authorizeAdmin(request: NextRequest): Promise<AdminAuthResult> {
  try {
    const { url, key } = getSupabaseConfig();
    let accessToken: string | null = null;

    // Try Bearer token first (API calls from admin UI)
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      accessToken = authHeader.slice(7);
    }

    // Try Supabase session cookie
    if (!accessToken) {
      const cookieHeader = request.headers.get('Cookie');
      if (cookieHeader) {
        const cookies = Object.fromEntries(
          cookieHeader.split(';').map(c => {
            const [k, ...v] = c.trim().split('=');
            return [k, v.join('=')];
          })
        );

        const authCookieKey = Object.keys(cookies).find(k =>
          /^sb-.+-auth-token/.test(k)
        );

        if (authCookieKey) {
          try {
            const decoded = decodeURIComponent(cookies[authCookieKey]);
            const parsed = JSON.parse(decoded);
            accessToken = parsed?.access_token || parsed?.[0]?.access_token || null;
          } catch {
            // Try chunked cookies
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
              } catch { /* not valid */ }
            }
          }
        }
      }
    }

    if (!accessToken) {
      return {
        authorized: false,
        response: NextResponse.json(
          { error: 'Authentication required. Please log in.' },
          { status: 401 }
        ),
      };
    }

    // Verify token with Supabase GoTrue API
    const userRes = await fetch(`${url}/auth/v1/user`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!userRes.ok) {
      return {
        authorized: false,
        response: NextResponse.json(
          { error: 'Invalid or expired session. Please log in again.' },
          { status: 401 }
        ),
      };
    }

    const userData = await userRes.json();
    const userId = userData.id;
    if (!userId) {
      return {
        authorized: false,
        response: NextResponse.json(
          { error: 'Could not identify user.' },
          { status: 401 }
        ),
      };
    }

    // Check admin_users table via REST API
    const adminRes = await fetch(
      `${url}/rest/v1/admin_users?select=id,name,email,admin_level&auth_user_id=eq.${userId}&is_active=eq.true&limit=1`,
      {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!adminRes.ok) {
      return {
        authorized: false,
        response: NextResponse.json(
          { error: 'Authorization check failed.' },
          { status: 500 }
        ),
      };
    }

    const admins = await adminRes.json();
    if (!Array.isArray(admins) || admins.length === 0) {
      return {
        authorized: false,
        response: NextResponse.json(
          { error: 'Access denied. You are not an authorized administrator.' },
          { status: 403 }
        ),
      };
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
    return {
      authorized: false,
      response: NextResponse.json(
        { error: 'Authorization failed: ' + (err instanceof Error ? err.message : 'unknown') },
        { status: 500 }
      ),
    };
  }
}

/**
 * Log an admin action to the audit trail with real user identity.
 */
export async function logAdminAudit(
  admin: AdminAuth,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>,
  ipAddress?: string
) {
  try {
    const { url, key } = getSupabaseConfig();
    await fetch(`${url}/rest/v1/admin_audit_log`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        admin_id: admin.userId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        details: {
          ...details,
          admin_name: admin.name,
          admin_email: admin.email,
          admin_level: admin.adminLevel,
        },
        ip_address: ipAddress || null,
      }),
    });
  } catch { /* fire and forget */ }
}

/**
 * Supabase REST API headers for admin routes.
 */
export function supabaseAdminHeaders(prefer: string = 'count=exact') {
  const { key } = getSupabaseConfig();
  return {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': prefer,
  };
}

/**
 * Validate a UUID string to prevent injection in REST URL parameters.
 */
export function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export function supabaseAdminUrl(table: string, params: string = ''): string {
  const { url } = getSupabaseConfig();
  return `${url}/rest/v1/${table}${params ? `?${params}` : ''}`;
}
