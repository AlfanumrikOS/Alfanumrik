/**
 * POST /api/whatsapp/link/start — begin binding a WhatsApp phone (Phase 2).
 *
 * Cookie-auth (same createSupabaseServerClient pattern as /api/rhythm/today):
 * the authenticated web session proves possession of the account; the inbound
 * `LINK <otp>` WhatsApp message (webhook LINK handler) proves possession of
 * the handset. This route creates the OTP challenge and hands the browser a
 * wa.me deep link that pre-fills the message.
 *
 * ── Request / response contract (consumed by /settings/whatsapp) ────────────
 *   POST body (optional): { role?: 'student' | 'guardian' }   default 'student'
 *   200 → { otp: string, deep_link: string, expires_at: string(ISO) }
 *   400 → { error: 'invalid_role' }
 *   401 → { error: 'unauthenticated' }
 *   403 → { error: 'parental_consent_required' }   (students only — DPDP gate;
 *          the settings page renders parental-consent guidance)
 *   404 → { error: 'not_found' }                   (ff_whatsapp_bot_v1 OFF)
 *   404 → { error: 'no_student_profile' | 'no_guardian_profile' }
 *   429 → { error: 'rate_limited', retry_after_ms: number }
 *   500 → { error: 'internal_error' }
 *   503 → { error: 'not_configured' }              (env missing)
 *
 * ── DPDP minor gate (LOCKED decision #1, 2026-07-29) ────────────────────────
 * For students: age is computed from students.date_of_birth; a student whose
 * age is < 18 OR whose date_of_birth is NULL (fail-closed — this is a K-12
 * population) requires a live public.parental_consent row (revoked_at IS
 * NULL) before a challenge is issued. Guardians skip this gate.
 *
 * ── Rate limit ──────────────────────────────────────────────────────────────
 * RESEND_COOLDOWN_MS (link-code-otp.ts) between challenges per auth user,
 * enforced against the newest whatsapp_link_challenges.created_at.
 *
 * ── ENV VARS ────────────────────────────────────────────────────────────────
 *   WHATSAPP_BUSINESS_NUMBER  The bot's WhatsApp number. Digits are extracted
 *                             for the wa.me deep link ('+91 98765 43210',
 *                             '+919876543210' and '919876543210' all work).
 *
 * ── Crypto note ─────────────────────────────────────────────────────────────
 * hashOtp(otp, salt) salts with the challenge ROW ID, so the id is generated
 * here via crypto.randomUUID() and the row is INSERTed exactly once with the
 * final hash — no placeholder-then-UPDATE window.
 *
 * P13: the OTP is returned to the authenticated caller ONLY. It is never
 * logged, never stored in plaintext (otp_hash only), and never sent to Sentry.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { logger } from '@alfanumrik/lib/logger';
import {
  generateOtp,
  hashOtp,
  computeOtpExpiry,
  RESEND_COOLDOWN_MS,
} from '@alfanumrik/lib/link-code-otp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Age in whole years from a `date` column value ('YYYY-MM-DD'). Unparseable
 * input returns 0 — i.e. fail-closed into the minor gate.
 */
