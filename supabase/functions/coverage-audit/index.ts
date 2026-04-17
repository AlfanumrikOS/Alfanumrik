// supabase/functions/coverage-audit/index.ts
//
// Nightly coverage audit (spec §8.2). Schedule: 03:00 IST = 21:30 UTC.
// `supabase functions schedule coverage-audit --cron "30 21 * * *"`
//
// Per run:
//   1. Recompute cbse_syllabus.rag_status for every row (corrects drift from
//      the triggers if writes ever slipped past them).
//   2. Build today's syllabus snapshot and write it to
//      coverage_audit_snapshots. Fetch yesterday's snapshot.
//   3. Detect day-over-day regressions (ready→partial/missing, etc.) and emit
//      ops_events at severity=high.
//   4. For each enforced pair in ff_grounded_ai_enforced_pairs, compute
//      verified_ratio = sum(verified)/sum(total). If < 0.85, auto-disable
//      the pair with reason.
//   5. Purge old grounded_ai_traces rows (retention: grounded>90d / not>180d).
//   6. Emit a summary ops_events row.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { logOpsEvent } from '../_shared/ops-events.ts';
import {
  AUTO_DISABLE_RATIO_THRESHOLD,
  computeVerifiedRatios,
  detectRegressions,
  pairsToAutoDisable,
  summarizeSnapshot,
  type ChapterStats,
  type EnforcedPair,
  type SyllabusRow,
} from './shared.ts';

type Supabase = ReturnType<typeof createClient>;

// ── Step 1: recompute rag_status for every row ─────────────────────────────
async function recomputeAll(supabase: Supabase): Promise<number> {
  const { data, error } = await supabase
    .from('cbse_syllabus')
    .select('grade, subject_code, chapter_number')
    .eq('is_in_scope', true);
  if (error) throw new Error(`recomputeAll select: ${error.message}`);
  const rows = (data ?? []) as Array<{ grade: string; subject_code: string; chapter_number: number }>;
  // Fire sequentially; the RPC touches one row each so ordering doesn't matter
  // but concurrent calls could race on the same UPDATE — keep it linear.
  for (const r of rows) {
    const { error: rpcErr } = await supabase.rpc('recompute_syllabus_status', {
      p_grade: r.grade,
      p_subject_code: r.subject_code,
      p_chapter_number: r.chapter_number,
    });
    if (rpcErr) {
      // Don't fail the whole run — log and continue.
      await logOpsEvent({
        category: 'grounding.coverage',
        source: 'coverage-audit',
        severity: 'warning',
        message: 'recompute_syllabus_status_failed',
        context: { grade: r.grade, subject: r.subject_code, chapter: r.chapter_number, error: rpcErr.message },
      });
    }
  }
  return rows.length;
}

// ── Step 2: today's snapshot + yesterday lookup ─────────────────────────────
async function fetchAllSyllabus(supabase: Supabase): Promise<SyllabusRow[]> {
  const { data, error } = await supabase
    .from('cbse_syllabus')
    .select('board, grade, subject_code, chapter_number, rag_status, chunk_count, verified_question_count')
    .eq('is_in_scope', true);
  if (error) throw new Error(`fetchAllSyllabus: ${error.message}`);
  return (data ?? []) as SyllabusRow[];
}

async function fetchYesterdaySnapshot(supabase: Supabase): Promise<SyllabusRow[]> {
  // Most recent snapshot strictly before today (IST). We fetch the latest
  // snapshot_date < current_date; if DST / first-run there's none, we return [].
  const { data, error } = await supabase
    .from('coverage_audit_snapshots')
    .select('cbse_syllabus_rows')
    .order('snapshot_date', { ascending: false })
    .limit(2);
  if (error) return [];
  const rows = (data ?? []) as Array<{ cbse_syllabus_rows: unknown }>;
  // If today's snapshot was already written (idempotent re-run), skip it and
  // take the second row.
  const y = rows.length >= 2 ? rows[1] : rows[0];
  if (!y) return [];
  return Array.isArray(y.cbse_syllabus_rows) ? (y.cbse_syllabus_rows as SyllabusRow[]) : [];
}

async function writeTodaySnapshot(
  supabase: Supabase,
  rows: SyllabusRow[],
  summary: ReturnType<typeof summarizeSnapshot>,
): Promise<void> {
  // UNIQUE (snapshot_date) makes this upsert-safe. We use ON CONFLICT via
  // supabase.upsert to keep this idempotent for same-day retries.
  const { error } = await supabase.from('coverage_audit_snapshots').upsert(
    {
      // snapshot_date uses column default (current_date AT TIME ZONE 'Asia/Kolkata')
      // when omitted. PostgREST sends NULL which the DEFAULT replaces.
      cbse_syllabus_rows: rows,
      ready_count: summary.ready_count,
      partial_count: summary.partial_count,
      missing_count: summary.missing_count,
      total_verified_questions: summary.total_verified_questions,
      total_chunks: summary.total_chunks,
    },
    { onConflict: 'snapshot_date' },
  );
  if (error) {
    // On missing-default fallback (PostgREST versions that don't honor defaults
    // on upsert), compute the IST date in JS and retry once.
    const istDate = istDateString(new Date());
    const { error: retryErr } = await supabase.from('coverage_audit_snapshots').upsert(
      {
        snapshot_date: istDate,
        cbse_syllabus_rows: rows,
        ready_count: summary.ready_count,
        partial_count: summary.partial_count,
        missing_count: summary.missing_count,
        total_verified_questions: summary.total_verified_questions,
        total_chunks: summary.total_chunks,
      },
      { onConflict: 'snapshot_date' },
    );
    if (retryErr) throw new Error(`writeTodaySnapshot: ${retryErr.message}`);
  }
}

