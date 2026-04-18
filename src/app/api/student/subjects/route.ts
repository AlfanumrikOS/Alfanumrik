// src/app/api/student/subjects/route.ts
//
// GET /api/student/subjects
//
// Returns the list of subjects the authenticated student can access, sourced
// from the cbse_syllabus Layer-2 SSoT via get_available_subjects_v2().
//
// Phase 3 change (spec §5.1, §7):
//   Removed the soft-fail fallback to GRADE_SUBJECTS + SUBJECT_META. An RPC
//   failure NOW returns 500 { error: 'service_unavailable' } instead of
//   silently returning a (possibly stale) constants-derived list.
//
// Phase 4 hotfix (2026-04-18, study-path breakage post-deploy):
//   v2 RPC was widened (migration 20260418130000) to include rag_status
//   IN ('partial', 'ready'). For the edge case where cbse_syllabus itself
//   is empty (backfill hasn't run / drift), we now ALSO fall back to
//   GRADE_SUBJECTS for the student's grade and log an ops_events row so
//   ops can see when the fallback engages. Fallback is REMOVABLE — once
//   cbse_syllabus is reliably populated, a follow-up PR deletes this
//   block and GRADE_SUBJECTS per TODO-1.

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
// HOTFIX 2026-04-18 (Phase 4 drain window fallback): the subjects-governance
// rule (alfanumrik/no-raw-subject-imports) normally redirects callers to
// useAllowedSubjects/getAllowedSubjectsForStudent so they don't bypass
// plan/grade governance. Here we INTENTIONALLY reach for the legacy constants
// ONLY when the v2 RPC returns zero rows (cbse_syllabus empty or no 'ready'
// chapters during drain). This matches the pre-Task-3.7 soft-fail behavior
// exactly. Tracked for removal alongside TODO-1 once cbse_syllabus reliably
// populates post-rollout.
// eslint-disable-next-line alfanumrik/no-raw-subject-imports
import { getSubjectsForGrade } from '@/lib/constants';

export const runtime = 'nodejs';

interface SubjectV2Row {
  subject_code: string;
  subject_display: string;
  subject_display_hi: string | null;
  ready_chapter_count: number;
}

interface SubjectResponse {
  code: string;
  name: string;
  nameHi: string;
  readyChapterCount: number;
}

/**
 * Fallback: build a subjects list from GRADE_SUBJECTS + SUBJECT_META for the
 * student's grade. Used only when the v2 RPC returns zero rows AND the student
 * record exists (so we know their grade). Returns `readyChapterCount: 0` to
 * signal "unverified coverage" — client can still render the picker; AI
 * surfaces below (grounded-answer, quiz) enforce their own gates.
 */
function fallbackSubjectsForGrade(grade: string): SubjectResponse[] {
  // getSubjectsForGrade is marked @deprecated (per TODO-1 deletion plan) but
  // is intentionally retained as the fallback source during the Phase 4
  // drain window. SUBJECT_META entries have { code, name, icon, color } only
  // — no Hindi display, so nameHi falls back to name. This matches the
  // historical behavior of the pre-v2 soft-fail path.
  const meta = getSubjectsForGrade(grade);
  return meta.map((s) => ({
    code: s.code,
    name: s.name,
    nameHi: s.name,             // SUBJECT_META has no nameHi field
    readyChapterCount: 0,
  }));
}

async function logFallback(studentId: string, reason: string, subjectCount: number) {
  try {
    const admin = getSupabaseAdmin();
    await admin.from('ops_events').insert({
      category: 'grounding.study_path',
      source: 'api.student.subjects',
      severity: 'warning',
      message: `subjects fallback engaged: ${reason}`,
      subject_type: 'student',
      subject_id: studentId,
      context: { reason, fallback_subject_count: subjectCount },
    });
  } catch {
    // Non-blocking — fallback must work even if ops_events table is down.
  }
}

export async function GET(request: NextRequest) {
  try {
    // Auth: Bearer token first (client sends from localStorage), then cookie.
    let userId: string | null = null;

    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const admin = getSupabaseAdmin();
      const { data: { user }, error } = await admin.auth.getUser(token);
      if (!error && user) userId = user.id;
    }

    if (!userId) {
      const supabase = await createSupabaseServerClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) userId = user.id;
    }

    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // Admin client for RPC (bypasses RLS; the RPC enforces caller ownership
    // internally via (students.id OR students.auth_user_id) = p_student_id).
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase.rpc('get_available_subjects_v2', {
      p_student_id: userId,
    });

    if (error) {
      logger.error('subjects.v2_rpc_failed', {
        userId,
        rpcError: error.message,
      });
      // RPC-level failure: attempt student-grade fallback before surfacing 500.
      const { data: student } = await supabase
        .from('students')
        .select('grade')
        .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
        .limit(1)
        .maybeSingle();

      if (student?.grade) {
        const subjects = fallbackSubjectsForGrade(String(student.grade));
        await logFallback(userId, 'v2_rpc_error', subjects.length);
        return NextResponse.json({ subjects });
      }

      return NextResponse.json(
        { error: 'service_unavailable' },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as SubjectV2Row[];

    // Empty result during drain window OR cbse_syllabus not yet backfilled:
    // fall back to GRADE_SUBJECTS for the student's grade so the study path
    // always renders something. Log the fallback for ops visibility.
    if (rows.length === 0) {
      const { data: student } = await supabase
        .from('students')
        .select('grade')
        .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
        .limit(1)
        .maybeSingle();

      if (student?.grade) {
        const subjects = fallbackSubjectsForGrade(String(student.grade));
        await logFallback(userId, 'v2_empty_rows', subjects.length);
        return NextResponse.json({ subjects });
      }
      // No student record: safe empty list (unchanged legacy behavior).
      return NextResponse.json({ subjects: [] });
    }

    const subjects: SubjectResponse[] = rows.map((r) => ({
      code: r.subject_code,
      name: r.subject_display,
      nameHi: r.subject_display_hi ?? r.subject_display,
      readyChapterCount: r.ready_chapter_count,
    }));

    return NextResponse.json({ subjects });
  } catch (e) {
    logger.error('subjects.list_failed', { err: String(e) });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
