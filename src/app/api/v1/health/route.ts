import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/v1/health
 *
 * Production health check endpoint for:
 * - Uptime monitoring (Vercel, Betterstack, Checkly)
 * - Load balancer health probes
 * - Post-deployment verification
 * - Incident diagnostics
 *
 * Always returns HTTP 200 so load balancers don't remove the instance.
 * The `status` field indicates actual health:
 *   "healthy"   — all checks pass
 *   "degraded"  — one check failed (app can serve cached content)
 *   "unhealthy" — all checks failed
 */

const PROCESS_START = Date.now();
const CHECK_TIMEOUT_MS = 3_000;

/** Run a promise with a timeout. Rejects if the promise doesn't resolve in time. */
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    Promise.resolve(promise)
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err: unknown) => { clearTimeout(timer); reject(err); });
  });
}

async function checkDatabase(): Promise<{ status: 'ok' | 'error'; latency_ms: number; error?: string }> {
  const start = Date.now();
  try {
    const result = await withTimeout(
      supabaseAdmin.from('curriculum_topics').select('id').limit(1),
      CHECK_TIMEOUT_MS,
    );
    const latency_ms = Date.now() - start;
    if (result.error) {
      return { status: 'error', latency_ms, error: result.error.message };
    }
    return { status: 'ok', latency_ms };
  } catch (e) {
    return { status: 'error', latency_ms: Date.now() - start, error: String(e) };
  }
}

async function checkAuth(): Promise<{ status: 'ok' | 'error'; error?: string }> {
  try {
    // Use admin auth API to verify the auth service is responsive.
    // listUsers with a limit of 1 is lightweight and confirms auth service connectivity.
    const { error } = await withTimeout(
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 }),
      CHECK_TIMEOUT_MS
    );
    if (error) {
      return { status: 'error', error: error.message };
    }
    return { status: 'ok' };
  } catch (e) {
    return { status: 'error', error: String(e) };
  }
}

export async function GET() {
  const [database, auth] = await Promise.all([
    checkDatabase(),
    checkAuth(),
  ]);

  const checks = { database, auth };

  const dbOk = database.status === 'ok';
  const authOk = auth.status === 'ok';

  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (dbOk && authOk) {
    status = 'healthy';
  } else if (!dbOk && !authOk) {
    status = 'unhealthy';
  } else {
    status = 'degraded';
  }

  const response = {
    status,
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    checks,
    uptime_seconds: Math.floor((Date.now() - PROCESS_START) / 1000),
  };

  // Always return HTTP 200 so load balancers don't remove the instance.
  // The status field communicates actual health to monitoring tools.
  return NextResponse.json(response, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
