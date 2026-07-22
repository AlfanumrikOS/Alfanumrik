/**
 * GET /api/super-admin/synthesis-quality
 *
 * Phase 8 item 8.6: surfaces the Monthly-Synthesis LLM-as-judge signal to
 * super-admin so we spot bad/hallucinated parent summaries before they reach
 * many parents. Reads synthesis_quality_scores (populated nightly by
 * /api/cron/synthesis-quality-sample). Mirrors /api/super-admin/foxy-quality.
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       rubricVersion, totalScored,
 *       last7DayAvg: { overall, grounding, tone, noFabrication, scope } | null,
 *       prev7DayAvg: same | null,
 *       weeklyDelta: number | null,
 *       dailyAverages: Array<{ day, count, overall, grounding, ... }>,
 *       lowestRecent:  Array<{ synthesisRunId, studentId, scoredAt, scores...,
 *                              oracleFindings, notes }>
 *     }
 *   }
 *
 * P13: returns scores + judge notes + COUNTS-ONLY oracle findings, keyed on
 * synthesis_run_id + student_id. NEVER the summary body, the bundle, the
 * phone, or the student name.
 *
 * Auth: super-admin only via authorizeRequest('super_admin.access').
 */

import { NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { SYNTHESIS_RUBRIC_VERSION } from '@alfanumrik/lib/ai/validation/synthesis-quality-eval';

export const runtime = 'nodejs';

interface ScoreRow {
  synthesis_run_id: string;
  student_id: string;
  scored_at: string;
  grounding_score: number;
  tone_score: number;
  no_fabrication_score: number;
  cbse_scope_score: number;
  overall_score: number;
  oracle_findings: { unbacked_number_count?: number; unbacked_topic_count?: number } | null;
  notes: string | null;
}

interface AvgScores {
  overall: number;
  grounding: number;
  tone: number;
  noFabrication: number;
  scope: number;
}

function average(rows: ScoreRow[]): AvgScores | null {
  if (rows.length === 0) return null;
  const sum = rows.reduce(
    (acc, r) => ({
      overall: acc.overall + r.overall_score,
      grounding: acc.grounding + r.grounding_score,
      tone: acc.tone + r.tone_score,
      noFabrication: acc.noFabrication + r.no_fabrication_score,
      scope: acc.scope + r.cbse_scope_score,
    }),
    { overall: 0, grounding: 0, tone: 0, noFabrication: 0, scope: 0 },
  );
  return {
    overall: Math.round(sum.overall / rows.length),
    grounding: Math.round(sum.grounding / rows.length),
    tone: Math.round(sum.tone / rows.length),
    noFabrication: Math.round(sum.noFabrication / rows.length),
    scope: Math.round(sum.scope / rows.length),
  };
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await authorizeRequest(request, 'super_admin.access');
    if (!auth.authorized) return auth.errorResponse!;

    const cutoff30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const cutoff7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const cutoff14 = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();

    const { data: rows, error } = await supabaseAdmin
      .from('synthesis_quality_scores')
      .select(
        'synthesis_run_id, student_id, scored_at, grounding_score, tone_score, no_fabrication_score, cbse_scope_score, overall_score, oracle_findings, notes',
      )
      .eq('rubric_version', SYNTHESIS_RUBRIC_VERSION)
      .gte('scored_at', cutoff30)
      .order('scored_at', { ascending: false });

    if (error) {
      logger.error('super-admin.synthesis-quality: fetch failed', { error: error.message });
      return NextResponse.json(
        { success: false, error: 'Fetch failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    const scoreRows = (rows ?? []) as ScoreRow[];

    const last7 = scoreRows.filter((r) => r.scored_at >= cutoff7);
    const prev7 = scoreRows.filter((r) => r.scored_at >= cutoff14 && r.scored_at < cutoff7);
    const last7DayAvg = average(last7);
    const prev7DayAvg = average(prev7);
    const weeklyDelta =
      last7DayAvg && prev7DayAvg ? last7DayAvg.overall - prev7DayAvg.overall : null;

    const buckets = new Map<string, ScoreRow[]>();
    for (const r of scoreRows.filter((r) => r.scored_at >= cutoff14)) {
      const k = dayKey(r.scored_at);
      const arr = buckets.get(k) ?? [];
      arr.push(r);
      buckets.set(k, arr);
    }
    const dailyAverages = Array.from(buckets.entries())
      .map(([day, dayRows]) => {
        const avg = average(dayRows);
        return {
          day,
          count: dayRows.length,
          overall: avg?.overall ?? 0,
          grounding: avg?.grounding ?? 0,
          tone: avg?.tone ?? 0,
          noFabrication: avg?.noFabrication ?? 0,
          scope: avg?.scope ?? 0,
        };
      })
      .sort((a, b) => b.day.localeCompare(a.day));

    const lowestRecent = [...scoreRows]
      .sort((a, b) => {
        if (a.overall_score !== b.overall_score) return a.overall_score - b.overall_score;
        return b.scored_at.localeCompare(a.scored_at);
      })
      .slice(0, 10)
      .map((r) => ({
        synthesisRunId: r.synthesis_run_id,
        studentId: r.student_id,
        scoredAt: r.scored_at,
        overall: r.overall_score,
        grounding: r.grounding_score,
        tone: r.tone_score,
        noFabrication: r.no_fabrication_score,
        scope: r.cbse_scope_score,
        // P13: counts-only oracle findings + judge note describing the score,
        // never the summary body.
        oracleFindings: r.oracle_findings ?? { unbacked_number_count: 0, unbacked_topic_count: 0 },
        notes: r.notes,
      }));

    return NextResponse.json({
      success: true,
      data: {
        rubricVersion: SYNTHESIS_RUBRIC_VERSION,
        totalScored: scoreRows.length,
        last7DayAvg,
        prev7DayAvg,
        weeklyDelta,
        dailyAverages,
        lowestRecent,
      },
    });
  } catch (err) {
    logger.error('super-admin.synthesis-quality: unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL' },
      { status: 500 },
    );
  }
}