function computeAgeYears(dobRaw: string, now: Date): number {
  const dob = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(dobRaw) ? `${dobRaw}T00:00:00Z` : dobRaw,
  );
  if (Number.isNaN(dob.getTime())) return 0;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 0. Env — the deep link is the whole point of this route.
  const waDigits = (process.env.WHATSAPP_BUSINESS_NUMBER ?? '').replace(/\D/g, '');
  if (!waDigits) {
    logger.error('whatsapp link/start: WHATSAPP_BUSINESS_NUMBER not configured');
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  // 1. Cookie auth (house pattern — /api/rhythm/today).
  const supabase = await createSupabaseServerClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  // 2. Master kill switch — no point issuing challenges the webhook will
  //    never process (with the flag OFF, inbound LINK events are persisted
  //    as status='ignored').
  if (!(await isFeatureEnabled('ff_whatsapp_bot_v1'))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // 3. Body: { role?: 'student' | 'guardian' }, default 'student'. An empty
  //    or non-JSON body is tolerated (defaults apply).
  let role: 'student' | 'guardian' = 'student';
  try {
    const body = (await request.json()) as { role?: unknown } | null;
    if (body && body.role !== undefined) {
      if (body.role !== 'student' && body.role !== 'guardian') {
        return NextResponse.json({ error: 'invalid_role' }, { status: 400 });
      }
      role = body.role;
    }
  } catch {
    // no/invalid body → default role
  }

  // 4. Resolve the principal by auth_user_id.
  let studentId: string | null = null;
  let guardianId: string | null = null;

  if (role === 'student') {
    // RLS-scoped session client — student reads own row (rhythm pattern).
    const { data: studentRow, error: studentErr } = await supabase
      .from('students')
      .select('id, date_of_birth')
      .eq('auth_user_id', userId)
      .maybeSingle();
    if (studentErr) {
      logger.error('whatsapp link/start: student lookup failed', {
        userId,
        error: studentErr.message,
      });
      return NextResponse.json({ error: 'internal_error' }, { status: 500 });
    }
    if (!studentRow) {
      return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
    }
    studentId = studentRow.id as string;

    // 4a. DPDP minor gate (LOCKED decision #1). Fail-closed: a NULL DOB is
    //     treated as under-18 (K-12 population).
    const dob = studentRow.date_of_birth as string | null;
    const isMinor = !dob || computeAgeYears(dob, new Date()) < 18;
    if (isMinor) {
      // parental_consent RLS is guardian-scoped; the student-side check runs
      // through the admin client (server-only; existence check, no payload).
      const { data: consentRow, error: consentErr } = await supabaseAdmin
        .from('parental_consent')
        .select('id')
        .eq('student_id', studentId)
        .is('revoked_at', null)
        .limit(1)
        .maybeSingle();
      if (consentErr) {
        logger.error('whatsapp link/start: parental_consent lookup failed', {
          userId,
          error: consentErr.message,
        });
        return NextResponse.json({ error: 'internal_error' }, { status: 500 });
      }
      if (!consentRow) {
        return NextResponse.json(
          { error: 'parental_consent_required' },
          { status: 403 },
        );
      }
    }
  } else {
    // Guardian row via the admin client (guardians has no proven self-read
    // policy; the auth_user_id equality IS the boundary here, server-side).
    const { data: guardianRow, error: guardianErr } = await supabaseAdmin
      .from('guardians')
      .select('id')
      .eq('auth_user_id', userId)
      .maybeSingle();
    if (guardianErr) {
      logger.error('whatsapp link/start: guardian lookup failed', {
        userId,
        error: guardianErr.message,
      });
      return NextResponse.json({ error: 'internal_error' }, { status: 500 });
    }
    if (!guardianRow) {
      return NextResponse.json({ error: 'no_guardian_profile' }, { status: 404 });
    }
    guardianId = guardianRow.id as string;
  }

  // 5. Rate limit: RESEND_COOLDOWN_MS between challenges per auth user.
  const { data: latestChallenge, error: rlErr } = await supabaseAdmin
    .from('whatsapp_link_challenges')
    .select('created_at')
    .eq('auth_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rlErr) {
    logger.error('whatsapp link/start: rate-limit lookup failed', {
      userId,
      error: rlErr.message,
    });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
  if (latestChallenge?.created_at) {
    const elapsedMs = Date.now() - new Date(latestChallenge.created_at as string).getTime();
    // Fail closed on clock skew: a future-dated challenge means state we can't reason about.
    if (elapsedMs < 0) {
      return NextResponse.json(
        { error: 'rate_limited', retry_after_ms: RESEND_COOLDOWN_MS },
        { status: 429 },
      );
    }
    if (elapsedMs < RESEND_COOLDOWN_MS) {
      return NextResponse.json(
        { error: 'rate_limited', retry_after_ms: RESEND_COOLDOWN_MS - elapsedMs },
        { status: 429 },
      );
    }
  }

  // 6. Create the challenge — id generated here so hashOtp can salt with it
  //    and the row is inserted exactly once (see header).
  const challengeId = randomUUID();
  const otp = generateOtp();
  const expiresAt = computeOtpExpiry();

  const { error: insErr } = await supabaseAdmin
    .from('whatsapp_link_challenges')
    .insert({
      id: challengeId,
      auth_user_id: userId,
      student_id: studentId,
      guardian_id: guardianId,
      role,
      otp_hash: hashOtp(otp, challengeId),
      expires_at: expiresAt.toISOString(),
    });
  if (insErr) {
    // P13: never log the OTP.
    logger.error('whatsapp link/start: challenge insert failed', {
      userId,
      error: insErr.message,
    });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  return NextResponse.json({
    otp,
    deep_link: `https://wa.me/${waDigits}?text=${encodeURIComponent(`LINK ${otp}`)}`,
    expires_at: expiresAt.toISOString(),
  });
}
