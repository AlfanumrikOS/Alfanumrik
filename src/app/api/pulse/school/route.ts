/**
 * GET /api/pulse/school — Student Pulse, SCHOOL lens (principal / institution_admin).
 *
 * A school-level Pulse summary: headline counts + average mastery
 * (get_school_overview) and a most-at-risk-first per-class rollup
 * (get_classes_at_risk). REUSES the Phase 3B read models verbatim — it does NOT
 * re-aggregate the school from scratch.
 *
 * Auth contract:
 *   - resolveCommandCenterContext() (src/lib/school-admin/command-center-context)
 *     does ALL of it: P9 gate via authorizeRequest('institution.view_analytics'),
 *     builds the USER-CONTEXT (JWT-bound) Supabase client the SECURITY DEFINER
 *     RPCs need (so their internal `school_admins.auth_user_id = auth.uid()`
 *     scope guard passes), and resolves the caller's active school_id server-
 *     side via school_admins (never trusting a client value; optional
 *     ?school_id only honored when it's one of the caller's active schools).
 *
 * Data access: the RPCs are SECURITY DEFINER + internally school-scope-guarded;
 * the JWT-bound client is the boundary (P8 — no supabase-admin here). P13: the
 * summary is AGGREGATE counts only — no per-student PII.
 *
 * Returns: 400 multi-school-needs-?school_id, 401 unauth, 403 forbidden, 500.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  resolveCommandCenterContext,
  rpcErrorResponse,
} from '@/lib/school-admin/command-center-context';
import type {
  SchoolOverview,
  ClassAtRiskRow,
} from '@/lib/school-admin/command-center-types';
import { logger } from '@/lib/logger';
import type { SchoolPulse, SchoolPulseClassRow } from '@/lib/pulse/types';

const ROUTE = '/api/pulse/school';

/** How many at-risk classes to surface in the school Pulse summary. */
const AT_RISK_CLASS_LIMIT = 20;

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // ── 1. Authorize + resolve school context (P9 + JWT client + school_id) ──
    const resolved = await resolveCommandCenterContext(request, ROUTE);
    if (!resolved.ok) return resolved.response;
    const { supabase, schoolId } = resolved.ctx;

    // ── 2. Reuse Phase 3B read models (no scratch aggregation) ───────
    const [overviewRes, atRiskRes] = await Promise.all([
      supabase.rpc('get_school_overview', { p_school_id: schoolId }),
      supabase.rpc('get_classes_at_risk', {
        p_school_id: schoolId,
        p_limit: AT_RISK_CLASS_LIMIT,
        p_offset: 0,
      }),
    ]);

    if (overviewRes.error) return rpcErrorResponse(overviewRes.error, ROUTE);
    if (atRiskRes.error) return rpcErrorResponse(atRiskRes.error, ROUTE);

    const overview = (overviewRes.data ?? null) as SchoolOverview | null;
    const atRiskRows = (atRiskRes.data ?? []) as ClassAtRiskRow[];

    // ── 3. Shape into the SchoolPulse contract ───────────────────────
    const classesAtRisk: SchoolPulseClassRow[] = atRiskRows.map((r) => ({
      classId: r.class_id,
      className: r.class_name,
      grade: r.grade ?? null,
      studentCount: r.student_count,
      atRiskCount: r.at_risk_count,
      avgMastery: r.avg_mastery ?? null,
    }));

    const body: SchoolPulse = {
      schoolId,
      overview: {
        classCount: overview?.class_count ?? 0,
        teacherCount: overview?.teacher_count ?? 0,
        studentCount: overview?.student_count ?? 0,
        avgMastery: overview?.avg_mastery ?? null,
      },
      classesAtRisk,
      dataState: overview?.data_state === 'live' ? 'live' : 'no_data',
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(
      { success: true, data: body },
      { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' } },
    );
  } catch (err) {
    logger.error('pulse_school_failed', {
      route: ROUTE,
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
