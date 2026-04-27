import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { cacheStats } from '@/lib/cache';
import { SLO } from '@/lib/slo';
import { getRedis } from '@/lib/redis';

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
 *
 * Dependency probes (audit F21):
 *   - edge_functions: pings a Supabase Edge Function (grounded-answer)
 *   - redis: pings Upstash Redis (skipped if not configured)
 *   - razorpay: GET /v1/payments/<id> (skipped if creds absent;
 *     404 is OK = API reachable; 5xx/401 = real failure)
 */

const PROCESS_START = Date.now();
const APP_VERSION = process.env.npm_package_version || '2.0.0';
const DEPLOY_ENV = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
const DEPLOY_REGION = process.env.VERCEL_REGION || 'unknown';
const GIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev';

/** Per-dependency probe timeout (ms). */
const DEP_TIMEOUT_MS = 3_000;

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

/** Dependency probe result — adds 'skipped' (no config) and 'degraded' (soft failure). */
interface DependencyResult {
  status: 'ok' | 'degraded' | 'skipped' | 'failed';
  latency_ms: number;
  detail?: string;
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

/**
 * Probe an Edge Function for reachability. We don't actually run RAG —
 * we OPTIONS the function URL or send a tiny ping. Anything 2xx/4xx is
 * considered reachable (the function answered). Only 5xx or network
 * failure marks the dependency as failed.
 */
async function checkEdgeFunctions(): Promise<DependencyResult> {
  const start = performance.now();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return { status: 'skipped', latency_ms: 0, detail: 'supabase env not configured' };
  }

  // grounded-answer is the canonical AI Edge Function in the new RAG pipeline.
  // We send an OPTIONS preflight which always answers without running the
  // function body. If the deployment surface is up, this returns 200/204.
  const target = `${url}/functions/v1/grounded-answer`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEP_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(target, {
        method: 'OPTIONS',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'apikey': serviceKey,
          'Origin': url,
          'Access-Control-Request-Method': 'POST',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const latency_ms = Math.round(performance.now() - start);
    // 5xx → real failure. Anything else (2xx, 3xx, 4xx) means the function
    // gateway is up and answering.
    if (res.status >= 500) {
      return { status: 'degraded', latency_ms, detail: `HTTP ${res.status}` };
    }
    return { status: 'ok', latency_ms };
  } catch (e) {
    const latency_ms = Math.round(performance.now() - start);
    return { status: 'degraded', latency_ms, detail: String(e).slice(0, 200) };
  }
}

/**
 * Ping Upstash Redis. If credentials are absent, marked as 'skipped' —
 * not a failure (Upstash is optional; rate-limiting falls back to in-memory).
 */
async function checkRedis(): Promise<DependencyResult> {
  const start = performance.now();
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return { status: 'skipped', latency_ms: 0, detail: 'upstash not configured' };
  }

  try {
    const redis = getRedis();
    if (!redis) {
      return { status: 'skipped', latency_ms: 0, detail: 'redis client unavailable' };
    }
    // Upstash JS SDK exposes ping(); fall back to a no-op SET if absent.
    const r = redis as unknown as {
      ping?: () => Promise<unknown>;
      set: (key: string, value: string, opts?: { ex?: number }) => Promise<unknown>;
    };
    const result = await withTimeout(
      typeof r.ping === 'function' ? r.ping() : r.set('health:probe', '1', { ex: 5 }),
      DEP_TIMEOUT_MS,
    );
    const latency_ms = Math.round(performance.now() - start);
    // ping → "PONG"; set NX → "OK"; both falsy means something odd.
    if (!result) {
      return { status: 'degraded', latency_ms, detail: 'no response' };
    }
    return { status: 'ok', latency_ms };
  } catch (e) {
    return { status: 'failed', latency_ms: Math.round(performance.now() - start), detail: String(e).slice(0, 200) };
  }
}

/**
 * Ping Razorpay. We GET a known test payment id; 404 means the API is
 * reachable and our credentials authenticated (404 = not found, but
 * authenticated). 401/403 = credential failure, 5xx = Razorpay outage.
 * Skipped if credentials are absent (e.g., dev without billing).
 */
