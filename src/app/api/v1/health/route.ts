import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/v1/health
 *
 * Production health check endpoint for:
 * - Uptime monitoring (Vercel, Betterstack, Checkly)
 * - Load balancer health probes
 * - Post-deployment verification
 * - Incident diagnostics
 *
 * Returns:
 *  200 — all systems healthy
 *  503 — one or more dependencies degraded
 */
export async function GET() {
  const start = Date.now();
  const checks: Record<string, { status: 'ok' | 'degraded' | 'down'; latencyMs: number; error?: string }> = {};

  // ── Check 1: Supabase Database ──
  try {
    const dbStart = Date.now();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      checks.database = { status: 'down', latencyMs: 0, error: 'Missing env vars' };
    } else {
      const client = createClient(supabaseUrl, supabaseKey);
      const { error } = await client.from('curriculum_topics').select('id').limit(1);
      const latencyMs = Date.now() - dbStart;

      if (error) {
        checks.database = { status: 'degraded', latencyMs, error: error.message };
      } else if (latencyMs > 2000) {
        checks.database = { status: 'degraded', latencyMs, error: 'Slow response' };
      } else {
        checks.database = { status: 'ok', latencyMs };
      }
    }
  } catch (e) {
    checks.database = { status: 'down', latencyMs: Date.now() - start, error: String(e) };
  }

  // ── Check 2: Environment Variables ──
  const requiredEnvVars = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const missingEnvVars = requiredEnvVars.filter(k => !process.env[k]);

  checks.environment = missingEnvVars.length === 0
    ? { status: 'ok', latencyMs: 0 }
    : { status: 'down', latencyMs: 0, error: `Missing: ${missingEnvVars.join(', ')}` };

  // ── Check 3: Memory Usage ──
  if (typeof process.memoryUsage === 'function') {
    const mem = process.memoryUsage();
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
    const usagePercent = Math.round((mem.heapUsed / mem.heapTotal) * 100);

    checks.memory = {
      status: usagePercent > 90 ? 'degraded' : 'ok',
      latencyMs: 0,
      ...(usagePercent > 90 ? { error: `${usagePercent}% heap used (${heapUsedMB}/${heapTotalMB}MB)` } : {}),
    };
  }

  // ── Overall Status ──
  const allStatuses = Object.values(checks).map(c => c.status);
  const overallStatus = allStatuses.includes('down')
    ? 'down'
    : allStatuses.includes('degraded')
      ? 'degraded'
      : 'ok';

  const response = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    totalLatencyMs: Date.now() - start,
    version: process.env.npm_package_version || '2.0.0',
    checks,
  };

  return NextResponse.json(response, {
    status: overallStatus === 'ok' ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'application/json',
    },
  });
}
