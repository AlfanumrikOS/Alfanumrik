/**
 * GET /api/super-admin/foxy-quality
 *
 * B'-1 Phase 2: surfaces the LLM-as-judge eval signal to super-admin so
 * we can spot quality drift before students do. Reads from
 * foxy_quality_scores (populated nightly by /api/cron/foxy-quality-sample).
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       totalScored:   number,                  // last 30d, current rubric
 *       last7DayAvg:   { overall, accuracy, scaffold, age, scope },
 *       prev7DayAvg:   same shape — null when no prior week of data,
 *       weeklyDelta:   number | null,           // overall avg delta in points
 *       dailyAverages: Array<{ day, count, overall, accuracy, ... }>,
 *       lowestRecent:  Array<{ messageId, sessionId, scoredAt, scores...,
 *                              notes }>
 *     }
 *   }
 *
 * P13: returns scores + notes only. NEVER returns the message body, the
 * student's question, the citations, or the studentId. The super-admin
 * UI surfaces a "Open in workbench" link keyed on message_id for the
 * deep-dive flow (a separate, fully RBAC'd surface that already exists).
 *
 * Auth: super-admin only via authorizeRequest('super_admin.access').
 */

import { NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { RUBRIC_VERSION } from '@alfanumrik/lib/foxy/quality-eval';

export const runtime = 'nodejs';

interface ScoreRow {
  message_id: string;
  session_id: string;
  scored_at: string;
  accuracy_score: number;
  scaffold_fidelity_score: number;
  age_appropriateness_score: number;
  cbse_scope_score: number;
  overall_score: number;
  notes: string | null;
}

interface AvgScores {
  overall: number;
  accuracy: number;
  scaffold: number;
  age: number;
  scope: number;
}

function average(rows: ScoreRow[]): AvgScores | null {
  if (rows.length === 0) return null;
  const sum = rows.reduce(
    (acc, r) => ({
      overall: acc.overall + r.overall_score,
      accuracy: acc.accuracy + r.accuracy_score,
      scaffold: acc.scaffold + r.scaffold_fidelity_score,
      age: acc.age + r.age_appropriateness_score,
      scope: acc.scope + r.cbse_scope_score,
    }),
    { overall: 0, accuracy: 0, scaffold: 0, age: 0, scope: 0 },
  );
  return {
    overall: Math.round(sum.overall / rows.length),
    accuracy: Math.round(sum.accuracy / rows.length),
    scaffold: Math.round(sum.scaffold / rows.length),
    age: Math.round(sum.age / rows.length),
    scope: Math.round(sum.scope / rows.length),
  };
}

function dayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD (UTC)
}

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await authorizeRequest(request, 'super_admin.access');
    if (!auth.authorized) return auth.errorResponse!;

    const cutoff30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const cutoff7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const cutoff14 = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();

    const { data: rows, error } = await supabaseAdmin
      .from('foxy_quality_scores')
      .select(
        'message_id, session_id, scored_at, accuracy_score, scaffold_fidelity_score, age_appropriateness_score, cbse_scope_score, overall_score, notes',
      )
      .eq('rubric_version', RUBRIC_VERSION)
      .gte('scored_at', cutoff30)
      .order('scored_at', { ascending: false });

    if (error) {
      logger.error('super-admin.foxy-quality: fetch failed', { error: error.message });
      return NextResponse.json(
        { success: false, error: 'Fetch failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    const scoreRows = (rows ?? []) as ScoreRow[];

    // Last 7 days vs the prior 7 days for drift detection.
    const last7 = scoreRows.filter((r) => r.scored_at >= cutoff7);
    const prev7 = scoreRows.filter((r) => r.scored_at >= cutoff14 && r.scored_at < cutoff7);
    const last7DayAvg = average(last7);
    const prev7DayAvg = average(prev7);
    const weeklyDelta =
      last7DayAvg && prev7DayAvg ? last7DayAvg.overall - prev7DayAvg.overall : null;

    // Per-day buckets for the trend table (14 days).
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
          accuracy: avg?.accuracy ?? 0,
          scaffold: avg?.scaffold ?? 0,
          age: avg?.age ?? 0,
          scope: avg?.scope ?? 0,
        };
      })
      .sort((a, b) => b.day.localeCompare(a.day));

    // Lowest 10 recent (last 30d) for triage. Sort by overall ASC, tie-break
    // by scored_at DESC so newer outliers float up over older ones.
    const lowestRecent = [...scoreRows]
      .sort((a, b) => {
        if (a.overall_score !== b.overall_score) return a.overall_score - b.overall_score;
        return b.scored_at.localeCompare(a.scored_at);
      })
      .slice(0, 10)
      .map((r) => ({
        messageId: r.message_id,
        sessionId: r.session_id,
        scoredAt: r.scored_at,
        overall: r.overall_score,
        accuracy: r.accuracy_score,
        scaffold: r.scaffold_fidelity_score,
        age: r.age_appropriateness_score,
        scope: r.cbse_scope_score,
        // P13: notes are the judge's free-text on the lowest dimension.
        // They describe the score, not the message body — safe to surface.
        notes: r.notes,
      }));

    return NextResponse.json({
      success: true,
      data: {
        rubricVersion: RUBRIC_VERSION,
        totalScored: scoreRows.length,
        last7DayAvg,
        prev7DayAvg,
        weeklyDelta,
        dailyAverages,
        lowestRecent,
      },
    });
  } catch (err) {
    logger.error('super-admin.foxy-quality: unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL' },
      { status: 500 },
    );
  }
}
