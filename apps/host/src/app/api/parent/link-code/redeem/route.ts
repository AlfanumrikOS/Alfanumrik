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
import { logger } from '@alfanumrik/lib/logger';
import { normalizeIP } from '@alfanumrik/lib/sanitize';
import { checkApiRateLimit } from '@alfanumrik/lib/api-rate-limit';
import {
  REDEEM_IP_LIMIT,
  REDEEM_IP_WINDOW_MS,
} from '@alfanumrik/lib/link-code-otp';

type RedeemRpcResult = {
  success?: boolean;
  linked?: boolean;
  error_code?: string;
  error?: string;
  remaining_attempts?: number;
  locked_until?: string;
  retry_after_seconds?: number;
  student_name?: string | null;
  student_grade?: string | null;
};

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

  // ── 4. Redeem through an auth.uid()-scoped DB boundary ─────────────────
  let result: RedeemRpcResult = {};
  try {
    const { data, error } = await supabase.rpc('parent_redeem_link_code_otp', {
      p_link_code: linkCode,
      p_otp: otp,
      p_ip_address: ip,
      p_user_agent: userAgent,
    });
    if (error) throw error;
    result = (data ?? {}) as RedeemRpcResult;
  } catch (err) {
    logger.error('link_code_otp_redeem_rpc_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: 'Unable to complete link. Please try again.' },
      { status: 500 }
    );
  }

  if (result.success === true) {
    return NextResponse.json(
      {
        success: true,
        linked: true,
        student_name: result.student_name ?? null,
        student_grade: result.student_grade ?? null,
      }
    );
  }

  const error = result.error ?? 'Unable to complete link. Please try again.';

  if (result.error_code === 'locked') {
    const retryAfter = String(result.retry_after_seconds ?? 3600);
    return NextResponse.json(
      { success: false, error, locked_until: result.locked_until },
      { status: 423, headers: { 'Retry-After': retryAfter } }
    );
  }

  if (result.error_code === 'wrong_otp') {
    return NextResponse.json(
      { success: false, error, remaining_attempts: result.remaining_attempts ?? 0 },
      { status: 401 }
    );
  }

  if (result.error_code === 'expired' || result.error_code === 'no_challenge') {
    return NextResponse.json({ success: false, error }, { status: 401 });
  }

  if (result.error_code === 'no_guardian') {
    return NextResponse.json({ success: false, error }, { status: 403 });
  }

  if (result.error_code === 'domain_rejected') {
    return NextResponse.json({ success: false, error }, { status: 409 });
  }

  return NextResponse.json({ success: false, error }, { status: 500 });
}
