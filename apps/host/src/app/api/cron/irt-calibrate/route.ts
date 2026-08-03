// src/app/api/cron/irt-calibrate/route.ts
// Phase 4 of Foxy moat plan — nightly IRT 2PL recalibration cron.
//
// Schedule:  vercel.json -> "/api/cron/irt-calibrate" runs daily at 02:50 UTC
//            (08:20 IST), 20 minutes after daily-cron so the day's quiz_responses
//            are settled.
// Auth:      CRON_SECRET via constant-time compare (matches reconcile-payments
//            and expired-subscriptions routes).
// Action:    Calls recalibrate_question_irt_2pl(NULL, 30) under the service role,
//            which fits 2PL (a, b) for every active question with >= 30 responses
//            calibrated more than 7 days ago (or never).
// Privacy:   The RPC is SECURITY DEFINER + service_role-only execution. No PII
//            crosses this route — request body is empty, response is the RPC
//            JSON summary.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { recordCronJobHealth } from '@alfanumrik/lib/cron-job-health';
import { verifyCronAuth } from '@alfanumrik/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Auth: shared @alfanumrik/lib/cron-auth gate. Vercel Cron sends
// `Authorization: Bearer <CRON_SECRET>` automatically; `x-cron-secret` is
// accepted for ops invocations. The legacy `?token=` query carrier was
// REMOVED 2026-08-03 (secrets in query strings land in access logs).

export async function GET(req: NextRequest): Promise<Response> {
  if (!verifyCronAuth(req).ok) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const { data, error } = await supabaseAdmin.rpc(
      'recalibrate_question_irt_2pl',
      { p_question_id: null, p_min_attempts: 30 },
    );

    if (error) {
      logger.error('irt_calibrate_rpc_error', {
        error,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        { ok: false, error: 'rpc_failed', message: error.message },
        { status: 500 },
      );
    }

    logger.info('irt_calibrate_complete', {
      result: data,
      durationMs: Date.now() - startedAt,
    });

    await recordCronJobHealth({
      path: '/api/cron/irt-calibrate',
      metric: 'ops.cron.irt_calibrate.last_success_at',
      source: 'cron/irt-calibrate',
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ ok: true, result: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('irt_calibrate_unhandled', { message });
    return NextResponse.json(
      { ok: false, error: 'unhandled', message },
      { status: 500 },
    );
  }
}

// POST mirrors GET so the cron can use either verb. Vercel Cron defaults to GET.
export const POST = GET;
