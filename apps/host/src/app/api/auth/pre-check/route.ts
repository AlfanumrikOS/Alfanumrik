/**
 * Pre-flight rate-limit + bot-check gate for the three unauthenticated
 * email/password auth actions: login, signup, and forgot-password.
 *
 * TURNSTILE ADDED (2026-09-04, P1-11): login and signup additionally require
 * a valid Cloudflare Turnstile token (see verifyTurnstile below) before the
 * rate-limit checks even run. forgot-password is deliberately out of scope
 * — see TURNSTILE_REQUIRED_ACTIONS. Widget embedded client-side in
 * AuthScreen.tsx; this is the server-side siteverify half.
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

// Turnstile bot-check (P1-11, 2026-09-04): required for login/signup only —
// explicit scope decision. forgot-password already has its own per-email
// limit above, and an attacker email-bombing a victim's inbox gains nothing
// from a human check running in THEIR OWN browser, not the victim's.
const TURNSTILE_REQUIRED_ACTIONS = new Set<Action>(['login', 'signup']);

interface TurnstileSiteverifyResult {
  success?: boolean;
  action?: string;
  hostname?: string;
}

/**
 * Validates a Turnstile token via Cloudflare's siteverify endpoint.
 *
 * Deliberately asymmetric fail posture, unlike the rate-limit checks below
 * (which fail OPEN by design — see this file's header comment): an ACTUAL
 * present token that's missing, malformed, expired, replayed, or wrong for
 * this action/hostname fails CLOSED (403) — a bot-check that silently
 * no-ops on a real failure defeats its own purpose. But when the feature
 * simply isn't CONFIGURED yet (no TURNSTILE_SECRET / TURNSTILE_HOSTNAMES —
 * e.g. this code has deployed but the env vars haven't been set in Vercel
 * yet), it fails OPEN instead of 503-blocking everyone: login/signup is a
 * P15 non-negotiable path ("MUST never break"), and this is a retrofit onto
 * an already-live flow, not a fresh form nobody depends on yet — a
 * config-ordering slip must never be able to lock out every real user.
 */
async function verifyTurnstile(
  token: unknown,
  action: Action,
  remoteip: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const secret = process.env.TURNSTILE_SECRET;
  const expectedHostnames = new Set(
    (process.env.TURNSTILE_HOSTNAMES ?? '')
      .split(',')
      .map((hostname) => hostname.trim())
      .filter(Boolean),
  );

  if (!secret || expectedHostnames.size === 0) {
    // Not configured yet — see fail-open rationale above.
    return { ok: true };
  }

  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return { ok: false, status: 403, error: 'Verification required. Please try again.' };
  }

  let result: TurnstileSiteverifyResult | undefined;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret, response: token, remoteip }),
    });
    if (!r.ok) throw new Error(`siteverify ${r.status}`);
    result = await r.json();
  } catch {
    // Network/upstream failure talking to Cloudflare — fail closed. This is
    // a real (if configured) check failing to run, not "not configured".
    return { ok: false, status: 503, error: 'Verification is temporarily unavailable. Please try again shortly.' };
  }

  if (
    !result?.success ||
    result.action !== action ||
    !result.hostname ||
    !expectedHostnames.has(result.hostname)
  ) {
    return { ok: false, status: 403, error: 'Verification failed. Please try again.' };
  }
  return { ok: true };
}

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

    const ip = getClientIp(request);

    if (TURNSTILE_REQUIRED_ACTIONS.has(action)) {
      const verified = await verifyTurnstile(body?.turnstileToken, action, ip);
      if (!verified.ok) {
        return NextResponse.json({ error: verified.error, code: 'TURNSTILE_FAILED' }, { status: verified.status });
      }
    }

    const config = LIMITS[action];
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
