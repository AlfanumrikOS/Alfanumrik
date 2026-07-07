/**
 * POST /api/parent/link-code/redeem — Phase D.4.
 *
 * Step 2 of the 2FA-protected guardian-link flow. The signed-in guardian
 * submits the link code + the 6-digit OTP we emailed them. If the OTP
 * matches the active challenge row, we delete the challenge and call the
 * existing `link_guardian_to_student_via_code` RPC to create the
 * guardian_student_links row.
 *
 * Failure handling:
 *
 *   - Per-IP rate limit: 10 requests/hour. Looser than request-otp (which
 *     emails) because legitimate users may mistype once or twice.
 *
 *   - Per-challenge attempt cap: 5 incorrect attempts → `locked_until`
 *     stamped one hour out. The row is NOT deleted; the next verify
 *     against the same (link_code, auth_user_id) sees the active lock and
 *     returns 423 without burning an attempt.
 *
 *   - Constant-time hash compare via `verifyOtp`. Never compare strings
 *     with `===` here — timing leaks.
 *
 *   - The audit trail (auth_audit_log) sees every attempt: success,
 *     wrong-otp, locked, no-challenge, rate-limited. Operators can spot
 *     credential-stuffing patterns even when individual attempts return
 *     opaque 401s to the caller.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { normalizeIP } from '@alfanumrik/lib/sanitize';
import { checkApiRateLimit } from '@alfanumrik/lib/api-rate-limit';
import {
  verifyOtp,
  computeLockoutUntil,
  OTP_MAX_ATTEMPTS,
  REDEEM_IP_LIMIT,
  REDEEM_IP_WINDOW_MS,
} from '@alfanumrik/lib/link-code-otp';

interface ChallengeRow {
  id: string;
  link_code: string;
  auth_user_id: string;
  student_id: string | null;
  otp_hash: string;
  expires_at: string;
  attempt_count: number;
  locked_until: string | null;
}

async function audit(
  authUserId: string | null,
  event: string,
  ipAddress: string,
  userAgent: string | null,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await supabaseAdmin.from('auth_audit_log').insert({
      auth_user_id: authUserId,
      event_type: event,
      ip_address: ipAddress,
      user_agent: userAgent,
      metadata,
    });
  } catch (err) {
    logger.warn('link_code_otp_audit_insert_failed', {
      event,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function POST(request: NextRequest) {
  const ip = normalizeIP(request);
  const userAgent = request.headers.get('user-agent');

  // ── 1. Per-IP rate limit ──────────────────────────────────────────────
  const rl = await checkApiRateLimit(
    `link-code-otp-redeem:${ip}`,
    REDEEM_IP_LIMIT,
    REDEEM_IP_WINDOW_MS
  );
  if (!rl.allowed) {
    await audit(null, 'link_code_otp_redeem_rate_limited', ip, userAgent, {
      limit: REDEEM_IP_LIMIT,
      windowMs: REDEEM_IP_WINDOW_MS,
    });
    return NextResponse.json(
      { success: false, error: 'Too many requests. Try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.resetAt - Math.floor(Date.now() / 1000)) },
      }
    );
  }

  // ── 2. Auth ───────────────────────────────────────────────────────────
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser();
  if (sessionError || !user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // ── 3. Body ───────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const linkCodeRaw = obj.link_code;
  const otpRaw = obj.otp;
  if (typeof linkCodeRaw !== 'string' || linkCodeRaw.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: 'link_code is required' },
      { status: 400 }
    );
  }
  if (typeof otpRaw !== 'string' || !/^\d{6}$/.test(otpRaw.trim())) {
    return NextResponse.json(
      { success: false, error: 'otp must be a 6-digit string' },
      { status: 400 }
    );
  }
  const linkCode = linkCodeRaw.trim().toUpperCase();
  const otp = otpRaw.trim();

  // ── 4. Find the active challenge ──────────────────────────────────────
  // Active = matching (link_code, auth_user_id) AND not expired. We DO
  // include locked rows — we need to surface the 423 status in that case.
  let challenge: ChallengeRow | null = null;
  try {
    const { data } = await supabaseAdmin
      .from('link_code_otp_challenges')
      .select('id, link_code, auth_user_id, student_id, otp_hash, expires_at, attempt_count, locked_until')
      .eq('link_code', linkCode)
      .eq('auth_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    challenge = (data as ChallengeRow | null) ?? null;
  } catch (err) {
    logger.error('link_code_otp_redeem_challenge_lookup_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }

  // No challenge — either request-otp was never called, or the row already
  // expired and a janitor swept it. Audit and return a 401 with no detail.
  if (!challenge) {
    await audit(user.id, 'link_code_otp_redeem_no_challenge', ip, userAgent, {});
    return NextResponse.json(
      { success: false, error: 'No active OTP. Request a new code.' },
      { status: 401 }
    );
  }

  // Locked challenge — 423 (Locked) until the timer elapses.
  if (challenge.locked_until && new Date(challenge.locked_until).getTime() > Date.now()) {
    await audit(user.id, 'link_code_otp_redeem_locked', ip, userAgent, {
      challenge_id: challenge.id,
      locked_until: challenge.locked_until,
    });
    const retryAfterSec = Math.ceil(
      (new Date(challenge.locked_until).getTime() - Date.now()) / 1000
    );
    return NextResponse.json(
      {
        success: false,
        error: 'Too many incorrect attempts. Try again later.',
        locked_until: challenge.locked_until,
      },
      {
        status: 423,
        headers: { 'Retry-After': String(retryAfterSec) },
      }
    );
  }

  // Expired challenge — treat the same as "no active challenge" but log
  // a distinct event type so we can tell the cases apart in audit logs.
  if (new Date(challenge.expires_at).getTime() <= Date.now()) {
    await audit(user.id, 'link_code_otp_redeem_expired', ip, userAgent, {
      challenge_id: challenge.id,
      expires_at: challenge.expires_at,
    });
    // Clean up the dead row so the next request-otp creates fresh state.
    try {
      await supabaseAdmin.from('link_code_otp_challenges').delete().eq('id', challenge.id);
    } catch { /* janitor will get it */ }
    return NextResponse.json(
      { success: false, error: 'OTP has expired. Request a new code.' },
      { status: 401 }
    );
  }

  // ── 5. Constant-time verify ───────────────────────────────────────────
  // Salt is the challenge id (a UUID). See lib/link-code-otp.ts.
  const isMatch = verifyOtp(otp, challenge.otp_hash, challenge.id);

  if (!isMatch) {
    const newCount = challenge.attempt_count + 1;
    const shouldLock = newCount >= OTP_MAX_ATTEMPTS;
    const lockedUntil = shouldLock ? computeLockoutUntil() : null;
    const remaining = Math.max(0, OTP_MAX_ATTEMPTS - newCount);

    // Persist the failure. If the update itself errors we still want to
    // return 401 — but we surface the audit so operators can debug.
    try {
      await supabaseAdmin
        .from('link_code_otp_challenges')
        .update({
          attempt_count: newCount,
          locked_until: lockedUntil ? lockedUntil.toISOString() : null,
        })
        .eq('id', challenge.id);
    } catch (err) {
      logger.error('link_code_otp_redeem_attempt_increment_failed', {
        error: err instanceof Error ? err : new Error(String(err)),
        challenge_id: challenge.id,
      });
    }

    await audit(
      user.id,
      shouldLock ? 'link_code_otp_redeem_locked_now' : 'link_code_otp_redeem_wrong',
      ip,
      userAgent,
      {
        challenge_id: challenge.id,
        attempt_count: newCount,
        remaining_attempts: remaining,
      }
    );

    if (shouldLock && lockedUntil) {
      const retryAfterSec = Math.ceil((lockedUntil.getTime() - Date.now()) / 1000);
      return NextResponse.json(
        {
          success: false,
          error: 'Too many incorrect attempts. Try again later.',
          locked_until: lockedUntil.toISOString(),
        },
        { status: 423, headers: { 'Retry-After': String(retryAfterSec) } }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: 'Incorrect code.',
        remaining_attempts: remaining,
      },
      { status: 401 }
    );
  }

  // ── 6. Resolve the guardian for the auth user ─────────────────────────
  let guardianId: string | null = null;
  try {
    const { data: guardian } = await supabaseAdmin
      .from('guardians')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    guardianId = (guardian?.id as string | undefined) ?? null;
  } catch (err) {
    logger.error('link_code_otp_redeem_guardian_lookup_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }
  if (!guardianId) {
    await audit(user.id, 'link_code_otp_redeem_no_guardian_profile', ip, userAgent, {
      challenge_id: challenge.id,
    });
    return NextResponse.json(
      { success: false, error: 'No guardian profile. Complete signup first.' },
      { status: 403 }
    );
  }

  // ── 7. Perform the actual link via the existing RPC ───────────────────
  // The RPC handles "already linked", invalid-code, etc. We trust it for
  // the canonical write — this route owns 2FA, not the link-create logic.
  let rpcResult: { success?: boolean; error?: string; student_name?: string; student_grade?: string } = {};
  try {
    const { data, error } = await supabaseAdmin.rpc('link_guardian_to_student_via_code', {
      p_guardian_id: guardianId,
      p_invite_code: linkCode,
    });
    if (error) throw error;
    rpcResult = (data ?? {}) as typeof rpcResult;
  } catch (err) {
    logger.error('link_code_otp_redeem_rpc_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      challenge_id: challenge.id,
    });
    await audit(user.id, 'link_code_otp_redeem_rpc_failure', ip, userAgent, {
      challenge_id: challenge.id,
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Unable to complete link. Please try again.' },
      { status: 500 }
    );
  }

  // RPC reported a domain-level failure (invalid code, already linked).
  // Don't burn the challenge — let the user retry without re-requesting
  // an OTP. The 5-attempt counter still applies via the wrong-OTP path.
  if (rpcResult.error) {
    await audit(user.id, 'link_code_otp_redeem_rpc_rejected', ip, userAgent, {
      challenge_id: challenge.id,
      reason: rpcResult.error,
    });
    return NextResponse.json(
      { success: false, error: rpcResult.error },
      { status: 409 }
    );
  }

  // ── 8. Success — burn the challenge and audit ─────────────────────────
  // Delete the challenge so the OTP can never be reused. Best-effort: if
  // delete fails, the trigger / TTL still bounds the row, so we don't
  // hold up the success response.
  try {
    await supabaseAdmin.from('link_code_otp_challenges').delete().eq('id', challenge.id);
  } catch { /* swept by trigger */ }

  await audit(user.id, 'link_code_otp_redeem_success', ip, userAgent, {
    challenge_id: challenge.id,
    student_id: challenge.student_id,
  });

  return NextResponse.json({
    success: true,
    linked: true,
    student_name: rpcResult.student_name ?? null,
    student_grade: rpcResult.student_grade ?? null,
  });
}
