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
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { normalizeIP, isValidLinkCode } from '@/lib/sanitize';
import { deliverEmail, pickLocaleFromAcceptLanguage } from '@/lib/email-delivery';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import {
  generateOtp,
  hashOtp,
  computeOtpExpiry,
  REQUEST_OTP_IP_LIMIT,
  REQUEST_OTP_IP_WINDOW_MS,
  RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
} from '@/lib/link-code-otp';

/**
 * Helper: write a row to auth_audit_log without ever throwing — audit
 * failures must not block the user-visible response.
 */
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
    await audit(null, 'link_code_otp_request_rate_limited', ip, userAgent, {
      limit: REQUEST_OTP_IP_LIMIT,
      windowMs: REQUEST_OTP_IP_WINDOW_MS,
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
    await audit(user.id, 'link_code_otp_request_invalid_format', ip, userAgent, {
      link_code_prefix: linkCode.slice(0, 2),
      length: linkCode.length,
    });
    return silentSuccess();
  }

  // ── 4. Resolve link code → student (best-effort, no leakage) ──────────
  // We accept either students.invite_code OR students.link_code, matching
  // the production link_guardian_via_invite_code RPC. If neither matches,
  // we still return success — see route doc comment.
  let studentId: string | null = null;
  let studentName: string | null = null;
  try {
    const { data: student } = await supabaseAdmin
      .from('students')
      .select('id, name, invite_code, link_code, is_active')
      .or(`invite_code.eq.${linkCode},link_code.eq.${linkCode}`)
      .eq('is_active', true)
      .maybeSingle();
    if (student) {
      studentId = student.id as string;
      studentName = (student.name as string | null) ?? null;
    }
  } catch (err) {
    logger.warn('link_code_otp_request_student_lookup_failed', {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  if (!studentId) {
    // No match. Audit the attempt (so operators can spot brute-force
    // patterns) but return the same shape as the happy path so the
    // attacker can't tell the difference.
    await audit(user.id, 'link_code_otp_request_no_match', ip, userAgent, {
      link_code_prefix: linkCode.slice(0, 2),
    });
    return silentSuccess();
  }

  // ── 5. Resend cooldown (per (link_code, auth_user_id)) ────────────────
  // We look up the most recent active challenge for this pair. If one was
  // created within RESEND_COOLDOWN_MS, we silently no-op — same response
  // shape as a fresh send.
  try {
    const cooldownIso = new Date(Date.now() - RESEND_COOLDOWN_MS).toISOString();
    const { data: recent } = await supabaseAdmin
      .from('link_code_otp_challenges')
      .select('id, created_at')
      .eq('link_code', linkCode)
      .eq('auth_user_id', user.id)
      .gte('created_at', cooldownIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent) {
      await audit(user.id, 'link_code_otp_request_cooldown_skip', ip, userAgent, {
        challenge_id: recent.id,
      });
      return silentSuccess();
    }
  } catch (err) {
    logger.warn('link_code_otp_request_cooldown_check_failed', {
      reason: err instanceof Error ? err.message : String(err),
    });
    // Fall through: better to risk a duplicate send than block legitimate users.
  }

  // ── 6. Create challenge row ───────────────────────────────────────────
  // We insert FIRST so we have the row id to use as the per-row salt. The
  // alternative — generate-hash-then-insert — would force a separate salt
  // column and one more random source. Doing it this way keeps the schema
  // narrow without weakening the salt (a UUID is 122 bits of entropy).
  const otp = generateOtp();
  const expiresAt = computeOtpExpiry();

  let challengeId: string | null = null;
  try {
    // Step 6a: pre-allocate the row with a placeholder hash. We use a
    // sentinel that no real hashOtp() output can collide with so verify()
    // never accidentally accepts it.
    const placeholder = 'pending';
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('link_code_otp_challenges')
      .insert({
        link_code: linkCode,
        auth_user_id: user.id,
        student_id: studentId,
        otp_hash: placeholder,
        expires_at: expiresAt.toISOString(),
        attempt_count: 0,
      })
      .select('id')
      .single();
    if (insertErr || !inserted) {
      throw new Error(insertErr?.message ?? 'no row returned');
    }
    challengeId = inserted.id as string;

    // Step 6b: write the real hash now that we have the row id (= salt).
    const realHash = hashOtp(otp, challengeId);
    const { error: updateErr } = await supabaseAdmin
      .from('link_code_otp_challenges')
      .update({ otp_hash: realHash })
      .eq('id', challengeId);
    if (updateErr) {
      throw new Error(updateErr.message);
    }
  } catch (err) {
    logger.error('link_code_otp_request_challenge_insert_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    // Best-effort cleanup of the placeholder row if step 6b failed.
    if (challengeId) {
      try {
        await supabaseAdmin.from('link_code_otp_challenges').delete().eq('id', challengeId);
      } catch { /* ignore — janitor trigger will eventually sweep */ }
    }
    // Hard failure here is worth surfacing — the OTP wasn't issued. Use
    // 200 + sent:false so the UI doesn't expose an error path that leaks
    // 'code matched but server is broken'. The caller logs it.
    return silentSuccess();
  }

  // ── 7. Send email (fire-and-forget) ───────────────────────────────────
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
        idempotency_key: challengeId,
        recipient_name: studentName ? `parent of ${studentName}` : undefined,
      },
    });
  } else {
    logger.warn('link_code_otp_request_no_session_email', {
      authUserIdPrefix: user.id.slice(0, 8),
    });
  }

  await audit(user.id, 'link_code_otp_request_success', ip, userAgent, {
    challenge_id: challengeId,
    student_id: studentId,
    ttl_ms: OTP_TTL_MS,
  });

  // Dev escape hatch: surfaces the OTP in the response so e2e tests don't
  // need to scrape mailgun. NEVER active in production.
  return silentSuccess(isProd ? undefined : { otp_dev: otp });
}
