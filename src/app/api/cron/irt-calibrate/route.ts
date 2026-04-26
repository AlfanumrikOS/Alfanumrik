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
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  // Vercel Cron sends the secret either as `Authorization: Bearer <secret>`
  // (preferred) or via the `?token=` query param. Match either, with a
  // constant-time compare to keep timing-attack surface minimal.
  const auth  = req.headers.get('authorization') ?? '';
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const provided = auth.startsWith('Bearer ')
    ? auth.slice('Bearer '.length)
    : token;

  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!isAuthorized(req)) {
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
