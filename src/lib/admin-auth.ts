import { NextRequest, NextResponse } from 'next/server';

/**
 * Admin Authorization Module
 *
 * Authenticates via Supabase session + admin_users DB verification.
 * Every admin API route must call authorizeAdmin().
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
  return { url: url || null, key: key || null };
}

export async function authorizeAdmin(request: NextRequest): Promise<AdminAuthResult> {
  const { url, key } = getSupabaseConfig();
  const diag: Record<string, unknown> = {
    supabase_url_present: !!url,
    service_role_key_present: !!key,
    service_role_key_length: key ? key.length : 0,
  };

  // Step 0: Check env vars
  if (!url) {
    console.error('[authorizeAdmin] FAIL: NEXT_PUBLIC_SUPABASE_URL not set');
    return { authorized: false, response: NextResponse.json({ error: 'NEXT_PUBLIC_SUPABASE_URL not configured', diag }, { status: 500 }) };
  }
  if (!key) {
    console.error('[authorizeAdmin] FAIL: SUPABASE_SERVICE_ROLE_KEY not set');
    return { authorized: false, response: NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured', diag }, { status: 500 }) };
  }

  try {
    // Step 1: Extract access token
    let accessToken: string | null = null;
    const authHeader = request.headers.get('Authorization');
    diag.auth_header_present = !!authHeader;

    if (authHeader?.startsWith('Bearer ')) {
      accessToken = authHeader.slice(7);
    }

    if (!accessToken) {
      // Try cookie
      const cookieHeader = request.headers.get('Cookie');
      diag.cookie_header_present = !!cookieHeader;
      if (cookieHeader) {
        const cookies = Object.fromEntries(
          cookieHeader.split(';').map(c => {
            const [k, ...v] = c.trim().split('=');
            return [k, v.join('=')];
          })
        );
        const authCookieKey = Object.keys(cookies).find(k => /^sb-.+-auth-token/.test(k));
        diag.auth_cookie_found = !!authCookieKey;
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
              } catch { /* not valid */ }
            }
          }
        }
      }
    }

    diag.access_token_extracted = !!accessToken;
    diag.access_token_length = accessToken ? accessToken.length : 0;

    if (!accessToken) {
      console.error('[authorizeAdmin] FAIL: No access token found', diag);
      return { authorized: false, response: NextResponse.json({ error: 'No access token found. Please log in.', diag }, { status: 401 }) };
    }

    // Step 2: Verify token with GoTrue
    const userRes = await fetch(`${url}/auth/v1/user`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${accessToken}` },
    });
    diag.gotrue_status = userRes.status;

    if (!userRes.ok) {
      const gotrueBody = await userRes.text().catch(() => 'unknown');
      diag.gotrue_error = gotrueBody.slice(0, 200);
      console.error('[authorizeAdmin] FAIL: GoTrue rejected token', diag);
      return { authorized: false, response: NextResponse.json({ error: 'Invalid or expired token', diag }, { status: 401 }) };
    }

    const userData = await userRes.json();
    const userId = userData.id;
    diag.user_id = userId;
    diag.user_email = userData.email;

    if (!userId) {
      console.error('[authorizeAdmin] FAIL: GoTrue returned no user ID', diag);
      return { authorized: false, response: NextResponse.json({ error: 'GoTrue returned no user ID', diag }, { status: 401 }) };
    }

    // Step 3: Query admin_users with service role key
    const adminQueryUrl = `${url}/rest/v1/admin_users?select=id,name,email,admin_level&auth_user_id=eq.${userId}&is_active=eq.true&limit=1`;
    const adminRes = await fetch(adminQueryUrl, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    });
    diag.admin_query_status = adminRes.status;

    if (!adminRes.ok) {
      const adminError = await adminRes.text().catch(() => 'unknown');
      diag.admin_query_error = adminError.slice(0, 300);
      console.error('[authorizeAdmin] FAIL: admin_users query HTTP error', diag);
      return { authorized: false, response: NextResponse.json({ error: `admin_users query failed (HTTP ${adminRes.status})`, diag }, { status: 500 }) };
    }

    let admins = await adminRes.json();
    diag.admin_query_result_type = typeof admins;
    diag.admin_query_is_array = Array.isArray(admins);
    diag.admin_query_length = Array.isArray(admins) ? admins.length : -1;

    // Step 3b: If service role returned empty, retry with user's own token
    // (handles case where SUPABASE_SERVICE_ROLE_KEY is actually the anon key)
    if (Array.isArray(admins) && admins.length === 0) {
      console.log('[authorizeAdmin] Service role query returned 0 rows, retrying with user token');
      const retryRes = await fetch(adminQueryUrl, {
        headers: { 'apikey': key, 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      });
      diag.retry_status = retryRes.status;
      if (retryRes.ok) {
        const retryData = await retryRes.json();
        diag.retry_length = Array.isArray(retryData) ? retryData.length : -1;
        if (Array.isArray(retryData) && retryData.length > 0) {
          admins = retryData;
          diag.resolved_via = 'user_token_retry';
        }
      }
    }

    if (!Array.isArray(admins) || admins.length === 0) {
      console.error('[authorizeAdmin] FAIL: admin_users lookup returned 0 rows', diag);
      return { authorized: false, response: NextResponse.json({ error: 'Authenticated user is not present in admin_users', diag }, { status: 403 }) };
    }

    // Step 4: Success
    const admin = admins[0];
    diag.admin_id = admin.id;
    diag.admin_level = admin.admin_level;
    console.log('[authorizeAdmin] SUCCESS', { userId, email: userData.email, adminLevel: admin.admin_level });

    return {
      authorized: true,
      userId,
      adminId: admin.id,
      email: admin.email || userData.email || '',
      name: admin.name,
      adminLevel: admin.admin_level,
    };
  } catch (err) {
    diag.exception = err instanceof Error ? err.message : String(err);
    console.error('[authorizeAdmin] EXCEPTION', diag);
    return { authorized: false, response: NextResponse.json({ error: 'Authorization exception: ' + (err instanceof Error ? err.message : 'unknown'), diag }, { status: 500 }) };
  }
}

/**
 * Log an admin action to the audit trail with real user identity.
 */
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
  } catch { /* fire and forget */ }
}

export function supabaseAdminHeaders(prefer: string = 'count=exact') {
  const { key } = getSupabaseConfig();
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': prefer };
}

export function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export function supabaseAdminUrl(table: string, params: string = ''): string {
  const { url } = getSupabaseConfig();
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL not configured');
  return `${url}/rest/v1/${table}${params ? `?${params}` : ''}`;
}
