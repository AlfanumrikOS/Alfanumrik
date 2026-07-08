import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

// ── helpers ──────────────────────────────────────────────────────────

async function safeJson<T>(res: Response): Promise<T[]> {
  try { const d = await res.json(); return Array.isArray(d) ? d : []; }
  catch { return []; }
}

async function countRows(table: string, filter?: string): Promise<number> {
  try {
    const params = `select=id&limit=0${filter ? `&${filter}` : ''}`;
    const res = await fetch(supabaseAdminUrl(table, params), {
      method: 'HEAD',
      headers: supabaseAdminHeaders(),
    });
    const range = res.headers.get('content-range');
    return range ? parseInt(range.split('/')[1]) || 0 : 0;
  } catch { return 0; }
}

// ── SLA targets ──

const SLA_TARGETS = {
  uptime_pct: 99.9,
  api_p95_ms: 500,
  api_p99_ms: 1000,
  quiz_submit_p95_ms: 800,
  cache_hit_pct: 70,
};

// ── GET /api/super-admin/sla ─────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  try {
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 3600000).toISOString();
    const since7d = new Date(now.getTime() - 7 * 86400000).toISOString();
    const since30d = new Date(now.getTime() - 30 * 86400000).toISOString();

    // ── Parallel data fetches ──
    // We try multiple data sources; gracefully handle missing tables
    const [
      healthChecksRes,
      schoolSloRes,
      errorLogRes,
      totalQuizCount,
      recentQuizCount,
      schoolsRes,
    ] = await Promise.all([
      // Health check history (may not exist)
      fetch(
        supabaseAdminUrl('health_check_log', `select=id,status,response_time_ms,checked_at&checked_at=gte.${since7d}&order=checked_at.desc&limit=5000`),
        { headers: supabaseAdminHeaders() },
      ).catch(() => null),
      // School SLO table (may not exist)
      fetch(
        supabaseAdminUrl('school_slo', `select=school_id,endpoint,p50_ms,p95_ms,p99_ms,measured_at&measured_at=gte.${since24h}&order=measured_at.desc&limit=1000`),
        { headers: supabaseAdminHeaders() },
      ).catch(() => null),
      // Error logs for error rate calculation
      fetch(
        supabaseAdminUrl('error_logs', `select=id,created_at&created_at=gte.${since24h}&limit=0`),
        { method: 'HEAD', headers: supabaseAdminHeaders() },
      ).catch(() => null),
      // Total quiz sessions (all time)
      countRows('quiz_sessions'),
      // Recent quiz sessions (24h)
      countRows('quiz_sessions', `created_at=gte.${since24h}`),
      // Schools for per-school SLA
      fetch(
        supabaseAdminUrl('schools', 'select=id,name,is_active&deleted_at=is.null&is_active=eq.true&limit=500'),
        { headers: supabaseAdminHeaders() },
      ).catch(() => null),
    ]);

    // ── Uptime calculation ──
    // No synthetic fallback: if the source table is missing or empty, return
    // `state: 'no_data'` so the UI can render a banner instead of a fake number.
    // Phase F.5 (2026-05-17) removed the previous `uptimePct = 99.9` default.
    let uptimePct: number | null = null;
    let healthCheckCount = 0;
    let healthCheckFailures = 0;
    let avgResponseMs = 0;
    let uptimeState: 'live' | 'no_data' | 'table_missing' = 'no_data';

    if (healthChecksRes && healthChecksRes.ok) {
      const checks = await safeJson<{
        id: string; status: string; response_time_ms: number; checked_at: string;
      }>(healthChecksRes);
      healthCheckCount = checks.length;
      healthCheckFailures = checks.filter(c => c.status !== 'ok' && c.status !== 'healthy').length;
      if (healthCheckCount > 0) {
        uptimePct = parseFloat((((healthCheckCount - healthCheckFailures) / healthCheckCount) * 100).toFixed(3));
        avgResponseMs = Math.round(checks.reduce((sum, c) => sum + (c.response_time_ms || 0), 0) / healthCheckCount);
        uptimeState = 'live';
      }
    } else if (healthChecksRes && (healthChecksRes.status === 404 || healthChecksRes.status === 400)) {
      uptimeState = 'table_missing';
    }

    // ── Error rate ──
    let errorCount24h = 0;
    if (errorLogRes && errorLogRes.ok) {
      const range = errorLogRes.headers.get('content-range');
      errorCount24h = range ? parseInt(range.split('/')[1]) || 0 : 0;
    }

    // ── Latency metrics from school_slo ──
    interface EndpointLatency {
      endpoint: string;
      p50: number;
      p95: number;
      p99: number;
      sample_count: number;
      status: 'healthy' | 'degraded' | 'critical';
    }

    let endpointLatencies: EndpointLatency[] = [];

    if (schoolSloRes && schoolSloRes.ok) {
      const sloData = await safeJson<{
        school_id: string; endpoint: string; p50_ms: number; p95_ms: number; p99_ms: number; measured_at: string;
      }>(schoolSloRes);

      // Aggregate by endpoint
      const byEndpoint = new Map<string, { p50s: number[]; p95s: number[]; p99s: number[] }>();
      for (const row of sloData) {
        const prev = byEndpoint.get(row.endpoint) || { p50s: [], p95s: [], p99s: [] };
        prev.p50s.push(row.p50_ms || 0);
        prev.p95s.push(row.p95_ms || 0);
        prev.p99s.push(row.p99_ms || 0);
        byEndpoint.set(row.endpoint, prev);
      }

      endpointLatencies = Array.from(byEndpoint.entries()).map(([endpoint, vals]) => {
        const median = (arr: number[]) => {
          const sorted = [...arr].sort((a, b) => a - b);
          return sorted[Math.floor(sorted.length / 2)] || 0;
        };
        const p50 = Math.round(median(vals.p50s));
        const p95 = Math.round(median(vals.p95s));
        const p99 = Math.round(median(vals.p99s));
        const status: 'healthy' | 'degraded' | 'critical' =
          p95 <= SLA_TARGETS.api_p95_ms ? 'healthy' :
          p95 <= SLA_TARGETS.api_p95_ms * 2 ? 'degraded' : 'critical';

        return { endpoint, p50, p95, p99, sample_count: vals.p50s.length, status };
      });
    }

    // Phase F.5 (2026-05-17): removed the 5-row hardcoded endpoint-latency
    // fallback that misled operators into thinking they were seeing real
    // measurements. If school_slo is missing or empty, return an empty
    // latency list with a state indicator the UI can render as a banner.
    const latencyState: 'live' | 'no_data' | 'table_missing' =
      endpointLatencies.length > 0
        ? 'live'
        : schoolSloRes && (schoolSloRes.status === 404 || schoolSloRes.status === 400)
          ? 'table_missing'
          : 'no_data';

    // ── Per-school SLA compliance ──
    // Phase F.5 (2026-05-17): nullable fields + state marker so the route can
    // report "no data" without fabricating 99.9% / true compliance.
    interface SchoolSLA {
      school_id: string;
      school_name: string;
      uptime_pct: number | null;
      avg_latency_ms: number | null;
      compliant: boolean | null;
      state: 'live' | 'no_data' | 'table_missing' | 'partial';
    }

    let schoolSLAs: SchoolSLA[] = [];
    if (schoolsRes && schoolsRes.ok) {
      const schools = await safeJson<{ id: string; name: string; is_active: boolean }>(schoolsRes);

      if (schoolSloRes && schoolSloRes.ok) {
        // Re-read the SLO data for per-school breakdown
        const sloSchoolRes = await fetch(
          supabaseAdminUrl('school_slo', `select=school_id,p50_ms,p95_ms&measured_at=gte.${since7d}&limit=5000`),
          { headers: supabaseAdminHeaders() },
        ).catch(() => null);

        if (sloSchoolRes && sloSchoolRes.ok) {
          const sloRows = await safeJson<{ school_id: string; p50_ms: number; p95_ms: number }>(sloSchoolRes);
          const bySchool = new Map<string, { latencies: number[]; p95s: number[] }>();
          for (const r of sloRows) {
            const prev = bySchool.get(r.school_id) || { latencies: [], p95s: [] };
            prev.latencies.push(r.p50_ms || 0);
            prev.p95s.push(r.p95_ms || 0);
            bySchool.set(r.school_id, prev);
          }

          schoolSLAs = schools.map(s => {
            const data = bySchool.get(s.id);
            if (!data || data.latencies.length === 0) {
              return {
                school_id: s.id,
                school_name: s.name,
                uptime_pct: null,
                avg_latency_ms: null,
                compliant: null,
                state: 'no_data' as const,
              };
            }
            const avgLatency = Math.round(data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length);
            const avgP95 = Math.round(data.p95s.reduce((a, b) => a + b, 0) / data.p95s.length);
            return {
              school_id: s.id,
              school_name: s.name,
              uptime_pct: null, // per-school uptime not tracked yet; state will be 'partial'
              avg_latency_ms: avgLatency,
              compliant: avgP95 <= SLA_TARGETS.api_p95_ms,
              state: 'partial' as const,
            };
          });
        }
      }

      // Phase F.5 (2026-05-17): no longer fabricate per-school compliance =
      // true with 99.9% uptime. Empty list means the operator should see
      // "no data" UX, not green checks.
      if (schoolSLAs.length === 0) {
        schoolSLAs = schools.slice(0, 50).map(s => ({
          school_id: s.id,
          school_name: s.name,
          uptime_pct: null,
          avg_latency_ms: null,
          compliant: null,
          state: 'no_data' as const,
        }));
      }
    }

    // Phase F.5 (2026-05-17): overall_status is null when we don't have
    // enough data to score. UI must render that as "instrumentation
    // pending" not "healthy".
    let overallStatus: 'healthy' | 'degraded' | 'critical' | null = null;
    if (uptimeState === 'live' && latencyState === 'live' && uptimePct !== null) {
      if (uptimePct >= SLA_TARGETS.uptime_pct && endpointLatencies.every(e => e.status === 'healthy')) {
        overallStatus = 'healthy';
      } else if (endpointLatencies.some(e => e.status === 'critical') || uptimePct < 99.0) {
        overallStatus = 'critical';
      } else {
        overallStatus = 'degraded';
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        targets: SLA_TARGETS,
        // Platform uptime
        uptime: {
          state: uptimeState,
          current_pct: uptimePct,
          target_pct: SLA_TARGETS.uptime_pct,
          health_checks_total: healthCheckCount,
          health_checks_failed: healthCheckFailures,
          avg_response_ms: avgResponseMs,
          status:
            uptimePct === null
              ? null
              : uptimePct >= SLA_TARGETS.uptime_pct ? 'healthy' : uptimePct >= 99.0 ? 'degraded' : 'critical',
        },
        // Error rate (denominator is a heuristic — labeled accordingly)
        errors: {
          count_24h: errorCount24h,
          requests_estimate_24h_heuristic: recentQuizCount * 5,
          estimate_method: 'quiz_sessions_x5',
        },
        // Latency by endpoint
        latency: { state: latencyState, endpoints: endpointLatencies },
        // Per-school
        school_sla: schoolSLAs,
        // Summary
        overall_status: overallStatus,
        instrumentation_note:
          uptimeState !== 'live' || latencyState !== 'live'
            ? 'Some SLO instrumentation tables are empty or missing. See docs/runbooks/super-admin-sla.md.'
            : null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
