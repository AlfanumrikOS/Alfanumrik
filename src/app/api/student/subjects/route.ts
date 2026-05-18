// src/app/api/student/subjects/route.ts
//
// GET /api/student/subjects
//
// Returns the list of subjects the authenticated student can access. Sources:
//
//   1) get_available_subjects (v1) — authoritative for WHICH subjects appear
//      and whether each one is locked (grade + stream + plan gating). Without
//      this, the client sees every subject as unlocked and lets users click
//      into chapters they don't have access to (server then 422s → "Oops").
//
//   2) get_available_subjects_v2 — enriches each row with ready_chapter_count
//      so the picker can badge "no chapters yet" subjects.
//
// We MERGE by subject_code. v1 is the source of truth for the list; v2 just
// adds counts. If v2 fails or is empty, we still return v1 with count=0.
//
// Fallback: if v1 itself returns nothing (e.g. student row missing or grade
// unmapped), we fall back to GRADE_SUBJECTS + SUBJECT_META for the student's
// grade, treating every subject as unlocked. This keeps the page rendering
// during edge-case drift; ops_events is logged so it's visible.
//
// Phase 4 hotfix (2026-04-18) drain-window fallback for empty cbse_syllabus
// still applies to v2 specifically; v1 is independent of cbse_syllabus.

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import type { Subject } from '@/lib/subjects.types';
// HOTFIX 2026-04-18 (Phase 4 drain window fallback): the subjects-governance
// rule (alfanumrik/no-raw-subject-imports) normally redirects callers to
// useAllowedSubjects/getAllowedSubjectsForStudent so they don't bypass
// plan/grade governance. Here we INTENTIONALLY reach for the legacy constants
// ONLY when both v1 and v2 RPCs return zero rows. This matches the
// pre-Task-3.7 soft-fail behavior exactly.
// eslint-disable-next-line alfanumrik/no-raw-subject-imports
import { getSubjectsForGrade } from '@/lib/constants';

export const runtime = 'nodejs';

interface SubjectV1Row {
  code: string;
  name: string;
  name_hi: string | null;
  icon: string;
  color: string;
  subject_kind: 'cbse_core' | 'cbse_elective' | 'platform_elective';
  is_core: boolean;
  is_locked: boolean;
}

interface SubjectV2Row {
  subject_code: string;
  subject_display: string;
  subject_display_hi: string | null;
  ready_chapter_count: number;
}

export interface SubjectResponse extends Subject {
  readyChapterCount: number;
}

function rowToSubject(r: SubjectV1Row): Subject {
  return {
    code: r.code,
    name: r.name,
    nameHi: r.name_hi ?? r.name,
    icon: r.icon,
    color: r.color,
    subjectKind: r.subject_kind,
    isCore: r.is_core,
    isLocked: r.is_locked,
  };
}

/**
 * Fallback: build a subjects list from GRADE_SUBJECTS + SUBJECT_META for the
 * student's grade. Used only when v1 returns zero rows AND the student record
 * exists. Returns isLocked=false (we don't have plan context here) and
 * readyChapterCount=0 — client can still render the picker; AI surfaces
 * below (grounded-answer, quiz) enforce their own gates.
 */
function fallbackSubjectsForGrade(grade: string): SubjectResponse[] {
  const meta = getSubjectsForGrade(grade);
  return meta.map((s) => ({
    code: s.code,
    name: s.name,
    nameHi: s.name,
    icon: s.icon,
    color: s.color,
    subjectKind: 'cbse_core',
    isCore: true,
    isLocked: false,
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

    // Admin client for RPC (bypasses RLS; both RPCs enforce caller ownership
    // internally via (students.id OR students.auth_user_id) = p_student_id
    // plus an auth.uid() guard for cross-tenant protection).
    const supabase = getSupabaseAdmin();

    // Call v1 (gating list) and v2 (chapter counts) in parallel.
    const [v1Result, v2Result] = await Promise.all([
      supabase.rpc('get_available_subjects', { p_student_id: userId }),
      supabase.rpc('get_available_subjects_v2', { p_student_id: userId }),
    ]);

    if (v1Result.error) {
      logger.error('subjects.v1_rpc_failed', {
        userId,
        rpcError: v1Result.error.message,
      });
      // v1 is the source of truth for isLocked. Without it the client cannot
      // safely render subjects (it would treat everything as unlocked). Try
      // to fall back via grade so the page still renders something.
      const { data: student } = await supabase
        .from('students')
        .select('grade')
        .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
        .limit(1)
        .maybeSingle();

      if (student?.grade) {
        const subjects = fallbackSubjectsForGrade(String(student.grade));
        await logFallback(userId, 'v1_rpc_error', subjects.length);
        return NextResponse.json({ subjects });
      }

      return NextResponse.json(
        { error: 'service_unavailable' },
        { status: 500 },
      );
    }

    const v1Rows = (v1Result.data ?? []) as SubjectV1Row[];

    // Build chapter-count lookup from v2; tolerate v2 failures/empty rows so
    // a cbse_syllabus drain doesn't break the picker — v1 still gates access.
    const v2Counts = new Map<string, number>();
    if (v2Result.error) {
      logger.warn('subjects.v2_rpc_failed_nonfatal', {
        userId,
        rpcError: v2Result.error.message,
      });
    } else {
      for (const r of (v2Result.data ?? []) as SubjectV2Row[]) {
        v2Counts.set(r.subject_code, r.ready_chapter_count);
      }
    }

    // v1 returned subjects — return them enriched with chapter counts.
    if (v1Rows.length > 0) {
      const subjects: SubjectResponse[] = v1Rows.map((r) => ({
        ...rowToSubject(r),
        readyChapterCount: v2Counts.get(r.code) ?? 0,
      }));
      return NextResponse.json({ subjects });
    }

    // v1 also empty — drift case. Fall back to GRADE_SUBJECTS for the
    // student's grade so the study path always renders something.
    const { data: student } = await supabase
      .from('students')
      .select('grade')
      .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
      .limit(1)
      .maybeSingle();

    if (student?.grade) {
      const subjects = fallbackSubjectsForGrade(String(student.grade));
      await logFallback(userId, 'v1_empty_rows', subjects.length);
      return NextResponse.json({ subjects });
    }
    return NextResponse.json({ subjects: [] });
  } catch (e) {
    logger.error('subjects.list_failed', { err: String(e) });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
