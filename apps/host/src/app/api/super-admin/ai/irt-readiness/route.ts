import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';

/**
 * GET /api/super-admin/ai/irt-readiness
 *
 * Master Action Plan Phase 4, Item 4.3 — IRT question-selection readiness
 * diagnostics. `ff_irt_question_selection` is deliberately OFF today (the
 * fisher_info branch only activates for items with irt_calibration_n >= 30 —
 * see packages/lib/src/irt/fisher-info.ts and the SQL twin
 * select_questions_by_irt_info). The nightly cron /api/cron/irt-calibrate
 * (recalibrate_question_irt_2pl(NULL, 30)) only stamps irt_calibration_n
 * onto a question when a fit actually SUCCEEDS; rows that never clear the
 * gates (not enough attempts yet, degenerate correct-rate, no IRLS
 * convergence) keep it at their prior value. This route answers: of the
 * questions actually eligible for calibration (is_active + at least one
 * quiz_responses row — the two base filters the calibrator itself uses,
 * WITHOUT its additional 7-day irt_calibrated_at staleness gate, which only
 * shrinks a single night's run and would distort this readiness denominator),
 * what fraction has crossed the n>=30 floor, overall and per subject/grade.
 *
 * This is diagnostics/visibility ONLY. It never reads or writes
 * ff_irt_question_selection and never changes serving behavior.
 *
 * Auth: super_admin.access permission (same convention as
 * /api/super-admin/grounding/health).
 */

export const runtime = 'nodejs';

interface ReadinessRow {
  subject: string | null;
  grade: string | null;
  total_active_served: number;
  calibrated_n_ge_30: number;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const { data, error } = await supabaseAdmin.rpc('get_irt_calibration_readiness');

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      );
    }

    const rows = (Array.isArray(data) ? data : []) as ReadinessRow[];

    let totalActiveServed = 0;
    let totalCalibrated = 0;
    for (const r of rows) {
      totalActiveServed += r.total_active_served ?? 0;
      totalCalibrated += r.calibrated_n_ge_30 ?? 0;
    }

    const overallReadinessRatio =
      totalActiveServed === 0 ? 0 : Math.round((totalCalibrated / totalActiveServed) * 10000) / 10000;

    const breakdown = rows.map((r) => ({
      subject: r.subject ?? 'unknown',
      grade: r.grade ?? 'unknown',
      total_active_served: r.total_active_served ?? 0,
      calibrated_n_ge_30: r.calibrated_n_ge_30 ?? 0,
      readiness_ratio:
        (r.total_active_served ?? 0) === 0
          ? 0
          : Math.round(((r.calibrated_n_ge_30 ?? 0) / (r.total_active_served ?? 1)) * 10000) / 10000,
    }));

    return NextResponse.json({
      success: true,
      data: {
        // Deliberately NOT the flag's own read — visibility only, flag stays OFF.
        flag_name: 'ff_irt_question_selection',
        total_active_served: totalActiveServed,
        total_calibrated_n_ge_30: totalCalibrated,
        overall_readiness_ratio: overallReadinessRatio,
        breakdown,
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
