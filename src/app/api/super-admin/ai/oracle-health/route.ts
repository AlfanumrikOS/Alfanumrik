import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/super-admin/ai/oracle-health
 *
 * Surface telemetry for the quiz-generator validation oracle (REG-54, PR
 * #454). The oracle gates AI-generated MCQs before they land in
 * `question_bank`. Every rejection writes a row to `ops_events` with
 * `category='quiz.oracle_rejection'`. This route aggregates those rows
 * for the super-admin AI health panel.
 *
 * Auth: super_admin.access (existing AI permission — no new RBAC code).
 *
 * Window: rolling last 24h.
 *
 * IMPORTANT — telemetry gap:
 *   The oracle currently emits ONLY rejection events. There is no
 *   matching `quiz.oracle_accepted` (or `quiz.oracle_evaluated`) event
 *   today, so we cannot compute a true rejection rate (rejected/total)
 *   from `ops_events` alone. This route returns:
 *     - `totalRejected` (24h) — from ops_events
 *     - `rejectionsByReason` — from ops_events
 *     - `latestRejections` (10) — from ops_events
 *     - `hourlyRejections` (24 buckets) — from ops_events
 *     - `totalEvaluated` is reported as `null` along with a
 *       `notes.acceptedEventMissing=true` flag so the UI can show "—"
 *       instead of a misleading rate.
 *   Follow-up: ai-engineer to add `category='quiz.oracle_accepted'` (or
 *   bump category to `quiz.oracle_evaluated` with a verdict field) so
 *   `rejectionRate` can be computed properly.
 *
 * Response shape (stable contract):
 *   {
 *     success: true,
 *     data: {
 *       windowHours: 24,
 *       totalRejected: number,
 *       totalEvaluated: number | null,        // null until accepted-event lands
 *       rejectionRate: number | null,         // null until accepted-event lands
 *       rejectionsByReason: Record<category, number>,
 *       latestRejections: Array<{
 *         occurred_at: string,
 *         category: string,
 *         reason: string,
 *         question_preview: string | null,
 *         suggested_correct_index: number | null,
 *       }>,
 *       hourlyRejections: Array<{ hour: string; count: number }>,
 *       notes: { acceptedEventMissing: boolean },
 *       generated_at: string,
 *     }
 *   }
 *
 * Cache: 30s via Cache-Control. Matches existing super-admin pattern
 * (grounding/health route does not currently send Cache-Control because
 * the page polls every 30s via setInterval; we add s-maxage=30 here so
 * proxied responses don't pile up if traffic spikes).
 */

export const runtime = 'nodejs';

// Categories the oracle emits. Keep in sync with
// `OracleRejectionCategory` in src/lib/ai/validation/quiz-oracle.ts.
const ORACLE_REJECTION_CATEGORIES = [
  'p6_text_empty_or_placeholder',
  'p6_options_not_4',
  'p6_options_not_distinct',
  'p6_correct_index_out_of_range',
  'p6_explanation_empty',
  'p6_invalid_difficulty',
  'p6_invalid_bloom',
  'options_overlap_semantic',
  'numeric_inconsistency',
  'llm_mismatch',
  'llm_ambiguous',
  'llm_grader_unavailable',
] as const;

const WINDOW_HOURS = 24;
const LATEST_LIMIT = 10;
// Cap on rows fetched for aggregation. Even at 1 rejection per second the
// oracle won't exceed 86_400/day; 50_000 is well above any realistic load
// and protects the route from runaway aggregation cost.
const AGG_FETCH_LIMIT = 50_000;

interface RejectionRow {
  occurred_at: string;
  context: Record<string, unknown> | null;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const nowMs = Date.now();
    const windowStart = new Date(nowMs - WINDOW_HOURS * 3600 * 1000).toISOString();

    // ── 1. Aggregation pull ─────────────────────────────────────────────
    // Pull occurred_at + context for every rejection in the window. Context
    // contains category/reason/question_preview/suggested_correct_index
    // (see bulk-question-gen index.ts lines 458-473).
    const { data: rejectionRows, error: rejectionsErr } = await supabaseAdmin
      .from('ops_events')
      .select('occurred_at, context')
      .eq('category', 'quiz.oracle_rejection')
      .gte('occurred_at', windowStart)
      .order('occurred_at', { ascending: false })
      .limit(AGG_FETCH_LIMIT);

    if (rejectionsErr) {
      throw new Error(`oracle rejection fetch: ${rejectionsErr.message}`);
    }

    const rows: RejectionRow[] = (rejectionRows ?? []) as RejectionRow[];

    // ── 2. Total + by-reason breakdown ─────────────────────────────────
    const rejectionsByReason: Record<string, number> = {};
    for (const c of ORACLE_REJECTION_CATEGORIES) rejectionsByReason[c] = 0;

    let totalRejected = 0;
    for (const row of rows) {
      totalRejected++;
      const cat = readStringField(row.context, 'category') ?? 'unknown';
      // Only bump known buckets; surface any unknown categories under a
      // catch-all so the UI can spot a typo from a future oracle release.
      if (cat in rejectionsByReason) {
        rejectionsByReason[cat]++;
      } else {
        rejectionsByReason[cat] =
          (rejectionsByReason[cat] ?? 0) + 1;
      }
    }

    // ── 3. Latest 10 (rows are already ordered desc) ───────────────────
    const latestRejections = rows.slice(0, LATEST_LIMIT).map((row) => ({
      occurred_at: row.occurred_at,
      category: readStringField(row.context, 'category') ?? 'unknown',
      reason: readStringField(row.context, 'reason') ?? '',
      question_preview: readStringField(row.context, 'question_preview'),
      suggested_correct_index: readNumberField(
        row.context,
        'suggested_correct_index',
      ),
    }));

    // ── 4. Hourly time series (24 buckets, oldest → newest) ────────────
    // Bucket by floor-hour from window start. Empty buckets stay at 0.
    const hourlyBuckets: Array<{ hour: string; count: number }> = [];
    const startMs = nowMs - WINDOW_HOURS * 3600 * 1000;
    for (let i = 0; i < WINDOW_HOURS; i++) {
      const bucketStart = new Date(startMs + i * 3600 * 1000);
      bucketStart.setMinutes(0, 0, 0);
      hourlyBuckets.push({
        hour: bucketStart.toISOString(),
        count: 0,
      });
    }
    for (const row of rows) {
      const t = Date.parse(row.occurred_at);
      if (!Number.isFinite(t)) continue;
      const idx = Math.floor((t - startMs) / (3600 * 1000));
      if (idx >= 0 && idx < hourlyBuckets.length) {
        hourlyBuckets[idx].count++;
      }
    }

    // ── 5. Total evaluated (currently unavailable) ─────────────────────
    // No `quiz.oracle_accepted` event exists yet. Returning null + a flag
    // is more honest than a fake denominator (e.g. count of recent
    // bulk-question-gen runs, which would not match candidate count
    // 1:1).
    const totalEvaluated: number | null = null;
    const rejectionRate: number | null = null;

    return NextResponse.json(
      {
        success: true,
        data: {
          windowHours: WINDOW_HOURS,
          totalRejected,
          totalEvaluated,
          rejectionRate,
          rejectionsByReason,
          latestRejections,
          hourlyRejections: hourlyBuckets,
          notes: {
            acceptedEventMissing: true,
          },
          generated_at: new Date().toISOString(),
        },
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=0, s-maxage=30',
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Internal error',
      },
      { status: 500 },
    );
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────

function readStringField(
  ctx: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!ctx || typeof ctx !== 'object') return null;
  const v = (ctx as Record<string, unknown>)[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return null;
}

function readNumberField(
  ctx: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  if (!ctx || typeof ctx !== 'object') return null;
  const v = (ctx as Record<string, unknown>)[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}
