/**
 * GET /api/identity/migration-status
 *
 * Migration monitoring and health check endpoint.
 * Provides metrics on dual-write success rates, data consistency, and circuit breaker status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { authorizeRequest } from '@/lib/rbac';

export async function GET(request: NextRequest) {
  try {
    // Authorize admin access
    const authResult = await authorizeRequest(request, 'admin.super_admin');
    if (!authResult.authorized) {
      return NextResponse.json(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    const supabase = await createSupabaseServerClient();

    // Get migration metrics from ops_events
    const { data: events, error } = await supabase
      .from('ops_events')
      .select('category, source, severity, message, context, created_at')
      .eq('category', 'identity-migration')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Migration Status] Failed to fetch events:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch migration metrics' },
        { status: 500 }
      );
    }

    // Analyze events for metrics
    const metrics = analyzeMigrationEvents(events || []);

    // Get circuit breaker status (this would need to be stored in DB or cached)
    const circuitBreakerStatus = await getCircuitBreakerStatus();

    // Get data consistency metrics
    const consistencyMetrics = await getConsistencyMetrics(supabase);

    return NextResponse.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        metrics,
        circuit_breaker: circuitBreakerStatus,
        consistency: consistencyMetrics,
        overall_health: calculateOverallHealth(metrics, circuitBreakerStatus, consistencyMetrics),
      },
    });

  } catch (error) {
    console.error('[Migration Status] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Analyze migration events for key metrics
 */
function analyzeMigrationEvents(events: any[]): any {
  const metrics: any = {
    total_events: events.length,
    dual_write_attempts: 0,
    dual_write_successes: 0,
    dual_write_failures: 0,
    consistency_checks: 0,
    consistency_violations: 0,
    circuit_breaker_opens: 0,
    circuit_breaker_closes: 0,
    rollbacks: 0,
    recent_errors: [] as any[],
  };

  for (const event of events) {
    const ctx = event.context || {};

    switch (event.source) {
      case 'dual-write':
        metrics.dual_write_attempts++;
        if (event.severity === 'info' && ctx.success) {
          metrics.dual_write_successes++;
        } else if (event.severity === 'error') {
          metrics.dual_write_failures++;
          if (metrics.recent_errors.length < 10) {
            metrics.recent_errors.push({
              timestamp: event.created_at,
              message: event.message,
              user_id: ctx.user_id,
            });
          }
        }
        if (ctx.consistency_checked) {
          metrics.consistency_checks++;
          if (!ctx.consistent) {
            metrics.consistency_violations++;
          }
        }
        if (event.message?.includes('rollback')) {
          metrics.rollbacks++;
        }
        break;

      case 'circuit-breaker':
        if (event.message?.includes('OPEN')) {
          metrics.circuit_breaker_opens++;
        } else if (event.message?.includes('CLOSED')) {
          metrics.circuit_breaker_closes++;
        }
        break;
    }
  }

  // Calculate rates
  metrics.dual_write_success_rate = metrics.dual_write_attempts > 0
    ? (metrics.dual_write_successes / metrics.dual_write_attempts) * 100
    : 0;

  metrics.consistency_violation_rate = metrics.consistency_checks > 0
    ? (metrics.consistency_violations / metrics.consistency_checks) * 100
    : 0;

  return metrics;
}

/**
 * Get circuit breaker status (mock implementation - would need real status from service)
 */
async function getCircuitBreakerStatus(): Promise<any> {
  // In a real implementation, this would query the circuit breaker status
  // For now, return a placeholder
  return {
    state: 'CLOSED',
    failures: 0,
    last_failure: null,
    total_calls: 0,
    uptime_percentage: 100,
  };
}

/**
 * Get data consistency metrics
 */
async function getConsistencyMetrics(supabase: any): Promise<any> {
  // Query for recent consistency check results
  const { data: consistencyEvents } = await supabase
    .from('ops_events')
    .select('context')
    .eq('category', 'identity-migration')
    .eq('source', 'dual-write')
    .eq('severity', 'error')
    .ilike('message', '%inconsistency%')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()); // Last 7 days

  return {
    total_checks: 0, // Would need to track this separately
    violations_found: consistencyEvents?.length || 0,
    violation_rate: 0, // Calculate based on total checks
    recent_violations: consistencyEvents?.slice(0, 5) || [],
  };
}

/**
 * Calculate overall migration health
 */
function calculateOverallHealth(metrics: any, circuitBreaker: any, consistency: any): string {
  const successRate = metrics.dual_write_success_rate || 0;
  const violationRate = metrics.consistency_violation_rate || 0;
  const circuitOpen = circuitBreaker.state === 'OPEN';

  if (circuitOpen || successRate < 95 || violationRate > 5) {
    return 'CRITICAL';
  } else if (successRate < 98 || violationRate > 2) {
    return 'WARNING';
  } else {
    return 'HEALTHY';
  }
}