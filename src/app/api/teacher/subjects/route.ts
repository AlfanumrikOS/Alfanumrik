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
 * Auth: authorizeRequest(request, 'class.manage') — the canonical teacher
 * gate used by other teacher routes. Super-admins and admins bypass via RBAC.
 *
 * Response shape:
 *   { success: true, subjects: Subject[] }
 *   { success: false, error: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import type { Subject } from '@/lib/subjects.types';

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

    if (taught.length === 0) {
      return NextResponse.json({ success: true, subjects: [] });
    }

    // 3. Intersect with active subjects master
    const { data: rows, error: subjErr } = await supabaseAdmin
      .from('subjects')
      .select('code, name, name_hi, icon, color, subject_kind, is_active, display_order')
      .eq('is_active', true)
      .in('code', taught)
      .order('display_order', { ascending: true });

    if (subjErr) {
      logger.error('teacher_subjects_master_fetch_failed', {
        error: new Error(subjErr.message),
        route: 'teacher/subjects',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load subjects' },
        { status: 500 },
      );
    }

    const subjects: Subject[] = ((rows ?? []) as RawSubject[]).map(toTeacherSubject);
    return NextResponse.json({ success: true, subjects });
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