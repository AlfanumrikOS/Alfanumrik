/**
 * GET /api/dev/impersonate?role=student
 *
 * A plain link-navigation GET (not a form POST) deliberately — this repo's
 * CSP sets `form-action 'self'`, and some proxied dev environments evaluate
 * that directive against an origin that doesn't match a literal same-origin
 * <form> submission, silently blocking it client-side. A normal <a href>
 * navigation isn't a "form submission" and isn't subject to that directive
 * at all, so it sidesteps the mismatch entirely.
 *
 * DEV-ONLY session bypass so a frontend session can actually see and click
 * through the real, logged-in dashboards instead of reading source blind.
 * Hard-blocked in production at the network boundary (see proxy.ts, same
 * pattern as /dev/ui and /dev/cosmic-preview) and again here as
 * defense-in-depth.
 *
 * Design constraints this deliberately respects:
 *   - Never MODIFIES /auth/confirm, recovery-session-hash.ts, or
 *     bootstrap_user_profile — all marked CRITICAL AUTH PATH elsewhere in
 *     this codebase. This route calls the same underlying primitives they
 *     do (admin.generateLink + supabase.auth.verifyOtp — a real,
 *     Supabase-issued session, no custom session-minting) but does its own
 *     redirect rather than routing through /auth/confirm, for two reasons
 *     documented inline at the call site below.
 *   - Reuses the existing demo-account convention (`@alfanumrik.demo`
 *     email domain, `is_demo_account` metadata) documented in
 *     docs/identity/demo-account-contract.md, rather than inventing a new
 *     "fake account" shape. Exactly 4 fixed accounts (one per role),
 *     idempotent — safe to call repeatedly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { isValidRole, getRoleDestination, type ValidRole } from '@alfanumrik/lib/identity';
import { logger } from '@alfanumrik/lib/logger';

function isProdLocked(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

const DEV_ACCOUNT_EMAIL: Record<ValidRole, string> = {
  student: 'dev.impersonate.student@alfanumrik.demo',
  teacher: 'dev.impersonate.teacher@alfanumrik.demo',
  parent: 'dev.impersonate.parent@alfanumrik.demo',
  institution_admin: 'dev.impersonate.school-admin@alfanumrik.demo',
};

const DEV_ACCOUNT_NAME: Record<ValidRole, string> = {
  student: 'Dev Impersonate Student',
  teacher: 'Dev Impersonate Teacher',
  parent: 'Dev Impersonate Parent',
  institution_admin: 'Dev Impersonate Principal',
};

const PROFILE_TABLE: Record<ValidRole, string> = {
  student: 'students',
  teacher: 'teachers',
  parent: 'guardians',
  institution_admin: 'school_admins',
};

/**
 * Find the existing dev account's auth_user_id via our OWN role-specific
 * profile table (fast, indexed single query) instead of GoTrue's
 * `listUsers`. `listUsers` has no server-side email filter in this SDK
 * version, so a naive find-by-email means paging through EVERY user in the
 * project — against a real production user base that made every one of
 * this route's requests take tens of seconds and made the dev tool
 * effectively unusable. This is only ever a FALLBACK path (see
 * ensureDevAccount): createUser is tried first and normally succeeds
 * outright on account #1, or fails fast with "already exists" after that —
 * this function only runs on the rare conflict case.
 */
async function findAuthUserIdByEmailViaProfile(role: ValidRole, email: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from(PROFILE_TABLE[role])
    .select('auth_user_id')
    .eq('email', email)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { auth_user_id: string }).auth_user_id;
}

async function ensureDevAccount(role: ValidRole): Promise<{ authUserId: string; email: string } | null> {
  const admin = getSupabaseAdmin();
  const email = DEV_ACCOUNT_EMAIL[role];
  const name = DEV_ACCOUNT_NAME[role];

  // Optimistic create: cheap single call, and the common case (account
  // already provisioned from a prior impersonation) fails fast with an
  // "already registered" error rather than requiring a pre-check.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { role, name, is_demo_account: true, dev_impersonation: true },
  });

  let authUserId: string | null = created?.user?.id ?? null;

  if (!authUserId) {
    authUserId = await findAuthUserIdByEmailViaProfile(role, email);
    if (!authUserId) {
      logger.error('[dev/impersonate] createUser failed and no existing profile found', {
        role,
        error: createErr?.message,
      });
      return null;
    }
  }

  // bootstrap_user_profile is idempotent (ON CONFLICT) — same RPC
  // /api/auth/bootstrap uses. Safe to call on every impersonation request.
  const { data: rpcResult, error: rpcError } = await admin.rpc('bootstrap_user_profile', {
    p_auth_user_id: authUserId,
    p_role: role,
    p_name: name,
    p_email: email,
    p_grade: role === 'student' ? '9' : null,
    p_board: role === 'student' ? 'CBSE' : null,
    p_school_name: role === 'teacher' ? 'Dev Impersonation School' : null,
    p_subjects_taught: role === 'teacher' ? ['math', 'science'] : null,
    p_grades_taught: role === 'teacher' ? ['9', '10'] : null,
    p_phone: role === 'parent' ? null : null,
    p_link_code: role === 'parent' ? null : null,
  });

  if (rpcError) {
    logger.error('[dev/impersonate] bootstrap_user_profile failed', { role, error: rpcError.message });
    return null;
  }
  const status = typeof rpcResult?.status === 'string' ? rpcResult.status : undefined;
  if (status === 'error') {
    logger.error('[dev/impersonate] bootstrap_user_profile logical error', { role, status });
    return null;
  }

  return { authUserId, email };
}