async function checkRazorpay(): Promise<DependencyResult> {
  const start = performance.now();
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key || !secret) {
    return { status: 'skipped', latency_ms: 0, detail: 'razorpay creds not configured' };
  }

  // Use a benign GET to the payments endpoint with a known-bad id.
  // This authenticates and parses the path without modifying any data.
  // If creds are valid, we get either 404 (id not found — reachable) or
  // 200 (in the unlikely event the test id exists). Either is healthy.
  const probeId = 'pay_health_probe_unknown';
  const auth = `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEP_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`https://api.razorpay.com/v1/payments/${probeId}`, {
        method: 'GET',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const latency_ms = Math.round(performance.now() - start);

    // Reachable + authenticated states (200 = id exists, 404 = id missing
    // but API answered, 400 = malformed-id error response from Razorpay).
    if (res.status === 200 || res.status === 404 || res.status === 400) {
      return { status: 'ok', latency_ms };
    }
    // Auth failures = real problem — credentials wrong or revoked.
    if (res.status === 401 || res.status === 403) {
      return { status: 'failed', latency_ms, detail: `auth rejected (HTTP ${res.status})` };
    }
    // Razorpay-side outage.
    if (res.status >= 500) {
      return { status: 'degraded', latency_ms, detail: `HTTP ${res.status}` };
    }
    // Anything else — treat as degraded so dashboards surface the anomaly.
    return { status: 'degraded', latency_ms, detail: `unexpected HTTP ${res.status}` };
  } catch (e) {
    return { status: 'degraded', latency_ms: Math.round(performance.now() - start), detail: String(e).slice(0, 200) };
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

  const [database, auth, edge_functions, redis, razorpay] = await Promise.all([
    checkDatabase(),
    checkAuth(),
    checkEdgeFunctions(),
    checkRedis(),
    checkRazorpay(),
  ]);

  const dbOk = database.status === 'ok';
  const authOk = auth.status === 'ok';

  // Dependency contributions to overall status:
  //   - 'failed'   → unhealthy_components += name (degrades top-level status)
  //   - 'degraded' → unhealthy_components += name (degrades top-level status)
  //   - 'skipped'  → no impact (intentional non-config)
  //   - 'ok'       → no impact
  const unhealthy_components: string[] = [];
  if (!dbOk) unhealthy_components.push('database');
  if (!authOk) unhealthy_components.push('auth');
  if (edge_functions.status === 'failed' || edge_functions.status === 'degraded') {
    unhealthy_components.push('edge_functions');
  }
  if (redis.status === 'failed') {
    // Redis 'degraded' (e.g. high latency) is acceptable; only true failure counts.
    unhealthy_components.push('redis');
  }
  if (razorpay.status === 'failed' || razorpay.status === 'degraded') {
    unhealthy_components.push('razorpay');
  }

  const ok = unhealthy_components.length === 0;

  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (dbOk && authOk && unhealthy_components.length === 0) {
    status = 'healthy';
  } else if (!dbOk && !authOk) {
    status = 'unhealthy';
  } else if (!dbOk || !authOk) {
    status = 'degraded';
  } else {
    // Core checks (db/auth) pass but a dependency probe failed.
    status = 'degraded';
  }

  const uptimeSeconds = Math.floor((Date.now() - PROCESS_START) / 1000);
  const responseTimeMs = Math.round(performance.now() - requestStart);
  const memory = getMemoryUsage();
  const cache = cacheStats();

  const response = {
    ok,
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

    // External dependency probes (Audit F21)
    dependencies: {
      edge_functions,
      redis,
      razorpay,
    },

    ...(ok ? {} : { unhealthy_components }),

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
      'Server-Timing': [
        `total;dur=${responseTimeMs}`,
        `db;dur=${database.latency_ms}`,
        `auth;dur=${auth.latency_ms}`,
        `edge;dur=${edge_functions.latency_ms}`,
        `redis;dur=${redis.latency_ms}`,
        `razorpay;dur=${razorpay.latency_ms}`,
      ].join(', '),
    },
  });
}
