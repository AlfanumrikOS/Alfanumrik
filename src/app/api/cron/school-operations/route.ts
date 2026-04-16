import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * POST /api/cron/school-operations
 *
 * Daily B2B cron job — runs at 2:00 AM UTC (7:30 AM IST) via Vercel Cron.
 *
 * Steps:
 *   1. Daily seat usage snapshot (every run)
 *   2. Monthly invoice generation (1st of each month only)
 *   3. Contract renewal reminders (30/14/7 days out)
 *   4. Seat limit alerts (80%/90%/100% thresholds)
 *
 * Auth: CRON_SECRET header (not user auth — this is a scheduled job).
 * Idempotent: safe to run multiple times on the same day (upsert + duplicate checks).
 * P13: no PII in logs — only school IDs and aggregate counts.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

// ─── Constants ───────────────────────────────────────────────────────────────

const BATCH_SIZE = 50;

interface CronSummary {
  schools_processed: number;
  snapshots_created: number;
  invoices_generated: number;
  reminders_sent: number;
  alerts_created: number;
  errors: string[];
}

// ─── Types for DB rows ──────────────────────────────────────────────────────

interface SchoolSubscription {
  id: string;
  school_id: string;
  plan: string;
  seats_purchased: number;
  price_per_seat_monthly: number;
  status: string;
  current_period_end: string | null;
}

