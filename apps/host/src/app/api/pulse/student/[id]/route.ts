/**
 * GET /api/pulse/student/[id] — Student Pulse, RELATIONSHIP lens.
 *
 * ONE route serves every audience that can view a specific student's Pulse:
 * parent (linked child), teacher (assigned student), principal /
 * institution_admin (school student), admin/super_admin (any), and the student
 * themselves (own). The audience is NOT branched here — `canAccessStudent`
 * already encodes own / linked / assigned / institution / admin EXACTLY per the
 * RBAC matrix, so a single ownership check covers all five.
 *
 * Auth contract (defense in depth — BOTH must pass):
 *   1. authorizeRequest(request) — authenticate + load the caller's roles +
 *      permissions (no specific permission required at this step; the route
 *      serves many roles).
 *   2. HARD boundary: canAccessStudent(userId, id). 403 + denied audit if false.
 *      This is THE security boundary (own/linked/assigned/institution/admin).
 *   3. hasAnyPermission([...viewing permissions]) — a relationship WITHOUT a
 *      viewing permission is still denied. So a parent linked to a child must
 *      also hold child.view_progress; a teacher must hold class.view_analytics /
 *      report.view_class; a principal institution.view_analytics; a student
 *      progress.view_own. 403 + denied audit if none held.
 *
 * Data access: service-role admin client AFTER both gates (P8). P13: only the
 * target's derived signals + non-PII timeline summaries; denials are audited.
 *
 * Returns: 400 bad id, 401 unauth, 403 forbidden, 404 unknown student, 500.
 */

import { NextResponse } from 'next/server';
import {
  authorizeRequest,
  canAccessStudent,
  hasAnyPermission,
  logAudit,
} from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isValidUUID } from '@alfanumrik/lib/sanitize';
import { buildSingleStudentPulse } from '@alfanumrik/lib/pulse/pulse-server';
import type { PulseResponse } from '@alfanumrik/lib/pulse/types';

const ROUTE = '/api/pulse/student/[id]';

/** Viewing permissions — holding ANY one (with a valid relationship) grants. */
const VIEW_PERMISSIONS = [
  'progress.view_own', // student (self)
  'child.view_progress', // parent
  'class.view_analytics', // teacher
  'report.view_class', // teacher / coordinator
  'institution.view_analytics', // principal / institution_admin
];

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    // ── 1. Authenticate (load roles/perms; no single permission required) ──
    const auth = await authorizeRequest(request);
    if (!auth.authorized) return auth.errorResponse!;
    const callerId = auth.userId!;

    // ── 2. Validate path param ───────────────────────────────────────
    const { id: studentId } = await context.params;
    if (!studentId || !isValidUUID(studentId)) {
      return NextResponse.json(
        { success: false, error: 'Valid student id is required' },
        { status: 400 },
      );
    }

    // ── 3. HARD ownership boundary (own/linked/assigned/institution/admin) ──
    const canAccess = await canAccessStudent(callerId, studentId);
    if (!canAccess) {
      logAudit(callerId, {
        action: 'pulse.student_viewed',
        resourceType: 'students',
        resourceId: studentId,
        status: 'denied',
        details: { reason: 'no_relationship' },
      });
      return NextResponse.json(
        { success: false, error: 'Access denied to this student' },
        { status: 403 },
      );
    }

    // ── 4. Viewing-permission gate (relationship alone is not enough) ──
    const canView = await hasAnyPermission(callerId, VIEW_PERMISSIONS);
    if (!canView) {
      logAudit(callerId, {
        action: 'pulse.student_viewed',
        resourceType: 'students',
        resourceId: studentId,
        status: 'denied',
        details: { reason: 'no_view_permission' },
      });
      return NextResponse.json(
        { success: false, error: 'You do not have permission to view student progress' },
        { status: 403 },
      );
    }

    // ── 5. Resolve the target student's auth_user_id ─────────────────
    const { data: target, error: targetErr } = await supabaseAdmin
      .from('students')
      .select('auth_user_id')
      .eq('id', studentId)
      .maybeSingle();

    if (targetErr) {
      logger.error('pulse_student_lookup_failed', {
        route: ROUTE,
        error: new Error(targetErr.message),
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load student' },
        { status: 500 },
      );
    }
    if (!target || !target.auth_user_id) {
      // Student row missing or has no linked auth user — nothing to derive.
      return NextResponse.json(
        { success: false, error: 'Student not found' },
        { status: 404 },
      );
    }

    // ── 6. Build the Pulse ───────────────────────────────────────────
    let pulse: PulseResponse;
    try {
      pulse = await buildSingleStudentPulse(supabaseAdmin, target.auth_user_id);
    } catch (e) {
      logger.warn('pulse_student_build_failed', { route: ROUTE });
      return NextResponse.json(
        { success: false, error: 'Student has no learner profile' },
        { status: 404 },
      );
    }

    // Successful view audit (fire-and-forget).
    logAudit(callerId, {
      action: 'pulse.student_viewed',
      resourceType: 'students',
      resourceId: studentId,
      status: 'success',
    });

    return NextResponse.json(
      { success: true, data: pulse },
      { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } },
    );
  } catch (err) {
    logger.error('pulse_student_failed', {
      route: ROUTE,
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
