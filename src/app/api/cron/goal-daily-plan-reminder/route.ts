/**
 * POST /api/cron/goal-daily-plan-reminder
 *
 * Phase 5 of Goal-Adaptive Learning Layers - daily plan reminder
 * notification cron entrypoint.
 *
 * Behavior:
 *   1. Verifies CRON_SECRET (constant-time comparison) - returns 401 otherwise.
 *   2. Evaluates ff_goal_daily_plan_reminder via the global flag system.
 *      When OFF, returns 200 with { sent: 0, reason: "flag_off" } and exits.
 *   3. Reads all active students with academic_goal IS NOT NULL.
 *   4. Builds a per-student reminder payload via buildDailyPlanReminderPayload.
 *   5. Bulk-inserts the payloads into the notifications table.
 *   6. Returns { sent, skipped, total, durationMs }.
 *
 * Auth: x-cron-secret header (Vercel Cron sets it via cron config) or
 * Authorization Bearer. Mirrors src/app/api/cron/evaluate-alerts/route.ts.
 *
 * P-invariants:
 *   - P9 server-side enforcement via constant-time secret check.
 *   - P12 not applicable (non-AI cron).
 *   - P13 logger emits aggregate counts only - no studentId UUIDs in logs.
 *   - P14 chains: backend (cron) + frontend (notifications page renders these
 *     through the existing in_app channel) + ops (rollout monitoring).
 *
 * Owner: backend
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { logger } from '@/lib/logger';
import { buildDailyPlanReminderPayload } from '@/lib/notifications/goal-daily-plan-reminder';

export const runtime = 'nodejs';
export const maxDuration = 60;

function verifyCronSecret(req: NextRequest): boolean {
  const secret =
    req.headers.get('x-cron-secret') ||
    req.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  if (!expected || !secret || secret.length !== expected.length) return false;
  let m = 0;
  for (let i = 0; i < secret.length; i++) m |= secret.charCodeAt(i) ^ expected.charCodeAt(i);
  return m === 0;
}

interface CronResult {
  sent: number;
  skipped: number;
  total: number;
  durationMs: number;
  reason?: string;
}

export async function POST(request: NextRequest) {
  const started = Date.now();
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Flag gate (deterministic per-server, no userId scoping at the cron level).
  const flagOn = await isFeatureEnabled('ff_goal_daily_plan_reminder', {
    role: 'system',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
  });
  if (!flagOn) {
    const result: CronResult = {
      sent: 0, skipped: 0, total: 0,
      durationMs: Date.now() - started,
      reason: 'flag_off',
    };
    logger.info("cron.goal-daily-plan-reminder.flag_off", { ...result });
    return NextResponse.json(result);
  }

  // Pull active students with a known academic_goal.
  const { data: students, error: fetchError } = await supabaseAdmin
    .from('students')
    .select('id, academic_goal')
    .eq('is_active', true)
    .is('deleted_at', null)
    .not('academic_goal', 'is', null);

  if (fetchError) {
    logger.error('cron.goal-daily-plan-reminder.fetch_error', {
      error: fetchError.message,
    });
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }

  const total = (students ?? []).length;
  const payloads: ReturnType<typeof buildDailyPlanReminderPayload>[] = [];

  for (const s of students ?? []) {
    const payload = buildDailyPlanReminderPayload({
      studentId: s.id as string,
      goalCode: s.academic_goal as string | null,
    });
    if (payload) payloads.push(payload);
  }

  const valid = payloads.filter((p): p is NonNullable<typeof p> => p !== null);
  const skipped = total - valid.length;

  if (valid.length === 0) {
    const result: CronResult = {
      sent: 0, skipped, total,
      durationMs: Date.now() - started,
      reason: 'no_eligible_students',
    };
    logger.info("cron.goal-daily-plan-reminder.no_eligible", { ...result });
    return NextResponse.json(result);
  }

  // Idempotency: skip when a daily_plan_reminder already exists for this
  // student today (UTC). Cheaper than a unique constraint and matches the
  // parent_digest pattern in daily-cron Edge Function.
  const todayStartUtc = new Date();
  todayStartUtc.setUTCHours(0, 0, 0, 0);
  const recipients = valid.map((p) => p.recipient_id);
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('notifications')
    .select('recipient_id')
    .in('recipient_id', recipients)
    .eq('type', 'daily_plan_reminder')
    .gte('created_at', todayStartUtc.toISOString());
  if (existingErr) {
    logger.warn('cron.goal-daily-plan-reminder.existing_check_failed', {
      error: existingErr.message,
    });
  }
  const alreadyToday = new Set((existing ?? []).map((r) => r.recipient_id as string));
  const toInsert = valid.filter((p) => !alreadyToday.has(p.recipient_id));

  if (toInsert.length === 0) {
    const result: CronResult = {
      sent: 0,
      skipped: total,
      total,
      durationMs: Date.now() - started,
      reason: 'all_already_sent_today',
    };
    logger.info("cron.goal-daily-plan-reminder.all_already_sent", { ...result });
    return NextResponse.json(result);
  }

  const { error: insertError } = await supabaseAdmin
    .from('notifications')
    .insert(toInsert);

  if (insertError) {
    logger.error('cron.goal-daily-plan-reminder.insert_error', {
      error: insertError.message,
      attempted: toInsert.length,
    });
    return NextResponse.json({ error: 'insert_failed', detail: insertError.message }, { status: 500 });
  }

  const result: CronResult = {
    sent: toInsert.length,
    skipped: total - toInsert.length,
    total,
    durationMs: Date.now() - started,
  };
  logger.info("cron.goal-daily-plan-reminder.success", { ...result });
  return NextResponse.json(result);
}
