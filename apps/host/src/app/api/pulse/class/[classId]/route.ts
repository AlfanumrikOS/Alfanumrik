/**
 * GET /api/pulse/class/[classId] — Student Pulse, CLASS lens (teacher).
 *
 * A LIGHTWEIGHT, worst-signal-first list of pulse rows (status + signals, NO
 * full timeline) for every active student in a class the caller-teacher owns.
 * Built from BULK queries (one roster query, one learner_mastery query, one
 * state_events query scoped to the roster) — never N× buildStudentState — so it
 * stays cheap at class scale.
 *
 * Auth contract:
 *   1. authorizeRequest(request, 'class.view_analytics') — P9 RBAC gate (the
 *      teacher's matrix permission for the class lens per design spec §5).
 *   2. Class ownership: the caller's teacher row (teachers.auth_user_id =
 *      auth.uid()) must be linked to classId via class_teachers (active). 403
 *      otherwise. Mirrors assertTeacherOwnsClass in supabase/functions/
 *      teacher-dashboard, re-implemented server-side against class_teachers.
 *
 * Data access: service-role admin client AFTER both gates (P8). P13: roster
 * names + grades are already teacher-visible; only derived signals are added.
 *
 * Returns: 400 bad id, 401 unauth, 403 forbidden/not-owner, 500.
 */

import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isValidUUID } from '@alfanumrik/lib/sanitize';
import { buildClassPulseItems } from '@alfanumrik/lib/pulse/pulse-server';
import type { ClassPulseResponse, PulseListItem } from '@alfanumrik/lib/pulse/types';

const ROUTE = '/api/pulse/class/[classId]';

/** Hard cap on roster size pulled in one request (scale guardrail). */
const MAX_ROSTER = 200;

export const dynamic = 'force-dynamic';

interface RosterStudentRow {
  id: string;
  auth_user_id: string | null;
  name: string | null;
  grade: string | null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    // ── 1. RBAC gate (P9) ────────────────────────────────────────────
    const auth = await authorizeRequest(request, 'class.view_analytics');
    if (!auth.authorized) return auth.errorResponse!;
    const callerId = auth.userId!;

    // ── 2. Validate path param ───────────────────────────────────────
    const { classId } = await context.params;
    if (!classId || !isValidUUID(classId)) {
      return NextResponse.json(
        { success: false, error: 'Valid class id is required' },
        { status: 400 },
      );
    }

    // ── 3. Resolve the caller's teacher row ──────────────────────────
    const { data: teacher, error: teacherErr } = await supabaseAdmin
      .from('teachers')
      .select('id')
      .eq('auth_user_id', callerId)
      .eq('is_active', true)
      .maybeSingle();

    if (teacherErr) {
      logger.error('pulse_class_teacher_lookup_failed', {
        route: ROUTE,
        error: new Error(teacherErr.message),
      });
      return NextResponse.json(
        { success: false, error: 'Failed to verify teacher status' },
        { status: 500 },
      );
    }
    if (!teacher) {
      // Holds class.view_analytics but is not an active teacher → deny.
      logAudit(callerId, {
        action: 'pulse.class_viewed',
        resourceType: 'classes',
        resourceId: classId,
        status: 'denied',
        details: { reason: 'not_a_teacher' },
      });
      return NextResponse.json(
        { success: false, error: 'Not an active teacher' },
        { status: 403 },
      );
    }

    // ── 4. Class ownership: teacher ↔ class via class_teachers (active) ──
    const { data: ownsLink, error: ownsErr } = await supabaseAdmin
      .from('class_teachers')
      .select('class_id')
      .eq('class_id', classId)
      .eq('teacher_id', teacher.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (ownsErr) {
      logger.error('pulse_class_ownership_lookup_failed', {
        route: ROUTE,
        error: new Error(ownsErr.message),
      });
      return NextResponse.json(
        { success: false, error: 'Failed to verify class ownership' },
        { status: 500 },
      );
    }
    if (!ownsLink) {
      logAudit(callerId, {
        action: 'pulse.class_viewed',
        resourceType: 'classes',
        resourceId: classId,
        status: 'denied',
        details: { reason: 'not_class_owner' },
      });
      return NextResponse.json(
        { success: false, error: 'You do not teach this class' },
        { status: 403 },
      );
    }

    // ── 5. Bulk-load the active roster (one query) ───────────────────
    const { data: roster, error: rosterErr } = await supabaseAdmin
      .from('class_students')
      .select('students(id, auth_user_id, name, grade)')
      .eq('class_id', classId)
      .eq('is_active', true)
      .limit(MAX_ROSTER);

    if (rosterErr) {
      logger.error('pulse_class_roster_lookup_failed', {
        route: ROUTE,
        error: new Error(rosterErr.message),
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load class roster' },
        { status: 500 },
      );
    }

    // Flatten the join + drop soft-deleted / missing student rows.
    const students: RosterStudentRow[] = [];
    const seen = new Set<string>();
    for (const row of (roster ?? []) as Array<{ students: RosterStudentRow | RosterStudentRow[] | null }>) {
      const s = Array.isArray(row.students) ? row.students[0] : row.students;
      if (!s || !s.id || seen.has(s.id)) continue;
      seen.add(s.id);
      students.push({
        id: s.id,
        auth_user_id: s.auth_user_id ?? null,
        name: s.name ?? null,
        grade: s.grade ?? null,
      });
    }

    // ── 6. Assemble the lightweight pulse list (worst-first) ─────────
    const items: PulseListItem[] = await buildClassPulseItems(
      supabaseAdmin,
      students,
    );

    const body: ClassPulseResponse = {
      classId,
      students: items,
      count: items.length,
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(
      { success: true, data: body },
      { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } },
    );
  } catch (err) {
    logger.error('pulse_class_failed', {
      route: ROUTE,
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
