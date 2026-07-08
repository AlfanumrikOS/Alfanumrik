/**
 * GET /api/health — uptime monitor / health check endpoint.
 *
 * Public — no auth required. Pings the database with a cheap single-row read
 * from `feature_flags` (small table, always present). Responds within the
 * 500ms target on healthy infrastructure.
 *
 * Response shapes:
 *   200  { status: 'ok',       timestamp: string, db: 'ok' }
 *   503  { status: 'degraded', timestamp: string, db: 'error', error: string }
 *
 * P13: no PII is logged. The error field carries only the DB error message.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    const { error } = await supabaseAdmin
      .from('feature_flags')
      .select('flag_name')
      .limit(1);

    if (error) {
      logger.error('health_check_db_error', {
        error: new Error(error.message),
        route: '/api/health',
      });
      return NextResponse.json(
        { status: 'degraded', timestamp, db: 'error', error: error.message },
        { status: 503 },
      );
    }

    return NextResponse.json({ status: 'ok', timestamp, db: 'ok' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('health_check_unexpected_error', {
      error: err instanceof Error ? err : new Error(message),
      route: '/api/health',
    });
    return NextResponse.json(
      { status: 'degraded', timestamp, db: 'error', error: message },
      { status: 503 },
    );
  }
}
