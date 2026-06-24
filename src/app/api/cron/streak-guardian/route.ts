// src/app/api/cron/streak-guardian/route.ts
//
// Streak-Guardian cron worker — fires nightly to send an in-app notification
// to every student whose challenge streak is at risk (streak > 3 AND they
// have not completed a challenge today).
//
//   POST (no body required)
//
// Invoked nightly by the daily-cron Edge Function or Vercel cron config.
//
// Security (P9, REG-127 posture): fail-closed CRON_SECRET gate BEFORE any
// DB I/O. Accepts `x-cron-secret` or `Authorization: Bearer`.
//
// P13: response body carries only aggregate counts — no student identifiers.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isFeatureEnabled } from '@/lib/feature-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Flag name for this cron's kill switch. Default OFF until seeded. */
const FLAG_NAME = 'ff_streak_guardian_cron_v1';

/** Only students with a streak above this threshold get a warning notification. */
const STREAK_VISIBILITY_THRESHOLD = 3;

/** Generic 500 body — never echo internal error details to the caller. */
const GENERIC_500_BODY = 'internal';

// ════════════════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════════════════

export async function POST(request: NextRequest): Promise<Response> {
  // Fail-closed auth gate — BEFORE any DB I/O (REG-127 posture).
  const secret =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace('Bearer ', '');

  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Feature-flag gate. If the flag is OFF, skip gracefully.
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV;
  const flagOn = await isFeatureEnabled(FLAG_NAME, { environment });
  if (!flagOn) {
    return NextResponse.json({ skipped: true, reason: 'flag_off' }, { status: 200 });
  }

  // Core logic — wrapped in try/catch so errors never leak internal details.
  try {
    // Find students with streak > threshold who have NOT submitted a challenge today.
    // challenge_streaks.last_challenge_date is a DATE column; compare to today's
    // UTC date-only boundary so students who played earlier today are excluded.
    const today = new Date();
    today.setHours(0, 0, 0, 0); // start of today UTC

    const { data: atRisk, error: queryErr } = await supabaseAdmin
      .from('challenge_streaks')
      .select('student_id, current_streak')
      .gt('current_streak', STREAK_VISIBILITY_THRESHOLD)
      .lt('last_challenge_date', today.toISOString());

    if (queryErr) {
      return NextResponse.json({ error: GENERIC_500_BODY }, { status: 500 });
    }

    const rows = atRisk ?? [];

    if (rows.length === 0) {
      return NextResponse.json({ count: 0 });
    }

    // Build notification rows — counts only in the response body (P13).
    const notifications = rows.map((row) => ({
      recipient_type: 'student',
      recipient_id: row.student_id,
      type: 'streak_at_risk',
      title: `🔥 ${row.current_streak}-Day Streak at Risk!`,
      title_hi: `🔥 ${row.current_streak} दिन की स्ट्रीक खतरे में!`,
      body: `You have a ${row.current_streak}-day streak. Study something today to keep it alive!`,
      body_hi: `आपकी ${row.current_streak} दिन की स्ट्रीक है। इसे बचाने के लिए आज कुछ पढ़ें!`,
      is_read: false,
      data: { trigger: 'streak_at_risk', streak_days: row.current_streak },
    }));

    const { error: insertErr } = await supabaseAdmin
      .from('notifications')
      .insert(notifications);

    if (insertErr) {
      return NextResponse.json({ error: GENERIC_500_BODY }, { status: 500 });
    }

    // P13: response carries count only, no student identifiers.
    return NextResponse.json({ count: notifications.length });
  } catch {
    return NextResponse.json({ error: GENERIC_500_BODY }, { status: 500 });
  }
}
