/**
 * Phase G.3 (Super-Admin Production-Readiness Plan, 2026-05-17)
 *
 * Server-component variant of authorizeAdmin. Reads the Supabase session from
 * the request cookies (via Next 16's `cookies()` API), verifies it against
 * GoTrue, looks up admin_users, and enforces a minimum admin_level. Returns
 * a discriminated union the caller can switch on.
 *
 * Use this from server-rendered pages (e.g. /super-admin/layout.tsx) to
 * gate render BEFORE any HTML is sent. The existing client-side gate in
 * AdminShell.tsx then becomes a defence-in-depth UX nicety (handles sign-out
 * mid-session) rather than the only barrier.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_LEVELS, type AdminLevel, hasMinimumLevel } from './admin-auth';

export interface ServerAdminAuth {
  authorized: true;
  userId: string;
  adminId: string;
  email: string;
  name: string;
  adminLevel: AdminLevel | string;
}

export interface ServerAdminAuthFailure {
  authorized: false;
  reason: 'no_session' | 'session_invalid' | 'not_admin' | 'insufficient_level' | 'config_missing' | 'lookup_failed';
  requiredLevel?: AdminLevel;
  haveLevel?: string | null;
}

export type ServerAdminAuthResult = ServerAdminAuth | ServerAdminAuthFailure;

function parseSupabaseAuthCookieValue(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded);
    return parsed?.access_token || parsed?.[0]?.access_token || null;
  } catch {
    return null;
  }
}

async function extractAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  // Supabase auth cookie name: sb-<project-ref>-auth-token (sometimes chunked
  // as .0/.1/.2 if the JWT is long).
  const all = cookieStore.getAll();
  const single = all.find((c) => /^sb-.+-auth-token$/.test(c.name));
  if (single) {
    const token = parseSupabaseAuthCookieValue(single.value);
    if (token) return token;
  }
  // Chunked variant: sb-<ref>-auth-token.0, .1, ...
  const chunks = all
    .filter((c) => /^sb-.+-auth-token\.\d+$/.test(c.name))
    .sort((a, b) => {
      const idxA = parseInt(a.name.split('.').pop() || '0', 10);
      const idxB = parseInt(b.name.split('.').pop() || '0', 10);
      return idxA - idxB;
    });
  if (chunks.length > 0) {
    const combined = chunks.map((c) => c.value).join('');
    const token = parseSupabaseAuthCookieValue(combined);
    if (token) return token;
  }
  return null;
}

/**
 * Server-side admin authorization. Reads cookies, verifies session, looks up
 * admin_users, and checks `requiredLevel`. Returns a typed result; the caller
 * decides whether to redirect / render an error / etc.
 */
export async function authorizeAdminServer(
  requiredLevel: AdminLevel = 'support',
): Promise<ServerAdminAuthResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { authorized: false, reason: 'config_missing' };

  const accessToken = await extractAccessToken();
  if (!accessToken) return { authorized: false, reason: 'no_session' };

  // Verify the token with GoTrue.
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!userRes.ok) return { authorized: false, reason: 'session_invalid' };

  const userData = await userRes.json();
  const userId = userData?.id;
  if (!userId) return { authorized: false, reason: 'session_invalid' };

  // Service-role lookup against admin_users.
  const adminRes = await fetch(
    `${url}/rest/v1/admin_users?select=id,name,email,admin_level&auth_user_id=eq.${userId}&is_active=eq.true&limit=1`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    },
  );
  if (!adminRes.ok) return { authorized: false, reason: 'lookup_failed' };

  const admins = await adminRes.json();
  if (!Array.isArray(admins) || admins.length === 0) {
    return { authorized: false, reason: 'not_admin' };
  }

  const admin = admins[0];
  if (!hasMinimumLevel(admin.admin_level, requiredLevel)) {
    return {
      authorized: false,
      reason: 'insufficient_level',
      requiredLevel,
      haveLevel: admin.admin_level,
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
}

/**
 * Convenience: enforce admin authorization or redirect to the login page.
 * The caller (e.g. /super-admin/layout.tsx) calls this at the top of its
 * server component to fail closed before any HTML is rendered.
 */
export async function requireAdminOrRedirect(
  requiredLevel: AdminLevel = 'support',
  loginPath: string = '/super-admin/login',
): Promise<ServerAdminAuth> {
  const auth = await authorizeAdminServer(requiredLevel);
  if (auth.authorized) return auth;

  // Redirect causes:
  //   - no_session / session_invalid → straight to login
  //   - not_admin → also login (we don't want to reveal the URL exists)
  //   - insufficient_level → login (defence in depth — they shouldn't even
  //     reach pages above their level)
  //   - config_missing / lookup_failed → login (fail-closed)
  // For the elevated-level case we attach `?from=` so the login flow can
  // surface a more helpful "insufficient privileges" message.
  const qs = auth.reason === 'insufficient_level'
    ? `?from=insufficient_level&need=${auth.requiredLevel}`
    : `?from=${auth.reason}`;
  redirect(`${loginPath}${qs}`);
}

// Re-export the level enum so server-side callers don't have to dual-import.
export { ADMIN_LEVELS, hasMinimumLevel, type AdminLevel };