export async function GET(request: NextRequest) {
  if (isProdLocked()) {
    return new NextResponse(null, { status: 404 });
  }

  const role: unknown = request.nextUrl.searchParams.get('role');

  if (!isValidRole(role)) {
    return NextResponse.json({ success: false, error: 'Invalid role' }, { status: 400 });
  }

  const account = await ensureDevAccount(role);
  if (!account) {
    return NextResponse.json(
      { success: false, error: 'Failed to provision dev impersonation account — check server logs.' },
      { status: 500 },
    );
  }

  const admin = getSupabaseAdmin();
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: account.email,
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    logger.error('[dev/impersonate] generateLink failed', { role, error: linkError?.message });
    return NextResponse.json(
      { success: false, error: 'Failed to mint a session for the dev account.' },
      { status: 500 },
    );
  }

  // Verify the OTP ourselves (the exact same call /auth/confirm's own
  // default branch makes) rather than redirecting through /auth/confirm.
  // Two independent reasons, both discovered while building this route:
  //   1. /auth/confirm builds its redirect from `request.nextUrl.origin`,
  //      which this repo's IPv6-wildcard-bound dev server (`next dev -H ::`)
  //      reconstructs as the unreachable `https://[::]:3000` — a pre-existing
  //      bug in that CRITICAL AUTH PATH file, independent of this route, not
  //      fixed here given that file's explicit "extensive manual testing
  //      required" warning.
  //   2. More fundamentally: this app's client-side Supabase instance
  //      (packages/lib/src/supabase-client.ts) is a plain createClient
  //      (localStorage-backed), NOT @supabase/ssr's cookie-backed
  //      createBrowserClient. A session established purely via Set-Cookie
  //      (what /auth/confirm's default branch does) is therefore invisible
  //      to client components — this is the exact, already-documented
  //      gotcha in packages/lib/src/identity/recovery-session-hash.ts,
  //      whose fix (for the recovery/invite branches only) is to hand the
  //      session to the client via a `#access_token=...` URL fragment,
  //      which the client SDK's `detectSessionInUrl` picks up on load. We
  //      need that same hand-off for an ordinary role destination, not just
  //      /auth/reset, so it's built inline below rather than by extending
  //      that file's own narrower `'recovery' | 'invite'` type.
  const supabase = await createSupabaseServerClient();
  const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  });

  if (verifyError || !verifyData?.session) {
    logger.error('[dev/impersonate] verifyOtp failed', { role, error: verifyError?.message });
    return NextResponse.json(
      { success: false, error: 'Failed to verify the dev session.' },
      { status: 500 },
    );
  }

  const session = verifyData.session;
  // Same field set as buildRecoverySessionHash — expires_in is REQUIRED or
  // @supabase/auth-js's hash parser throws and silently no-ops (see
  // recovery-session-hash.ts's module doc for the full RCA). `type` is
  // deliberately omitted: 'recovery'/'invite' are the only values that
  // constant's own type allows, and passing either here would be
  // semantically wrong for a plain role sign-in — the SDK's required-field
  // check doesn't include `type`, so omitting it is safe.
  const hash = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: String(session.expires_in),
    expires_at: String(session.expires_at),
    token_type: 'bearer',
  }).toString();

  const next = getRoleDestination(role);
  // Deliberately NOT request.nextUrl.origin — see the [::] note above; the
  // incoming Host header reflects exactly what the browser actually sent.
  const host = request.headers.get('host') || 'localhost:3000';
  const origin = `http://${host}`;

  return NextResponse.redirect(`${origin}${next}#${hash}`, { status: 303 });
}