interface SchoolWithSub {
  schoolId: string;
  sub: SchoolSubscription;
  activeStudents: number;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function verifyCronSecret(request: NextRequest): boolean {
  const cronSecret =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  if (!expected || !cronSecret) return false;
  // Constant-time comparison to prevent timing attacks
  if (cronSecret.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < cronSecret.length; i++) {
    mismatch |= cronSecret.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── Step 1: Daily Seat Usage Snapshot ──────────────────────────────────────

async function createSeatSnapshots(
  schools: SchoolWithSub[],
  today: string,
  summary: CronSummary,
): Promise<void> {
  const admin = getSupabaseAdmin();

  for (let i = 0; i < schools.length; i += BATCH_SIZE) {
    const batch = schools.slice(i, i + BATCH_SIZE);
    const rows = batch.map((s) => ({
      school_id: s.schoolId,
      snapshot_date: today,
      active_students: s.activeStudents,
      seats_purchased: s.sub.seats_purchased,
      utilization_pct: s.sub.seats_purchased > 0
        ? Math.round((s.activeStudents / s.sub.seats_purchased) * 100)
        : 0,
    }));

    const { error } = await admin
      .from('school_seat_usage')
      .upsert(rows, { onConflict: 'school_id,snapshot_date' });

    if (error) {
      logger.error('cron/school-operations: seat snapshot upsert failed', {
        error: new Error(error.message),
        batchIndex: i,
        batchSize: batch.length,
      });
      summary.errors.push(`seat_snapshot_batch_${i}: ${error.message}`);
    } else {
      summary.snapshots_created += rows.length;
    }
  }
}

// ─── Step 2: Invoice Generation (1st of month only) ─────────────────────────

async function generateMonthlyInvoices(
  schools: SchoolWithSub[],
  summary: CronSummary,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const now = new Date();

  // Only generate invoices on the 1st of the month
  if (now.getUTCDate() !== 1) return;

  // Period = previous month
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const periodStart = lastMonth.toISOString().slice(0, 10); // YYYY-MM-DD
  const lastDayOfPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const periodEnd = lastDayOfPrevMonth.toISOString().slice(0, 10);

  for (let i = 0; i < schools.length; i += BATCH_SIZE) {
    const batch = schools.slice(i, i + BATCH_SIZE);
    const rows = [];

    for (const s of batch) {
      // Skip free/trial schools with zero price
      if (s.sub.price_per_seat_monthly <= 0) continue;

      const seatsUsed = s.activeStudents;
      const amountInr = seatsUsed * s.sub.price_per_seat_monthly;

      rows.push({
        school_id: s.schoolId,
        period_start: periodStart,
        period_end: periodEnd,
        seats_used: seatsUsed,
        amount_inr: amountInr,
        status: 'generated',
      });
    }

    if (rows.length === 0) continue;

    // Idempotent: uq_school_invoice_period prevents duplicates.
    // Use insert and ignore conflicts.
    const { error } = await admin
      .from('school_invoices')
      .insert(rows)
      .select('id');

    if (error) {
      // Unique constraint violation = already generated (idempotent)
      if (error.message.includes('duplicate') || error.message.includes('uq_school_invoice_period')) {
        logger.info('cron/school-operations: invoices already exist for period', {
          periodStart,
          periodEnd,
          batchIndex: i,
        });
      } else {
        logger.error('cron/school-operations: invoice generation failed', {
          error: new Error(error.message),
          batchIndex: i,
        });
        summary.errors.push(`invoice_batch_${i}: ${error.message}`);
      }
    } else {
      summary.invoices_generated += rows.length;
    }
  }
}

// ─── Step 3: Contract Renewal Reminders ─────────────────────────────────────

const RENEWAL_THRESHOLDS = [
  { days: 30, type: 'renewal_reminder_30', title: 'Contract renewal in 30 days' },
  { days: 14, type: 'renewal_reminder_14', title: 'Contract renewal in 14 days' },
  { days: 7, type: 'renewal_reminder_7', title: 'Contract renewal in 7 days' },
] as const;

async function sendRenewalReminders(
  schools: SchoolWithSub[],
  summary: CronSummary,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const now = new Date();

  for (const s of schools) {
    if (!s.sub.current_period_end) continue;

    const periodEnd = new Date(s.sub.current_period_end);
    const daysUntilEnd = Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    for (const threshold of RENEWAL_THRESHOLDS) {
      if (daysUntilEnd !== threshold.days) continue;

      // Check if reminder already sent (idempotent)
      const { data: existing } = await admin
        .from('notifications')
        .select('id')
        .eq('recipient_id', s.schoolId)
        .eq('recipient_type', 'school')
        .eq('type', threshold.type)
        .gte('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
        .limit(1);

      if (existing && existing.length > 0) continue;

      const { error } = await admin.from('notifications').insert({
        recipient_id: s.schoolId,
        recipient_type: 'school',
        type: threshold.type,
        title: threshold.title,
        body: `Your school subscription ends on ${periodEnd.toISOString().slice(0, 10)}. Please renew to maintain uninterrupted access.`,
        body_hi: `आपकी स्कूल सदस्यता ${periodEnd.toISOString().slice(0, 10)} को समाप्त हो रही है। निर्बाध पहुंच बनाए रखने के लिए कृपया नवीनीकरण करें।`,
        data: {
          school_id: s.schoolId,
          days_until_renewal: threshold.days,
          period_end: s.sub.current_period_end,
          trigger: 'cron_renewal_reminder',
        },
        is_read: false,
        created_at: new Date().toISOString(),
      });

      if (error) {
        logger.error('cron/school-operations: renewal reminder failed', {
          error: new Error(error.message),
          schoolId: s.schoolId,
          reminderType: threshold.type,
        });
        summary.errors.push(`renewal_${threshold.type}_${s.schoolId}: ${error.message}`);
      } else {
        summary.reminders_sent++;
      }
    }
  }
}

// ─── Step 4: Seat Limit Alerts ──────────────────────────────────────────────

const SEAT_THRESHOLDS = [
  { pct: 100, type: 'seat_limit_reached', title: 'Seat limit reached', superAdmin: true },
  { pct: 90, type: 'seat_approaching_critical', title: 'Seats 90% utilized', superAdmin: true },
  { pct: 80, type: 'seat_approaching_limit', title: 'Seats 80% utilized', superAdmin: false },
] as const;

async function sendSeatAlerts(
  schools: SchoolWithSub[],
  summary: CronSummary,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartISO = todayStart.toISOString();

  for (const s of schools) {
    if (s.sub.seats_purchased <= 0) continue;

    const utilizationPct = Math.round((s.activeStudents / s.sub.seats_purchased) * 100);

    // Find the highest applicable threshold
    const matchedThreshold = SEAT_THRESHOLDS.find((t) => utilizationPct >= t.pct);
    if (!matchedThreshold) continue;

    // Check if alert already sent today (idempotent)
    const { data: existing } = await admin
      .from('notifications')
      .select('id')
      .eq('recipient_id', s.schoolId)
      .eq('recipient_type', 'school')
      .eq('type', matchedThreshold.type)
      .gte('created_at', todayStartISO)
      .limit(1);

    if (existing && existing.length > 0) continue;

    // Alert for school admin
    const bodyEn = `Your school is using ${s.activeStudents}/${s.sub.seats_purchased} seats (${utilizationPct}%). ${
      utilizationPct >= 100
        ? 'New students cannot be added until you upgrade.'
        : 'Consider upgrading your plan to add more seats.'
    }`;
    const bodyHi = `आपका स्कूल ${s.activeStudents}/${s.sub.seats_purchased} सीटों का उपयोग कर रहा है (${utilizationPct}%)। ${
      utilizationPct >= 100
        ? 'अपग्रेड करने तक नए छात्र नहीं जोड़े जा सकते।'
        : 'अधिक सीटें जोड़ने के लिए अपनी योजना को अपग्रेड करने पर विचार करें।'
    }`;

    const { error: schoolErr } = await admin.from('notifications').insert({
      recipient_id: s.schoolId,
      recipient_type: 'school',
      type: matchedThreshold.type,
      title: matchedThreshold.title,
      body: bodyEn,
      body_hi: bodyHi,
      data: {
        school_id: s.schoolId,
        active_students: s.activeStudents,
        seats_purchased: s.sub.seats_purchased,
        utilization_pct: utilizationPct,
        trigger: 'cron_seat_alert',
      },
      is_read: false,
      created_at: new Date().toISOString(),
    });

    if (schoolErr) {
      logger.error('cron/school-operations: seat alert failed (school)', {
        error: new Error(schoolErr.message),
        schoolId: s.schoolId,
      });
      summary.errors.push(`seat_alert_school_${s.schoolId}: ${schoolErr.message}`);
    } else {
      summary.alerts_created++;
    }

    // Super admin alert for 90%+ thresholds
    if (matchedThreshold.superAdmin) {
      const { error: superErr } = await admin.from('notifications').insert({
        recipient_id: 'super_admin',
        recipient_type: 'super_admin',
        type: matchedThreshold.type,
        title: `[B2B Alert] ${matchedThreshold.title}`,
        body: `School ${s.schoolId} is at ${utilizationPct}% seat utilization (${s.activeStudents}/${s.sub.seats_purchased}).`,
        data: {
          school_id: s.schoolId,
          active_students: s.activeStudents,
          seats_purchased: s.sub.seats_purchased,
          utilization_pct: utilizationPct,
          trigger: 'cron_seat_alert_super_admin',
        },
        is_read: false,
        created_at: new Date().toISOString(),
      });

      if (superErr) {
        // Non-critical — log but don't add to errors
        logger.warn('cron/school-operations: super admin seat alert failed', {
          error: new Error(superErr.message),
          schoolId: s.schoolId,
        });
      } else {
        summary.alerts_created++;
      }
    }
  }
}

// ─── Main Handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Auth: verify CRON_SECRET
  if (!verifyCronSecret(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const startTime = Date.now();
  const summary: CronSummary = {
    schools_processed: 0,
    snapshots_created: 0,
    invoices_generated: 0,
    reminders_sent: 0,
    alerts_created: 0,
    errors: [],
  };

  try {
    const admin = getSupabaseAdmin();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // ── Fetch active school subscriptions ──
    // The school_subscriptions table may not exist yet in all environments.
    let subscriptions: SchoolSubscription[] = [];
    try {
      const { data, error } = await admin
        .from('school_subscriptions')
        .select('id, school_id, plan, seats_purchased, price_per_seat_monthly, status, current_period_end')
        .in('status', ['active', 'trial']);

      if (error) {
        // Table may not exist — graceful fallback
        logger.warn('cron/school-operations: school_subscriptions query failed (table may not exist)', {
          error: new Error(error.message),
        });
        return NextResponse.json({
          success: true,
          data: {
            ...summary,
            skipped: true,
            reason: 'school_subscriptions table not available',
            duration_ms: Date.now() - startTime,
          },
        });
      }

      subscriptions = (data ?? []) as SchoolSubscription[];
    } catch (err) {
      logger.warn('cron/school-operations: school_subscriptions fetch exception', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
      return NextResponse.json({
        success: true,
        data: {
          ...summary,
          skipped: true,
          reason: 'school_subscriptions table exception',
          duration_ms: Date.now() - startTime,
        },
      });
    }

    if (subscriptions.length === 0) {
      logger.info('cron/school-operations: no active school subscriptions found');
      return NextResponse.json({
        success: true,
        data: { ...summary, duration_ms: Date.now() - startTime },
      });
    }

    // ── Count active students per school (batched) ──
    const schoolIds = subscriptions.map((s) => s.school_id);
    const schoolStudentCounts = new Map<string, number>();

    for (let i = 0; i < schoolIds.length; i += BATCH_SIZE) {
      const batchIds = schoolIds.slice(i, i + BATCH_SIZE);
      const { data: students, error: studErr } = await admin
        .from('students')
        .select('school_id')
        .in('school_id', batchIds)
        .eq('is_active', true)
        .is('deleted_at', null);

      if (studErr) {
        logger.error('cron/school-operations: student count query failed', {
          error: new Error(studErr.message),
          batchIndex: i,
        });
        summary.errors.push(`student_count_batch_${i}: ${studErr.message}`);
        continue;
      }

      // Aggregate counts per school
      for (const row of (students ?? []) as { school_id: string }[]) {
        schoolStudentCounts.set(
          row.school_id,
          (schoolStudentCounts.get(row.school_id) ?? 0) + 1,
        );
      }
    }

    // ── Build enriched school list ──
    const schools: SchoolWithSub[] = subscriptions.map((sub) => ({
      schoolId: sub.school_id,
      sub,
      activeStudents: schoolStudentCounts.get(sub.school_id) ?? 0,
    }));

    summary.schools_processed = schools.length;

    // ── Step 1: Seat snapshots ──
    await createSeatSnapshots(schools, today, summary);

    // ── Step 2: Invoice generation (1st only) ──
    await generateMonthlyInvoices(schools, summary);

    // ── Step 3: Renewal reminders ──
    await sendRenewalReminders(schools, summary);

    // ── Step 4: Seat limit alerts ──
    await sendSeatAlerts(schools, summary);

    const durationMs = Date.now() - startTime;

    logger.info('cron/school-operations: completed', {
      schools_processed: summary.schools_processed,
      snapshots_created: summary.snapshots_created,
      invoices_generated: summary.invoices_generated,
      reminders_sent: summary.reminders_sent,
      alerts_created: summary.alerts_created,
      errors_count: summary.errors.length,
      duration_ms: durationMs,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...summary,
        duration_ms: durationMs,
      },
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    logger.error('cron/school-operations: unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      duration_ms: durationMs,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Internal cron error',
        data: { ...summary, duration_ms: durationMs },
      },
      { status: 500 }
    );
  }
}