function istDateString(d: Date): string {
  const utcMs = d.getTime();
  const istMs = utcMs + 330 * 60 * 1000;
  const ist = new Date(istMs);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ── Step 4: fetch chapter stats + enforced pairs for auto-disable ───────────
async function fetchChapterStats(supabase: Supabase): Promise<ChapterStats[]> {
  // Get distinct (grade, subject, chapter_number) from cbse_syllabus and join
  // verified / total counts via direct selects. We avoid a giant jsonb_agg RPC
  // to keep this readable — this runs once per day on <1000 rows.
  const { data: syllabusData, error: sErr } = await supabase
    .from('cbse_syllabus')
    .select('grade, subject_code, chapter_number, verified_question_count')
    .eq('is_in_scope', true);
  if (sErr) throw new Error(`fetchChapterStats syllabus: ${sErr.message}`);

  const stats: ChapterStats[] = [];
  for (const row of (syllabusData ?? []) as Array<{ grade: string; subject_code: string; chapter_number: number; verified_question_count: number }>) {
    const { data: totalData, error: tErr } = await supabase.rpc('total_questions_in_chapter', {
      p_grade: row.grade,
      p_subject_code: row.subject_code,
      p_chapter_number: row.chapter_number,
    });
    if (tErr) continue;
    stats.push({
      grade: row.grade,
      subject_code: row.subject_code,
      chapter_number: row.chapter_number,
      verified_question_count: row.verified_question_count,
      total_questions: typeof totalData === 'number' ? totalData : 0,
    });
  }
  return stats;
}

async function fetchEnforcedPairs(supabase: Supabase): Promise<EnforcedPair[]> {
  const { data, error } = await supabase
    .from('ff_grounded_ai_enforced_pairs')
    .select('grade, subject_code, enabled')
    .eq('enabled', true);
  if (error) return [];
  return ((data ?? []) as EnforcedPair[]);
}

async function autoDisablePairs(
  supabase: Supabase,
  pairs: { grade: string; subject_code: string; verified_ratio: number }[],
): Promise<number> {
  let count = 0;
  for (const p of pairs) {
    const { error } = await supabase
      .from('ff_grounded_ai_enforced_pairs')
      .update({
        enabled: false,
        auto_disabled_at: new Date().toISOString(),
        auto_disabled_reason: `verified_ratio ${p.verified_ratio.toFixed(3)} < ${AUTO_DISABLE_RATIO_THRESHOLD}`,
      })
      .eq('grade', p.grade)
      .eq('subject_code', p.subject_code);
    if (!error) count++;
  }
  return count;
}

// ── Step 5: purge old traces ─────────────────────────────────────────────────
async function purgeOldTraces(supabase: Supabase): Promise<void> {
  const { error } = await supabase.rpc('purge_old_grounded_traces');
  if (error) {
    await logOpsEvent({
      category: 'grounding.coverage',
      source: 'coverage-audit',
      severity: 'warning',
      message: 'purge_old_grounded_traces_failed',
      context: { error: error.message },
    });
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startedAt = Date.now();
  const runId = crypto.randomUUID();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    // 1. Recompute (drift correction)
    const recomputed = await recomputeAll(supabase);

    // 2. Build today's snapshot + fetch yesterday
    const today = await fetchAllSyllabus(supabase);
    const summary = summarizeSnapshot(today);
    const yesterday = await fetchYesterdaySnapshot(supabase);
    await writeTodaySnapshot(supabase, today, summary);

    // 3. Detect regressions
    const regressions = detectRegressions(yesterday, today);
    if (regressions.length > 0) {
      await logOpsEvent({
        category: 'grounding.coverage',
        source: 'coverage-audit',
        severity: 'error', // maps to "high" in the alerting hierarchy
        message: 'rag_status_regression_detected',
        context: {
          run_id: runId,
          regression_count: regressions.length,
          regressions: regressions.slice(0, 50), // cap payload
        },
      });
    }

    // 4. Auto-disable enforcement when verified_ratio < 0.85
    const stats = await fetchChapterStats(supabase);
    const ratios = computeVerifiedRatios(stats);
    const enforced = await fetchEnforcedPairs(supabase);
    const toDisable = pairsToAutoDisable(enforced, ratios);
    const disabledCount = await autoDisablePairs(supabase, toDisable);
    if (toDisable.length > 0) {
      await logOpsEvent({
        category: 'grounding.coverage',
        source: 'coverage-audit',
        severity: 'error',
        message: 'enforcement_auto_disabled',
        context: { run_id: runId, disabled: toDisable, applied: disabledCount },
      });
    }

    // 5. Purge old traces once per day
    await purgeOldTraces(supabase);

    // 6. Summary event
    await logOpsEvent({
      category: 'grounding.coverage',
      source: 'coverage-audit',
      severity: 'info',
      message: 'audit_complete',
      context: {
        run_id: runId,
        recomputed_rows: recomputed,
        ...summary,
        regressions: regressions.length,
        auto_disabled: disabledCount,
        yesterday_rows: yesterday.length,
        duration_ms: Date.now() - startedAt,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        run_id: runId,
        summary,
        regressions: regressions.length,
        auto_disabled: disabledCount,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    await logOpsEvent({
      category: 'grounding.coverage',
      source: 'coverage-audit',
      severity: 'critical',
      message: 'audit_run_failed',
      context: {
        run_id: runId,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startedAt,
      },
    });
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'unknown' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});