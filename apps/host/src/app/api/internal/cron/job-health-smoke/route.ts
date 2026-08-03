import { NextRequest, NextResponse } from 'next/server';
import { recordCronJobHealth } from '@alfanumrik/lib/cron-job-health';
import { verifyCronAuth } from '@alfanumrik/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SMOKE_PATH = '/api/internal/cron/job-health-smoke';
const SMOKE_METRIC = 'ops.cron.job_health_smoke.last_success_at';

// Auth: shared @alfanumrik/lib/cron-auth gate (Bearer / x-cron-secret,
// constant-time, fail-closed).

function smokeAllowed(): boolean {
  if (process.env.VERCEL_ENV !== 'production') return true;
  return process.env.ENABLE_CRON_JOB_HEALTH_SMOKE === 'true';
}

async function run(request: NextRequest): Promise<Response> {
  if (!verifyCronAuth(request).ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!smokeAllowed()) {
    return NextResponse.json({ error: 'disabled_in_production' }, { status: 403 });
  }

  const startedAt = Date.now();
  const ok = await recordCronJobHealth({
    path: SMOKE_PATH,
    metric: SMOKE_METRIC,
    source: 'cron/job-health-smoke',
    durationMs: Date.now() - startedAt,
    requestId: request.headers.get('x-request-id'),
    context: {
      smoke: true,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'local',
    },
  });

  if (!ok) {
    return NextResponse.json({ ok: false, error: 'job_health_write_failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    path: SMOKE_PATH,
    metric: SMOKE_METRIC,
    checked_at: new Date().toISOString(),
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return run(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return run(request);
}
