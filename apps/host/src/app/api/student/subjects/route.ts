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
// Fallback: if v1 errors or returns nothing (e.g. student row missing or grade
// unmapped), we rebuild the list from the SAME database truth the RPC reads —
// grade_subject_map ⋈ subjects WHERE subjects.is_active — minus only the plan
// join, which we cannot evaluate without the RPC. Every fallback row is
// therefore returned isLocked=true (fail CLOSED on plan), and if that query
// yields nothing we return an EMPTY list rather than a hardcoded catalogue.
// ops_events is logged either way so the drift is visible.
//
// Phase 4 hotfix (2026-04-18) drain-window fallback for empty cbse_syllabus
// still applies to v2 specifically; v1 is independent of cbse_syllabus.

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import type { Subject } from '@alfanumrik/lib/subjects.types';

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

interface GradeSubjectMapRow {
  subject_code: string;
  is_core: boolean | null;
  board: string | null;
  stream: string | null;
}

/** Board values the RPC treats as the generic/default curriculum. */
const GENERIC_BOARDS = new Set(['CBSE', 'Other']);

/**
 * Apply the RPC's grade_valid predicate to a grade's raw grade_subject_map
 * rows. Mirrors get_available_subjects (migration 20260621000400) exactly:
 *
 *   (gsm.stream IS NULL OR gsm.stream = s.stream OR s.stream IS NULL)
 *   AND ( gsm.board = s.board
 *         OR (gsm.board IN ('CBSE','Other') OR gsm.board IS NULL)
 *            AND NOT EXISTS (any row for this grade/stream at s.board) )
 *
 * i.e. a board-specific mapping wins outright; the generic CBSE/Other/NULL
 * mapping is used ONLY when the student's board has no mapping at all. That
 * is the "board fallback" the previous implementation approximated with an
 * exact-match query plus a hardcoded catalogue — same semantics, no catalogue.
 */
function applyGradeValidPredicate(
  rows: GradeSubjectMapRow[],
  board: string | null | undefined,
  stream: string | null | undefined,
): GradeSubjectMapRow[] {
  const streamMatched = rows.filter(
    (r) => !stream || !r.stream || r.stream === stream,
  );

  if (board) {
    const boardSpecific = streamMatched.filter((r) => r.board === board);
    if (boardSpecific.length > 0) return boardSpecific;
  }

  return streamMatched.filter(
    (r) => r.board === null || GENERIC_BOARDS.has(r.board),
  );
}

/**
 * Fallback used when the canonical get_available_subjects RPC errors or
 * returns zero rows.
 *
 * It reads the SAME database truth the RPC reads — grade_subject_map joined to
 * `subjects` on is_active = true — minus only the plan_subject_access join,
 * which cannot be evaluated here. Consequences, both deliberate:
 *
 *   • every row is returned isLocked=true. Without plan context we fail CLOSED:
 *     showing a locked subject the student can unlock by upgrading is safe;
 *     granting access we cannot prove is not. (Was isLocked=false — that plus
 *     the hardcoded catalogue is the leak this function was rewritten to
 *     close.)
 *   • readyChapterCount=0, because v2 is unavailable on this path too.
 *
 * If the join yields nothing, the result is an EMPTY list. An empty picker with
 * a support message is strictly better than a picker full of subjects the
 * platform does not serve — never substitute a hardcoded catalogue here.
 */
async function fallbackSubjectsForGradeAndBoard(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  grade: string,
  board: string | null | undefined,
  stream?: string | null,
): Promise<SubjectResponse[]> {
  try {
    const { data: mapRows, error: mapError } = await supabase
      .from('grade_subject_map')
      .select('subject_code, is_core, board, stream')
      .eq('grade', grade);

    if (mapError) {
      logger.error('subjects.fallback_grade_map_query_failed', {
        rpcError: mapError.message,
      });
      return [];
    }

    const valid = applyGradeValidPredicate(
      (mapRows ?? []) as GradeSubjectMapRow[],
      board,
      stream,
    );
    if (valid.length === 0) return [];

    // BOOL_OR(is_core) per subject_code, as the RPC's GROUP BY does.
    const coreByCode = new Map<string, boolean>();
    for (const r of valid) {
      const prev = coreByCode.get(r.subject_code) ?? false;
      coreByCode.set(r.subject_code, prev || (r.is_core ?? false));
    }
    const codes = [...coreByCode.keys()];

    // The is_active join. `is_active` is nullable, so `.eq(true)` also drops
    // NULL rows — fail closed, exactly like the RPC's `WHERE sub.is_active`.
    const { data: activeRows, error: subjectsError } = await supabase
      .from('subjects')
      .select('code, name, name_hi, icon, color, subject_kind')
      .in('code', codes)
      .eq('is_active', true);

    if (subjectsError) {
      logger.error('subjects.fallback_active_subjects_query_failed', {
        rpcError: subjectsError.message,
      });
      return [];
    }

    return ((activeRows ?? []) as Array<{
      code: string;
      name: string | null;
      name_hi: string | null;
      icon: string | null;
      color: string | null;
      subject_kind: string | null;
    }>).map((s) => ({
      code: s.code,
      name: s.name ?? s.code,
      nameHi: s.name_hi ?? s.name ?? s.code,
      icon: s.icon ?? '📚',
      color: s.color ?? '#6C5CE7',
      subjectKind: (s.subject_kind ?? 'cbse_core') as Subject['subjectKind'],
      isCore: coreByCode.get(s.code) ?? true,
      isLocked: true,
      readyChapterCount: 0,
    }));
  } catch (e) {
    logger.error('subjects.fallback_query_failed', { err: String(e) });
    return [];
  }
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
      // v1 is the source of truth for isLocked. Without it we rebuild the list
      // from grade_subject_map ⋈ active subjects and lock every row.
      const { data: student } = await supabase
        .from('students')
        .select('grade, board, stream')
        .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
        .limit(1)
        .maybeSingle();

      if (student?.grade) {
        const subjects = await fallbackSubjectsForGradeAndBoard(
          supabase,
          String(student.grade),
          student.board,
          student.stream,
        );
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

    // v1 also empty — drift case. Rebuild from grade_subject_map ⋈ active
    // subjects. This can legitimately return [] (e.g. the student's grade has
    // no mapping to any active subject); an empty picker is the correct answer
    // there, and logFallback makes it visible in ops_events.
    const { data: student } = await supabase
      .from('students')
      .select('grade, board, stream')
      .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
      .limit(1)
      .maybeSingle();

    if (student?.grade) {
      const subjects = await fallbackSubjectsForGradeAndBoard(
        supabase,
        String(student.grade),
        student.board,
        student.stream,
      );
      await logFallback(userId, 'v1_empty_rows', subjects.length);
      return NextResponse.json({ subjects });
    }
    return NextResponse.json({ subjects: [] });
  } catch (e) {
    logger.error('subjects.list_failed', { err: String(e) });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
