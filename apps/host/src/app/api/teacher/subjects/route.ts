/**
 * GET /api/teacher/subjects
 *
 * Returns the teacher-scoped allowed subjects for the authenticated teacher.
 * Intersects `teachers.subjects_taught` (TEXT[]) with the active `subjects`
 * master (is_active = true) and shapes the response to match the existing
 * frontend `Subject` contract in `src/lib/subjects.types.ts`.
 *
 * Teacher-specific rules:
 *   - `isLocked` is always false (no plan-gating for teachers).
 *   - `isCore` is derived from `subject_kind === 'cbse_core'`.
 *   - If `subjects_taught` is empty/null, returns `{ subjects: [] }` (not an error).
 *   - If a stored code is not in the active master (stale), it is silently
 *     dropped from the response.
 *
 * `allSubjects` (added for the teacher profile "edit subjects" self-serve UI —
 * see 2026-07-21 teacher-dashboard-deep-rca incident): the FULL active
 * subjects master, independent of the teacher's current `subjects_taught`.
 * A teacher whose `subjects_taught` is empty/null still needs a catalogue to
 * pick FROM — the existing `subjects` field can't serve that purpose because
 * it's already intersected with (possibly empty) `subjects_taught`.
 * Additive field; existing consumers of `subjects` are unaffected.
 *
 * Auth: authorizeRequest(request, 'class.manage') — the canonical teacher
 * gate used by other teacher routes. Super-admins and admins bypass via RBAC.
 *
 * Response shape:
 *   { success: true, subjects: Subject[], allSubjects: Subject[] }
 *   { success: false, error: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import type { Subject } from '@alfanumrik/lib/subjects.types';

type RawSubject = {
  code: string;
  name: string;
  name_hi: string | null;
  icon: string | null;
  color: string | null;
  subject_kind: 'cbse_core' | 'cbse_elective' | 'platform_elective' | null;
  is_active: boolean;
  display_order: number | null;
};

function toTeacherSubject(r: RawSubject): Subject {
  const kind = r.subject_kind ?? 'cbse_core';
  return {
    code: r.code,
    name: r.name,
    nameHi: r.name_hi ?? r.name,
    icon: r.icon ?? '',
    color: r.color ?? '',
    subjectKind: kind,
    isCore: kind === 'cbse_core',
    // Teachers are never plan-gated for their own taught subjects.
    isLocked: false,
  };
}

export async function GET(request: NextRequest) {
  // 1. Authz — teacher-level permission code
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) {
    return auth.errorResponse as unknown as NextResponse;
  }

  try {
    // 2. Resolve teacher row for auth user
    const { data: teacher, error: teacherErr } = await supabaseAdmin
      .from('teachers')
      .select('id, subjects_taught')
      .eq('auth_user_id', auth.userId!)
      .maybeSingle();

    if (teacherErr) {
      logger.error('teacher_subjects_lookup_failed', {
        error: new Error(teacherErr.message),
        route: 'teacher/subjects',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load teacher profile' },
        { status: 500 },
      );
    }

    if (!teacher) {
      return NextResponse.json(
        { success: false, error: 'Teacher account not found' },
        { status: 404 },
      );
    }

    const taught: string[] = Array.isArray(teacher.subjects_taught)
      ? (teacher.subjects_taught as string[]).filter(
          (c) => typeof c === 'string' && c.trim().length > 0,
        )
      : [];

    // 3. Always load the full active subjects master — needed for the
    // teacher-profile "edit subjects" self-serve picker (`allSubjects`) even
    // when `taught` is empty. See module doc comment above.
    const { data: allRows, error: allSubjErr } = await supabaseAdmin
      .from('subjects')
      .select('code, name, name_hi, icon, color, subject_kind, is_active, display_order')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (allSubjErr) {
      logger.error('teacher_subjects_master_fetch_failed', {
        error: new Error(allSubjErr.message),
        route: 'teacher/subjects',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load subjects' },
        { status: 500 },
      );
    }

    const allSubjects: Subject[] = ((allRows ?? []) as RawSubject[]).map(toTeacherSubject);

    if (taught.length === 0) {
      return NextResponse.json({ success: true, subjects: [], allSubjects });
    }

    // 4. Intersect with active subjects master
    const taughtSet = new Set(taught);
    const subjects: Subject[] = allSubjects.filter((s) => taughtSet.has(s.code));
    return NextResponse.json({ success: true, subjects, allSubjects });
  } catch (e) {
    logger.error('teacher_subjects_unexpected_error', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: 'teacher/subjects',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}