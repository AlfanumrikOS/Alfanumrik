/**
 * Phase G.7 (Super-Admin Production-Readiness Plan, 2026-05-17)
 *
 * Server-side super-admin login.
 *
 * Previously the page called supabase.auth.signInWithPassword directly from
 * the browser, which bypassed the Next proxy's rate-limit bucket entirely.
 * Brute-force protection depended solely on Supabase Auth (which is generous).
 *
 * This route adds two extra layers BEFORE delegating to Supabase Auth:
 *   1. Per-IP rate limit via @upstash/ratelimit (10 attempts / 5 min). Falls
 *      back to in-memory if Upstash env not configured.
 *   2. Per-email sliding-window lockout (5 failures / 15 min) backed by
 *      admin_login_attempts table (Phase G.7 migration).
 *
 * Every attempt (success and failure) writes to both admin_login_attempts
 * (for the lockout check) and audit_logs (for forensics, Phase G.4).
 *
 * NOT a server action — kept as POST route so the existing client login form
 * can submit to it via fetch without React-Server-Actions overhead.
 *
 * 2026-07-20 RCA fix (admin session split-brain): this route previously ALSO
 * returned the raw session tokens in the JSON body, which the login page fed
 * to supabase.auth.setSession → a second localStorage copy of the SAME
 * refresh-token family. Both stores auto-refreshed independently; refresh-token
 * rotation stranded whichever store refreshed second (~2.5-min observed
 * session life). The httpOnly sb-* cookie set below is now the SINGLE session
 * source: the success body carries no tokens, the login page no longer calls
 * setSession, and authorizeAdmin falls back from a stale Bearer to the cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { z } from 'zod';
import { validateBody } from '@alfanumrik/lib/validation';
import { logAdminAuditByUserId } from '@alfanumrik/lib/admin-auth';
import { checkLockout, recordLoginAttempt, LOCKOUT_CONSTANTS } from '@alfanumrik/lib/admin-login-throttle';
import { logger } from '@alfanumrik/lib/logger';
import { createServerClient } from '@supabase/ssr';

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

// Per-IP limiter, distributed via Upstash when available, in-memory fallback.
let ipLimiter: Ratelimit | null = null;
try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    ipLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, '5 m'),
      prefix: 'rl:adminlogin:ip',
    });
  }
} catch {
  ipLimiter = null;
}

// In-memory IP rate limit fallback (process-local, ~10 attempts / 5 min)
const ipMem = new Map<string, { count: number; resetAt: number }>();
function checkIpLocal(ip: string): boolean {
  const now = Date.now();
  const entry = ipMem.get(ip);
  if (!entry || now >= entry.resetAt) {
    ipMem.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
    if (ipMem.size > 1000) {
      const firstKey = ipMem.keys().next().value;
      if (firstKey) ipMem.delete(firstKey);
    }
    return true;
  }
  entry.count++;
  return entry.count <= 10;
}

function getClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = request.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get('user-agent') || undefined;

  // ── 1. Per-IP rate limit ──────────────────────────────────────────────
  if (ipLimiter) {
    try {
      const result = await ipLimiter.limit(ip);
      if (!result.success) {
        return NextResponse.json(
          {
            error: 'Too many login attempts from this IP. Please wait a few minutes.',
            code: 'IP_RATE_LIMITED',
            retry_after_seconds: Math.ceil((result.reset - Date.now()) / 1000),
          },
          { status: 429 },
        );
      }
    } catch (e) {
      logger.warn('admin_login_ip_limiter_failed', { ip, error: e instanceof Error ? e.message : String(e) });
    }
  } else if (!checkIpLocal(ip)) {
    return NextResponse.json(
      { error: 'Too many login attempts from this IP. Please wait a few minutes.', code: 'IP_RATE_LIMITED' },
      { status: 429 },
    );
  }

  // ── 2. Validate body ──────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON', code: 'INVALID_REQUEST' },
      { status: 400 },
    );
  }
  const validation = validateBody(loginSchema, body);
  if (!validation.success) return validation.error;
  const { email, password } = validation.data;

  // ── 3. Per-email lockout check ────────────────────────────────────────
  const lockout = await checkLockout(email);
  if (lockout.locked) {
    // Don't write a failed attempt record for a lockout-rejected request —
    // that would extend the lockout window indefinitely.
    return NextResponse.json(
      {
        error: `Too many failed attempts. Try again in ${lockout.retryAfterSeconds ?? lockout.windowMinutes * 60} seconds.`,
        code: 'EMAIL_LOCKED',
        retry_after_seconds: lockout.retryAfterSeconds,
        threshold: LOCKOUT_CONSTANTS.THRESHOLD,
        window_minutes: LOCKOUT_CONSTANTS.WINDOW_MIN,
      },
      { status: 429 },
    );
  }

  // ── 4. Delegate to Supabase Auth via GoTrue ───────────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json(
      { error: 'Server configuration error', code: 'CONFIG_MISSING' },
      { status: 500 },
    );
  }

  const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!authRes.ok) {
    const err = await authRes.json().catch(() => ({}));
    const failureCode = err?.error_code || err?.code || `goto_${authRes.status}`;
    await recordLoginAttempt({ email, ipAddress: ip, userAgent, succeeded: false, failureCode });
    await logAdminAuditByUserId(
      null, 'admin_login_failed', 'admin_users', email,
      { reason: failureCode, error_message: err?.msg || err?.error_description || 'invalid_credentials' },
      ip,
      { userAgent },
    );
    // Deliberate generic message — don't reveal whether the email exists.
    return NextResponse.json(
      { error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' },
      { status: 401 },
    );
  }

  const session = await authRes.json();
  const userId = session?.user?.id;

  // ── 5. Confirm the caller is actually an admin (extra layer; the regular
  // /api/super-admin/* gate will also enforce this on every subsequent call,
  // but failing here avoids issuing a session cookie to a non-admin).
  const adminRes = await fetch(
    `${url}/rest/v1/admin_users?select=id,admin_level&auth_user_id=eq.${userId}&is_active=eq.true&limit=1`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey}`,
      },
    },
  );
  const admins = adminRes.ok ? await adminRes.json() : [];
  if (!Array.isArray(admins) || admins.length === 0) {
    // The auth succeeded but the user isn't in admin_users. Most common case
    // (caught in the wild 2026-05-20): a school_admin demo operator typed
    // their creds into /super-admin/login by mistake — school_admins live in
    // `school_admins`, not `admin_users`. Detect which non-admin table owns
    // this user and tell the operator where they should actually sign in.
    //
    // Order matters: school_admin first (the high-confusion case we're
    // fixing), then teacher, then guardian, then student. If the user is in
    // none of these tables either, fall through to the generic ADMIN_NOT_FOUND
    // message — that's the "auth user exists but no profile" edge case.
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey;
    const lookupTables: Array<{
      table: string;
      role: 'school_admin' | 'teacher' | 'parent' | 'student';
      suggested_login_url: string;
      message: string;
    }> = [
      {
        table: 'school_admins',
        role: 'school_admin',
        suggested_login_url: '/login',
        message: "This is the platform admin login. School administrators sign in at /login (you'll be routed to /school-admin).",
      },
      {
        table: 'teachers',
        role: 'teacher',
        suggested_login_url: '/login',
        message: "This is the platform admin login. Teachers sign in at /login (you'll be routed to /teacher).",
      },
      {
        table: 'guardians',
        role: 'parent',
        suggested_login_url: '/login',
        message: "This is the platform admin login. Parents sign in at /login or /parent.",
      },
      {
        table: 'students',
        role: 'student',
        suggested_login_url: '/login',
        message: "This is the platform admin login. Students sign in at /login (you'll be routed to /dashboard).",
      },
    ];

    let detectedRole: 'school_admin' | 'teacher' | 'parent' | 'student' | null = null;
    let suggestedLoginUrl: string | null = null;
    let helpfulMessage: string | null = null;

    if (userId) {
      for (const lookup of lookupTables) {
        try {
          const res = await fetch(
            `${url}/rest/v1/${lookup.table}?select=id&auth_user_id=eq.${userId}&limit=1`,
            {
              headers: {
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
              },
            },
          );
          if (!res.ok) continue;
          const rows = await res.json();
          if (Array.isArray(rows) && rows.length > 0) {
            detectedRole = lookup.role;
            suggestedLoginUrl = lookup.suggested_login_url;
            helpfulMessage = lookup.message;
            break;
          }
        } catch (e) {
          logger.warn('admin_login_role_detection_failed', {
            table: lookup.table,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    await recordLoginAttempt({ email, ipAddress: ip, userAgent, succeeded: false, failureCode: 'not_admin' });
    await logAdminAuditByUserId(
      userId || null, 'admin_login_denied_not_admin', 'admin_users', email,
      { reason: 'not_in_admin_users', detected_role: detectedRole },
      ip,
      { userAgent },
    );

    if (detectedRole && suggestedLoginUrl && helpfulMessage) {
      return NextResponse.json(
        {
          error: helpfulMessage,
          code: 'USE_STANDARD_LOGIN',
          suggested_login_url: suggestedLoginUrl,
          detected_role: detectedRole,
        },
        { status: 403 },
      );
    }

    // Generic fallback: auth succeeded but the user has no profile in any
    // known table. Keep the deliberately generic message.
    return NextResponse.json(
      { error: 'You are not an authorized administrator.', code: 'ADMIN_NOT_FOUND' },
      { status: 403 },
    );
  }

  // ── 6. Establish the standard Supabase SSR cookie — the SINGLE session
  // source for the super-admin console. The proxy refreshes this cookie on
  // subsequent requests; AdminShell sends credentials: 'same-origin' and
  // authorizeAdmin accepts the cookie, so no client-side session is needed.
  // Deliberately NO tokens in the response body (see header comment): raw
  // access/refresh tokens in JSON would let a client re-prime localStorage
  // and recreate the dual-refresh split-brain this fix removes.
  const response = NextResponse.json({
    success: true,
    user: { id: userId, email: session.user?.email },
  });
  try {
    const ssr = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            const safeOptions = { ...options, httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' };
            response.cookies.set(name, value, safeOptions);
          });
        },
      },
    });
    const { error: sessionError } = await ssr.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    if (sessionError) throw sessionError;
  } catch (error) {
    logger.error('admin_login_ssr_session_failed', { error: error instanceof Error ? error : new Error(String(error)) });
    return NextResponse.json({ error: 'Secure session could not be established. Please retry.', code: 'SESSION_COOKIE_FAILED' }, { status: 500 });
  }

  // ── 7. Success path: record + audit, return the cookie-bearing response
  await recordLoginAttempt({ email, ipAddress: ip, userAgent, succeeded: true });
  await logAdminAuditByUserId(
    userId, 'admin_login_succeeded', 'admin_users', userId,
    { admin_level: admins[0].admin_level }, ip,
    { userAgent, adminLevel: admins[0].admin_level },
  );

  return response;
}
