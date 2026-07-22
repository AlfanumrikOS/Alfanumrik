import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';

/**
 * GET /api/super-admin/adaptive-loops
 *
 * Master Action Plan Phase 8, item 8.1 — adaptive-loops health surface for the
 * super-admin dashboard (/super-admin/adaptive-loops). Returns the SAME
 * aggregate-only snapshot the nightly monitor cron evaluates
 * (get_adaptive_loops_health), so the on-screen numbers and the alert-firing
 * numbers share one source of truth:
 *   - daily-new interventions by trigger_signal (mastery_cliff / inactivity /
 *     at_risk_concentration / blocked_prerequisite — Loop A/B/C/D),
 *   - per-student ceiling-violation counts (>1 new/student/day over 7d),
 *   - 30d escalation share,
 *   - the adaptive-remediation cron last-success heartbeat.
 *
 * P13 — AGGREGATE ONLY. The RPC is SECURITY DEFINER and returns counts /
 * ratios / timestamps only; no student id, subject/chapter target, or
 * PII-shaped value ever crosses this boundary (same posture as the Pulse
 * school-lens). This route adds no per-student data.
 *
 * Auth: super_admin.access permission (same convention as the sibling
 * diagnostics readers, e.g. /api/super-admin/ai/irt-readiness).
 */

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const { data, error } = await supabaseAdmin.rpc('get_adaptive_loops_health', {
      p_window_hours: 24,
      p_storm_days: 30,
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      );
    }

    // The RPC returns a single JSONB object (aggregate-only). Pass it through
    // verbatim — there is nothing per-student to filter.
    return NextResponse.json({ success: true, data: data ?? null });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
