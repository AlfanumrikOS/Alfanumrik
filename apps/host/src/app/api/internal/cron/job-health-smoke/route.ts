import { NextRequest, NextResponse } from 'next/server';
import { recordCronJobHealth } from '@alfanumrik/lib/cron-job-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SMOKE_PATH = '/api/internal/cron/job-health-smoke';
const SMOKE_METRIC = 'ops.cron.job_health_smoke.last_success_at';

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function verifyCronSecret(request: NextRequest): boolean {
  const provided =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  if (!provided || !expected) return false;
  return constantTimeEquals(provided, expected);
}

function smokeAllowed(): boolean {
  if (process.env.VERCEL_ENV !== 'production') return true;
  return process.env.ENABLE_CRON_JOB_HEALTH_SMOKE === 'true';
}

async function run(request: NextRequest): Promise<Response> {
  if (!verifyCronSecret(request)) {
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
