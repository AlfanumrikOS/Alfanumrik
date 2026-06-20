/**
 * POST /api/schools/claim-admin
 *
 * Track A.1 — the principal's path to LOG IN as their school's admin.
 *
 * A freshly-provisioned school has (a) a Supabase auth user created for the
 * principal with a random temp password and (b) an active `school_admins` row
 * (role 'principal') linked to it, plus a one-time claim token emailed to the
 * principal (only its SHA-256 hash is stored in `school_admin_claim_tokens`).
 *
 * This endpoint lets the principal redeem that raw token: it OPTIONALLY sets
 * their password and stamps `school_admins.accepted_at` (activating the link in
 * `authorizeSchoolAdmin`). It is PUBLIC (the principal is not logged in yet) and
 * rate-limited by IP as anti-abuse, mirroring /api/schools/trial.
 *
 * P15 (onboarding integrity): every reasonable code path returns 200 so the
 * principal-facing claim screen never dead-ends. The flow is IDEMPOTENT —
 * re-POSTing an already-consumed token for the same principal returns 200
 * `already_claimed` rather than an error. P13: the raw token, password, and
 * email are never logged.
 *
 * Body: { token: string, password?: string }
 *   - token: the raw claim token from the invite email (required).
 *   - password: optional new password (>= 8 chars). When omitted the link is
 *     still activated and the principal uses the reset-password / magic-link path.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { claimAdminToken } from '@/lib/school-provisioning';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  // Anti-abuse: limit token-guessing. 10 attempts / 15 min / IP.
  const rateCheck = await checkApiRateLimit(`claim-admin:${ip}`, 10, 15 * 60 * 1000);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(0, rateCheck.resetAt - Math.ceil(Date.now() / 1000))),
          'X-RateLimit-Remaining': '0',
        },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : null;

  if (!token) {
    return NextResponse.json(
      { success: false, error: 'Claim token is required.' },
      { status: 400 },
    );
  }
  // Validate the optional password shape up-front (don't echo the value).
  if (password !== null && (password.length < 8 || password.length > 200)) {
    return NextResponse.json(
      { success: false, error: 'Password must be between 8 and 200 characters.' },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  const result = await claimAdminToken(admin, token, password);

  switch (result.status) {
    case 'claimed':
    case 'already_claimed':
      // 200 on both — idempotent success. The client can now route the principal
      // to the school-admin dashboard / login.
      return NextResponse.json({
        success: true,
        data: {
          status: result.status,
          school_id: result.school_id,
          school_admin_id: result.school_admin_id,
          password_set: result.status === 'claimed' && password !== null,
        },
      });

    case 'invalid_token':
      // Generic 400 — do not distinguish "unknown" from "malformed" to avoid
      // leaking which tokens exist.
      return NextResponse.json(
        { success: false, error: 'This invite link is invalid.' },
        { status: 400 },
      );

    case 'expired':
      return NextResponse.json(
        {
          success: false,
          error: 'This invite link has expired. Please ask your administrator to re-issue it.',
        },
        { status: 410 },
      );

    case 'failed':
    default:
      logger.error('school_admin_claim_route_failed', {
        // result.error carries no PII (generic copy); safe to record.
        reason: 'error' in result ? result.error : 'unknown',
      });
      return NextResponse.json(
        { success: false, error: 'Could not complete the claim. Please try again.' },
        { status: 500 },
      );
  }
}
