import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/super-admin/observability/snapshot
 *
 * Returns a system-state snapshot for the top strip:
 * - Circuit breaker state derived from recent AI errors
 * - Health status from most recent health event
 * - Last deploy info
 * - Event counts by severity for the last hour
 */

type BreakerState = 'closed' | 'degraded' | 'open';
type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    // Run all queries in parallel
    const [aiErrorsResult, healthResult, deployResult, countResults] = await Promise.all([
      // 1. AI errors in last 5 minutes for breaker state
      supabaseAdmin
        .from('ops_events')
        .select('id', { count: 'exact', head: true })
        .eq('category', 'ai')
        .in('severity', ['error', 'critical'])
        .gte('occurred_at', fiveMinAgo),

      // 2. Most recent health event for health status
      supabaseAdmin
        .from('ops_events')
        .select('message, occurred_at, context')
        .eq('category', 'health')
        .order('occurred_at', { ascending: false })
        .limit(1),

      // 3. Last deploy event
      supabaseAdmin
        .from('ops_events')
        .select('context, occurred_at, environment')
        .eq('category', 'deploy')
        .order('occurred_at', { ascending: false })
        .limit(1),

      // 4. Event counts by severity in the last hour
      // Supabase doesn't support GROUP BY in .select() — query each severity
      Promise.all(
        (['info', 'warning', 'error', 'critical'] as const).map(sev =>
          supabaseAdmin
            .from('v_ops_timeline')
            .select('id', { count: 'exact', head: true })
            .eq('severity', sev)
            .gte('occurred_at', oneHourAgo)
        )
      ),
    ]);

    // Derive breaker state
    const aiErrorCount = aiErrorsResult.count ?? 0;
    let breakerState: BreakerState = 'closed';
    let breakerReason = '0 AI failures in last 5 min';
    if (aiErrorCount >= 5) {
      breakerState = 'open';
      breakerReason = `${aiErrorCount} AI failures in last 5 min`;
    } else if (aiErrorCount >= 1) {
      breakerState = 'degraded';
      breakerReason = `${aiErrorCount} AI failure${aiErrorCount > 1 ? 's' : ''} in last 5 min`;
    }

    // Derive health status
    let healthStatus: HealthStatus = 'unknown';
    let healthAgeSeconds: number | null = null;
    if (healthResult.data && healthResult.data.length > 0) {
      const healthEvent = healthResult.data[0];
      const healthTime = new Date(healthEvent.occurred_at).getTime();
      healthAgeSeconds = Math.round((now.getTime() - healthTime) / 1000);

      // Derive status from message or context
      const msg = (healthEvent.message || '').toLowerCase();
      const ctx = healthEvent.context as Record<string, unknown> | null;
      const ctxStatus = ctx?.status as string | undefined;

      if (ctxStatus === 'healthy' || msg.includes('healthy') || msg.includes('operational')) {
        healthStatus = 'healthy';
      } else if (ctxStatus === 'degraded' || msg.includes('degraded')) {
        healthStatus = 'degraded';
      } else if (ctxStatus === 'unhealthy' || msg.includes('unhealthy') || msg.includes('down')) {
        healthStatus = 'unhealthy';
      } else {
        healthStatus = 'healthy'; // Default to healthy if we have a recent event
      }

      // If health event is older than 10 minutes, consider status potentially stale
      if (healthAgeSeconds > 600) {
        healthStatus = healthStatus === 'healthy' ? 'healthy' : healthStatus;
      }
    }

    // Last deploy
    let lastDeploy: { git_sha: string; occurred_at: string; environment: string } | null = null;
    if (deployResult.data && deployResult.data.length > 0) {
      const dep = deployResult.data[0];
      const ctx = dep.context as Record<string, unknown> | null;
      lastDeploy = {
        git_sha: (ctx?.git_sha as string) || (ctx?.commit_sha as string) || 'unknown',
        occurred_at: dep.occurred_at,
        environment: dep.environment,
      };
    }

    // Event counts
    const eventCounts = {
      info: countResults[0].count ?? 0,
      warning: countResults[1].count ?? 0,
      error: countResults[2].count ?? 0,
      critical: countResults[3].count ?? 0,
    };

    return NextResponse.json({
      breakerState,
      breakerReason,
      healthStatus,
      healthAgeSeconds,
      lastDeploy,
      eventCounts,
    });
  } catch (err) {
    console.warn('[observability/snapshot] exception:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
