import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/super-admin/grounding/health
 *
 * Live operational state of the grounded-answer system. All aggregates come
 * from grounded_ai_traces. Queries are windowed narrowly (1 hour / 5 min) to
 * keep latency under 500ms even as traces grow. Frontend is Tasks 3.16/3.17
 * so this route returns raw shape without pagination.
 *
 * Auth: super_admin.access permission.
 * Response shape (see Task 3.10 contract):
 *   {
 *     callsPerMin: { foxy: N, ... },
 *     groundedRate: { foxy: 0.95, ... },
 *     abstainBreakdown: { chapter_not_ready: N, ... },
 *     latency: { p50, p95, p99 },
 *     circuitStates: {},  // TODO: populated once circuit state column lands
 *     voyageErrorRate: 0.01,
 *     claudeErrorRate: 0.02
 *   }
 */

export const runtime = 'nodejs';

const CALLERS = ['foxy', 'ncert-solver', 'quiz-generator', 'concept-engine', 'diagnostic'] as const;
type Caller = (typeof CALLERS)[number];

const ABSTAIN_REASONS = [
  'chapter_not_ready',
  'no_chunks_retrieved',
  'low_similarity',
  'no_supporting_chunks',
  'scope_mismatch',
  'upstream_error',
  'circuit_open',
] as const;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const nowMs = Date.now();
    const oneHourAgo = new Date(nowMs - 3600 * 1000).toISOString();
    const oneMinAgo = new Date(nowMs - 60 * 1000).toISOString();
    const fiveMinAgo = new Date(nowMs - 5 * 60 * 1000).toISOString();

    // ── Last-minute calls per caller ───────────────────────────────
    const { data: lastMinRows, error: lastMinErr } = await supabaseAdmin
      .from('grounded_ai_traces')
      .select('caller')
      .gte('created_at', oneMinAgo)
      .limit(10000);

    if (lastMinErr) throw new Error(`lastMinRows: ${lastMinErr.message}`);

    const callsPerMin: Record<Caller, number> = {
      foxy: 0, 'ncert-solver': 0, 'quiz-generator': 0, 'concept-engine': 0, diagnostic: 0,
    };
    for (const r of (lastMinRows ?? []) as Array<{ caller: Caller }>) {
      if (r.caller in callsPerMin) callsPerMin[r.caller]++;
    }

    // ── Last-hour: grounded rate per caller + abstain breakdown + latency ──
    const { data: hourRows, error: hourErr } = await supabaseAdmin
      .from('grounded_ai_traces')
      .select('caller, grounded, abstain_reason, latency_ms')
      .gte('created_at', oneHourAgo)
      .limit(50000);

    if (hourErr) throw new Error(`hourRows: ${hourErr.message}`);

    const callerTotals: Record<Caller, { total: number; grounded: number }> = {
      foxy: { total: 0, grounded: 0 },
      'ncert-solver': { total: 0, grounded: 0 },
      'quiz-generator': { total: 0, grounded: 0 },
      'concept-engine': { total: 0, grounded: 0 },
      diagnostic: { total: 0, grounded: 0 },
    };
    const abstainBreakdown: Record<string, number> = {};
    for (const r of ABSTAIN_REASONS) abstainBreakdown[r] = 0;
    const latencies: number[] = [];

    for (const row of (hourRows ?? []) as Array<{
      caller: Caller;
      grounded: boolean;
      abstain_reason: string | null;
      latency_ms: number | null;
    }>) {
      if (row.caller in callerTotals) {
        callerTotals[row.caller].total++;
        if (row.grounded) callerTotals[row.caller].grounded++;
      }
      if (!row.grounded && row.abstain_reason && row.abstain_reason in abstainBreakdown) {
        abstainBreakdown[row.abstain_reason]++;
      }
      if (typeof row.latency_ms === 'number' && row.latency_ms >= 0) {
        latencies.push(row.latency_ms);
      }
    }

    const groundedRate: Record<Caller, number> = {
      foxy: 0, 'ncert-solver': 0, 'quiz-generator': 0, 'concept-engine': 0, diagnostic: 0,
    };
    for (const c of CALLERS) {
      const t = callerTotals[c];
      groundedRate[c] = t.total === 0 ? 0 : Math.round((t.grounded / t.total) * 10000) / 10000;
    }

    latencies.sort((a, b) => a - b);
    const latency = {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    };

    // ── Last-5-minute Voyage/Claude error rates (from ops_events) ──
    // Voyage/Claude upstream errors are written to ops_events by the
    // grounded-answer service; we approximate the rate here as errors/total
    // in that window.
    const [voyageErrRes, voyageTotalRes, claudeErrRes, claudeTotalRes] = await Promise.all([
      supabaseAdmin
        .from('ops_events')
        .select('id', { count: 'exact', head: true })
        .eq('category', 'grounding.embedding')
        .in('severity', ['error', 'critical'])
        .gte('occurred_at', fiveMinAgo),
      supabaseAdmin
        .from('ops_events')
        .select('id', { count: 'exact', head: true })
        .eq('category', 'grounding.embedding')
        .gte('occurred_at', fiveMinAgo),
      supabaseAdmin
        .from('ops_events')
        .select('id', { count: 'exact', head: true })
        .eq('category', 'grounding.claude')
        .in('severity', ['error', 'critical'])
        .gte('occurred_at', fiveMinAgo),
      supabaseAdmin
        .from('ops_events')
        .select('id', { count: 'exact', head: true })
        .eq('category', 'grounding.claude')
        .gte('occurred_at', fiveMinAgo),
    ]);

    const safeRatio = (errCount: number | null | undefined, totalCount: number | null | undefined): number => {
      const t = totalCount ?? 0;
      const e = errCount ?? 0;
      return t === 0 ? 0 : Math.round((e / t) * 10000) / 10000;
    };

    const voyageErrorRate = safeRatio(voyageErrRes.count, voyageTotalRes.count);
    const claudeErrorRate = safeRatio(claudeErrRes.count, claudeTotalRes.count);

    return NextResponse.json({
      success: true,
      data: {
        callsPerMin,
        groundedRate,
        abstainBreakdown,
        latency,
        // Circuit breaker state lives in Edge Function process memory; a future
        // migration will persist the current state on the trace row so we can
        // surface it here. Empty for now — Tasks 3.16/3.17 render as "unknown".
        circuitStates: {},
        voyageErrorRate,
        claudeErrorRate,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}