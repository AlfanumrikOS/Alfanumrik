import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { cacheStats } from '@/lib/cache';
import { SLO } from '@/lib/slo';

/**
 * GET /api/v1/health
 *
 * Production health check endpoint for:
 * - Uptime monitoring (Vercel, Betterstack, Checkly)
 * - Load balancer health probes
 * - Post-deployment verification
 * - Incident diagnostics
 * - Monitoring dashboards (Grafana, Datadog)
 *
 * Always returns HTTP 200 so load balancers don't remove the instance.
 * The `status` field indicates actual health:
 *   "healthy"   -- all checks pass
 *   "degraded"  -- one or more checks failed (app can still serve)
 *   "unhealthy" -- critical checks failed
 *
 * Gracefully degrades: if Supabase is unreachable, the endpoint
 * still responds with diagnostic info rather than crashing.
 */

const PROCESS_START = Date.now();
const APP_VERSION = process.env.npm_package_version || '2.0.0';
const DEPLOY_ENV = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
const DEPLOY_REGION = process.env.VERCEL_REGION || 'unknown';
const GIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev';

/** Run a promise with a timeout. Rejects if the promise doesn't resolve in time. */
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    Promise.resolve(promise)
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err: unknown) => { clearTimeout(timer); reject(err); });
  });
}

interface CheckResult {
  status: 'ok' | 'error';
  latency_ms: number;
  error?: string;
}

async function checkDatabase(): Promise<CheckResult> {
  const start = performance.now();
  try {
    const result = await withTimeout(
      supabaseAdmin.from('curriculum_topics').select('id').limit(1),
      SLO.HEALTH_CHECK_TIMEOUT_MS,
    );
    const latency_ms = Math.round(performance.now() - start);
    if (result.error) {
      return { status: 'error', latency_ms, error: result.error.message };
    }
    return { status: 'ok', latency_ms };
  } catch (e) {
    return { status: 'error', latency_ms: Math.round(performance.now() - start), error: String(e) };
  }
}

async function checkAuth(): Promise<Omit<CheckResult, 'latency_ms'> & { latency_ms: number }> {
  const start = performance.now();
  try {
    const { error } = await withTimeout(
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 }),
      SLO.HEALTH_CHECK_TIMEOUT_MS,
    );
    const latency_ms = Math.round(performance.now() - start);
    if (error) {
      return { status: 'error', latency_ms, error: error.message };
    }
    return { status: 'ok', latency_ms };
  } catch (e) {
    return { status: 'error', latency_ms: Math.round(performance.now() - start), error: String(e) };
  }
}

function getMemoryUsage(): { rss_mb: number; heap_used_mb: number; heap_total_mb: number; external_mb: number } | null {
  try {
    const mem = process.memoryUsage();
    return {
      rss_mb: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
      external_mb: Math.round(mem.external / 1024 / 1024 * 100) / 100,
    };
  } catch {
    // process.memoryUsage() may not be available in all runtimes (e.g., Edge)
    return null;
  }
}

export async function GET() {
  const requestStart = performance.now();

  const [database, auth] = await Promise.all([
    checkDatabase(),
    checkAuth(),
  ]);

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

  const uptimeSeconds = Math.floor((Date.now() - PROCESS_START) / 1000);
  const responseTimeMs = Math.round(performance.now() - requestStart);
  const memory = getMemoryUsage();
  const cache = cacheStats();

  const response = {
    status,
    timestamp: new Date().toISOString(),
    response_time_ms: responseTimeMs,

    version: {
      app: APP_VERSION,
      git_sha: GIT_SHA,
    },

    environment: {
      name: DEPLOY_ENV,
      region: DEPLOY_REGION,
      node_version: process.version || 'unknown',
    },

    uptime_seconds: uptimeSeconds,

    checks: {
      database,
      auth,
    },

    // Memory usage (null if unavailable in Edge runtime)
    memory,

    // In-memory cache stats
    cache: {
      entries: cache.size,
    },

    // SLO thresholds for dashboard reference
    slo: {
      uptime_target: SLO.UPTIME_TARGET,
      api_p95_latency_ms: SLO.API_P95_LATENCY_MS,
      error_rate_threshold: SLO.ERROR_RATE_THRESHOLD,
      health_check_interval_ms: SLO.HEALTH_CHECK_INTERVAL_MS,
    },
  };

  return NextResponse.json(response, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Server-Timing': `total;dur=${responseTimeMs}, db;dur=${database.latency_ms}, auth;dur=${auth.latency_ms}`,
    },
  });
}
