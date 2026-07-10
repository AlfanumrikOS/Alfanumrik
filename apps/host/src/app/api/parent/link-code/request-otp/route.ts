/**
 * POST /api/parent/link-code/request-otp — Phase D.4.
 *
 * Step 1 of the 2FA-protected guardian-link flow. The signed-in guardian
 * submits the short link-code their student gave them; if the code resolves
 * to a real student, we email a fresh 6-digit OTP to the guardian's
 * authenticated email and stash a challenge row.
 *
 * Security posture:
 *
 *   - We return `{ success: true, otp_sent: true }` regardless of whether
 *     the link code matched a real student. Leaking existence/non-existence
 *     would let an attacker enumerate valid invite codes by polling this
 *     route. The cost is a slightly worse UX on typos (user clicks "Resend"
 *     before learning their code is wrong) — but the alternative gives away
 *     the keyring.
 *
 *   - Per-IP rate limit: 5 requests/hour. Tight enough to bound enumeration
 *     attempts, loose enough that families on shared NAT (school WiFi,
 *     home routers) aren't locked out. The IP is the X-Forwarded-For first
 *     hop; on Vercel that's the real client IP.
 *
 *   - Per-(link_code, auth_user_id) resend cooldown: 1 send/minute. Stops
 *     a malicious actor (or buggy client) from spamming the user's inbox.
 *
 *   - The OTP itself never leaves the server in cleartext; we store only
 *     `sha256(otp || row_id)` and email the OTP. See lib/link-code-otp.ts.
 *
 *   - In dev (NODE_ENV !== 'production') we ALSO return `otp_dev` in the
 *     response body so e2e tests / local development can complete the flow
 *     without mailgun. The hard rule is: never branch on this in production
 *     code — the bypass is purely additive in dev.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { logger } from '@alfanumrik/lib/logger';
import { normalizeIP, isValidLinkCode } from '@alfanumrik/lib/sanitize';
import { deliverEmail, pickLocaleFromAcceptLanguage } from '@alfanumrik/lib/email-delivery';
import { checkApiRateLimit } from '@alfanumrik/lib/api-rate-limit';
import {
  generateOtp,
  hashOtp,
  computeOtpExpiry,
  REQUEST_OTP_IP_LIMIT,
  REQUEST_OTP_IP_WINDOW_MS,
} from '@alfanumrik/lib/link-code-otp';

type RequestOtpRpcResult = {
  success?: boolean;
  should_send_email?: boolean;
  challenge_id?: string;
  student_name?: string | null;
  error?: string;
};

/**
 * Constant-shape success response. Used for every code path that surfaces
 * "OTP requested" externally — including the no-match path that quietly
 * skips the email. Keeps the response indistinguishable to an attacker.
 */
function silentSuccess(extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ success: true, otp_sent: true, ...(extra ?? {}) });
}

export async function POST(request: NextRequest) {
  const ip = normalizeIP(request);
  const userAgent = request.headers.get('user-agent');
  const isProd = process.env.NODE_ENV === 'production';

  // ── 1. Per-IP rate limit ──────────────────────────────────────────────
  // Apply BEFORE we touch the DB so a noisy IP can't tax the cluster.
  const rl = await checkApiRateLimit(
    `link-code-otp-request:${ip}`,
    REQUEST_OTP_IP_LIMIT,
    REQUEST_OTP_IP_WINDOW_MS
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
  // The guardian must be signed in. We email the OTP to their session
  // email — there is no other email "tied to" a verbal/SMS-shared invite
  // code, and the guardian's session email is the only one we can trust.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser();
  if (sessionError || !user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // ── 3. Parse body ─────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  const linkCodeRaw = body && typeof body === 'object' ? (body as Record<string, unknown>).link_code : undefined;
  if (typeof linkCodeRaw !== 'string' || linkCodeRaw.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: 'link_code is required' },
      { status: 400 }
    );
  }
  const linkCode = linkCodeRaw.trim().toUpperCase();

  // PP-2: strict charset validation BEFORE the code is interpolated into the
  // PostgREST `.or()` filter below (filter-injection guard). A malformed code
  // can never match a real student, so treat it exactly like the no-match
  // path — same silent-success shape, so an attacker can't distinguish a
  // rejected-format probe from a valid-but-unknown code (enumeration-safe).
  if (!isValidLinkCode(linkCode)) {
    return silentSuccess();
  }

  // ── 4. Ask the scoped RPC to resolve code, enforce cooldown, and insert
  //        the challenge row. The route keeps OTP generation/email only.
  const otp = generateOtp();
  const challengeId = randomUUID();
  const expiresAt = computeOtpExpiry();
  const otpHash = hashOtp(otp, challengeId);

  let rpcResult: RequestOtpRpcResult = {};
  try {
    const { data, error } = await supabase.rpc('parent_request_link_code_otp', {
      p_link_code: linkCode,
      p_challenge_id: challengeId,
      p_otp_hash: otpHash,
      p_expires_at: expiresAt.toISOString(),
      p_ip_address: ip,
      p_user_agent: userAgent,
    });
    if (error) throw error;
    rpcResult = (data ?? {}) as RequestOtpRpcResult;
  } catch (err) {
    logger.error('link_code_otp_request_rpc_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return silentSuccess();
  }

  if (rpcResult.success !== true || !rpcResult.should_send_email) {
    return silentSuccess();
  }

  // ── 5. Send email (fire-and-forget) ───────────────────────────────────
  // The guardian's email comes from their auth session — that's the only
  // address we know they own. NOTE: deliverEmail() never throws.
  const locale = pickLocaleFromAcceptLanguage(request.headers.get('accept-language'));
  const recipientEmail = user.email ?? '';

  if (recipientEmail) {
    void deliverEmail({
      template: 'parent-link-code-otp',
      to: recipientEmail,
      locale,
      params: {
        otp,
        idempotency_key: rpcResult.challenge_id ?? challengeId,
        recipient_name: rpcResult.student_name ? `parent of ${rpcResult.student_name}` : undefined,
      },
    });
  } else {
    logger.warn('link_code_otp_request_no_session_email', {
      authUserIdPrefix: user.id.slice(0, 8),
    });
  }

  // Dev escape hatch: surfaces the OTP in the response so e2e tests don't
  // need to scrape mailgun. NEVER active in production.
  return silentSuccess(isProd ? undefined : { otp_dev: otp });
}
