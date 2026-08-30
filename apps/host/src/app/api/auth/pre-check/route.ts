/**
 * Pre-flight rate-limit gate for the three unauthenticated email/password
 * auth actions: login, signup, and forgot-password.
 *
 * SECURITY FIX (2026-08-30): AuthScreen.tsx (packages/ui/src/auth/AuthScreen.tsx)
 * calls supabase.auth.{signInWithPassword,signUp,resetPasswordForEmail}()
 * directly from the browser to Supabase's own Auth API for all three flows —
 * none of them ever touch this Next.js app, so none of the app's own
 * rate-limiting infrastructure (checkApiRateLimit, Upstash) applied to any of
 * them. Protection depended entirely on Supabase's own default GoTrue limits.
 * The super-admin login route was already rewritten months ago for this exact
 * reason on the login side (see api/super-admin/login/route.ts's header
 * comment) — that fix was never extended to the actual student/teacher/
 * parent/school-admin forms, the highest-traffic, most attacker-reachable
 * entry points in the app.
 *
 * Deliberately narrow scope: this route does NOT proxy the actual Supabase
 * call or touch session/cookie establishment — the client still calls
 * supabase.auth.* itself immediately after, exactly as before. Replicating
 * the super-admin route's full pattern (an httpOnly SSR cookie as the sole
 * session source) would mean migrating the whole app off its current
 * localStorage-based client Supabase session model — a real architectural
 * change, not something to bundle into a rate-limit fix for the auth paths
 * every user depends on (P15: "login must work for ALL users every time").
 * This route only adds the missing bound on attempt volume per action.
 *
 * Limits (all via the existing checkApiRateLimit helper — Upstash-backed,
 * in-memory fallback — same infra already used by VULN-D1/D2/D3, oauth/token,
 * payments/*, auth/{bootstrap,session}):
 *   - login:  per-IP 20/5min, per-email 10/15min (credential-guessing bound;
 *     legitimate users rarely fail more than a couple of times).
 *   - signup: per-IP 10/5min only (no per-email limiter — an attacker
 *     enumerating random emails has no fixed target to key on; this bounds
 *     bulk fake-account creation from one source instead).
 *   - forgot: per-IP 10/5min, per-email 5/15min (bounds email-bombing a
 *     single victim's inbox with reset links, and mass-triggering resets
 *     from one IP).
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkApiRateLimit } from '@alfanumrik/lib/api-rate-limit';

type Action = 'login' | 'signup' | 'forgot';

const LIMITS: Record<Action, { ip: [number, number]; email?: [number, number] }> = {
  login: { ip: [20, 5 * 60 * 1000], email: [10, 15 * 60 * 1000] },
  signup: { ip: [10, 5 * 60 * 1000] },
  forgot: { ip: [10, 5 * 60 * 1000], email: [5, 15 * 60 * 1000] },
};

function getClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

function rateLimitedResponse(rl: { resetAt: number }) {
  return NextResponse.json(
    { error: 'Too many attempts. Please wait a few minutes and try again.', code: 'RATE_LIMITED' },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(0, rl.resetAt - Math.ceil(Date.now() / 1000))),
        'X-RateLimit-Remaining': '0',
      },
    },
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body?.action as Action | undefined;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!action || !(action in LIMITS)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const config = LIMITS[action];
    const ip = getClientIp(request);

    const ipCheck = await checkApiRateLimit(`auth-pre-check:${action}:ip:${ip}`, config.ip[0], config.ip[1]);
    if (!ipCheck.allowed) return rateLimitedResponse(ipCheck);

    if (config.email) {
      const emailCheck = await checkApiRateLimit(`auth-pre-check:${action}:email:${email}`, config.email[0], config.email[1]);
      if (!emailCheck.allowed) return rateLimitedResponse(emailCheck);
    }

    return NextResponse.json({ allowed: true });
  } catch {
    // Fail open: a broken rate limiter must never block legitimate auth —
    // same posture as every other checkApiRateLimit call site in this app.
    return NextResponse.json({ allowed: true });
  }
}
