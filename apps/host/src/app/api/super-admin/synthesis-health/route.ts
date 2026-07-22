/**
 * GET /api/super-admin/synthesis-health
 *
 * Phase 8 item 8.4: surfaces Monthly-Synthesis WhatsApp delivery health to
 * super-admin so a silent Meta-template-approval failure (100% delivery
 * failure) is visible before parents notice. Reads monthly_synthesis_runs
 * status counts (the nightly /api/cron/synthesis-delivery-monitor emits the
 * alerting signal; this route powers the dashboard panel).
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       window: { sent, failed, opted_out, flagged, suppressed, pending,
 *                 failure_rate_pct, opted_out_pct },   // trailing 24h
 *       dailyCounts: Array<{ day, sent, failed, opted_out, flagged, pending }>,
 *       recentFailures: Array<{ synthesisRunId, studentId, synthesisMonth,
 *                               createdAt }>            // last 10, ids only
 *     }
 *   }
 *
 * P13: returns run ids, student ids, month labels, and timestamps ONLY. It
 * NEVER returns summary_text_en/hi, the bundle, the parent's phone, or the
 * student's name. Run-id + student-id are the explicitly-permitted linking
 * identifiers for this internal ops surface (task 8.4).
 *
 * Auth: super-admin only via authorizeRequest('super_admin.access').
 */

import { NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

export const runtime = 'nodejs';

/** Statuses tracked by monthly_synthesis_runs.parent_share_status. */
type ShareStatus = 'pending' | 'sent' | 'opted_out' | 'failed' | 'suppressed' | 'flagged';

interface RunRow {
  id: string;
  student_id: string;
  synthesis_month: string;
  parent_share_status: ShareStatus | string;
  created_at: string;
}

interface WindowCounts {
  sent: number;
  failed: number;
  opted_out: number;
  flagged: number;
  suppressed: number;
  pending: number;
  failure_rate_pct: number | null;
  opted_out_pct: number | null;
}

function emptyBuckets() {
  return { sent: 0, failed: 0, opted_out: 0, flagged: 0, suppressed: 0, pending: 0 };
}

function tally(rows: RunRow[]) {
  const b = emptyBuckets();
  for (const r of rows) {
    switch (r.parent_share_status) {
      case 'sent': b.sent++; break;
      case 'failed': b.failed++; break;
      case 'opted_out': b.opted_out++; break;
      case 'flagged': b.flagged++; break;
      case 'suppressed': b.suppressed++; break;
      case 'pending': b.pending++; break;
      default: break;
    }
  }
  return b;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD (UTC)
}

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await authorizeRequest(request, 'super_admin.access');
    if (!auth.authorized) return auth.errorResponse!;

    const cutoff14 = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const cutoff24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    // P13: select IDS + status + timestamps ONLY. No summary text, no bundle.
    const { data: rows, error } = await supabaseAdmin
      .from('monthly_synthesis_runs')
      .select('id, student_id, synthesis_month, parent_share_status, created_at')
      .gte('created_at', cutoff14)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('super-admin.synthesis-health: fetch failed', { error: error.message });
      return NextResponse.json(
        { success: false, error: 'Fetch failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    const runRows = (rows ?? []) as RunRow[];

    // Trailing-24h window summary (mirrors the monitor cron's rollup math).
    const windowRows = runRows.filter((r) => r.created_at >= cutoff24h);
    const wb = tally(windowRows);
    const attempts = wb.sent + wb.failed;
    const optedDenom = attempts + wb.opted_out;
    const window: WindowCounts = {
      ...wb,
      failure_rate_pct: attempts > 0 ? Math.round((wb.failed / attempts) * 100) : null,
      opted_out_pct: optedDenom > 0 ? Math.round((wb.opted_out / optedDenom) * 100) : null,
    };

    // Per-day counts (14d trend).
    const buckets = new Map<string, RunRow[]>();
    for (const r of runRows) {
      const k = dayKey(r.created_at);
      const arr = buckets.get(k) ?? [];
      arr.push(r);
      buckets.set(k, arr);
    }
    const dailyCounts = Array.from(buckets.entries())
      .map(([day, dayRows]) => {
        const b = tally(dayRows);
        return { day, ...b };
      })
      .sort((a, b) => b.day.localeCompare(a.day));

    // Last 10 failures — run id + student id + month + timestamp ONLY (P13).
    const recentFailures = runRows
      .filter((r) => r.parent_share_status === 'failed')
      .slice(0, 10)
      .map((r) => ({
        synthesisRunId: r.id,
        studentId: r.student_id,
        synthesisMonth: r.synthesis_month,
        createdAt: r.created_at,
      }));

    return NextResponse.json({
      success: true,
      data: { window, dailyCounts, recentFailures },
    });
  } catch (err) {
    logger.error('super-admin.synthesis-health: unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL' },
      { status: 500 },
    );
  }
}
