/**
 * GET /api/v1/subject-readiness
 *
 * Phase 3 of "Exam-Ready 360°" — batch per-chapter readiness for a subject.
 * Used by the /learn chapter-list page to render readiness badges next to
 * every chapter and a summary banner ("ready: 3 / almost: 2 / building: 4 /
 * not yet: 3"). Returns ALL chapters in one round-trip — calling
 * /api/v1/chapter-readiness once per chapter would be 12+ requests for a
 * typical subject.
 *
 * Query params:
 *   subject     string (required) — canonical subject code, e.g. 'science'
 *   student_id  uuid    (optional) — for parents/teachers viewing a linked student
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       grade: string,
 *       subject: string,
 *       chapters: Array<{ chapter_number, level, score, concepts_total,
 *                          concepts_mastered, recent_quiz_count, rag_ready }>,
 *       summary: { ready: number, almost: number, building: number, not_yet: number },
 *     },
 *   }
 *
 * Permission: `progress.view_own` (mirrors /api/v1/chapter-readiness).
 *
 * Grade is read from the resolved student row (P5: never from query string).
 */

import { NextResponse } from 'next/server';
import { authorizeRequest, canAccessStudent } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isValidUUID } from '@alfanumrik/lib/sanitize';

interface SubjectReadinessRow {
  chapter_number: number;
  level: 'not_yet' | 'building' | 'almost' | 'ready';
  score: number;
  concepts_total: number;
  concepts_mastered: number;
  recent_quiz_count: number;
  rag_ready: boolean;
}

const VALID_SUBJECT_CODE = /^[a-z][a-z0-9_-]{0,40}$/;

export async function GET(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'progress.view_own');
    if (!auth.authorized) return auth.errorResponse!;

    const url = new URL(request.url);
    const subject = url.searchParams.get('subject');
    const requestedStudentId = url.searchParams.get('student_id');

    if (!subject || !VALID_SUBJECT_CODE.test(subject)) {
      return NextResponse.json(
        { error: 'Invalid or missing `subject`', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }

    // ── Resolve target student ──
    let targetStudentId = auth.studentId ?? null;
    if (requestedStudentId) {
      if (!isValidUUID(requestedStudentId)) {
        return NextResponse.json(
          { error: 'Invalid `student_id` format', code: 'BAD_REQUEST' },
          { status: 400 },
        );
      }
      if (requestedStudentId !== auth.studentId) {
        if (!auth.userId) {
          return NextResponse.json({ error: 'Access denied' }, { status: 403 });
        }
        const hasAccess = await canAccessStudent(auth.userId, requestedStudentId);
        if (!hasAccess) {
          return NextResponse.json(
            { error: 'Access denied to this student' },
            { status: 403 },
          );
        }
        targetStudentId = requestedStudentId;
      }
    }
    if (!targetStudentId) {
      return NextResponse.json(
        { error: 'No student context available', code: 'NO_STUDENT' },
        { status: 400 },
      );
    }

    // ── Look up grade ──
    const { data: studentRow, error: studentErr } = await supabaseAdmin
      .from('students')
      .select('id, grade')
      .eq('id', targetStudentId)
      .single();

    if (studentErr || !studentRow) {
      logger.warn('subject-readiness: student lookup failed', {
        studentId: targetStudentId,
        error: studentErr?.message,
      });
      return NextResponse.json(
        { error: 'Student not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const grade = studentRow.grade;
    if (!grade || !/^(?:[6-9]|1[0-2])$/.test(grade)) {
      return NextResponse.json(
        { error: 'Student has no valid grade on file', code: 'NO_GRADE' },
        { status: 422 },
      );
    }

    // ── Call batch RPC ──
    const { data, error } = await supabaseAdmin.rpc('compute_subject_readiness', {
      p_student_id: targetStudentId,
      p_grade: grade,
      p_subject: subject,
    });

    if (error) {
      logger.error('subject-readiness: RPC failed', {
        error: error.message,
        studentId: targetStudentId,
        grade,
        subject,
      });
      return NextResponse.json(
        { error: 'Failed to compute subject readiness', code: 'RPC_ERROR' },
        { status: 500 },
      );
    }

    const chapters = (data ?? []) as SubjectReadinessRow[];

    // ── Build summary ──
    // Single pass over the rows; trivial cost for ~12-15 chapters.
    const summary = { ready: 0, almost: 0, building: 0, not_yet: 0 };
    for (const ch of chapters) {
      summary[ch.level] += 1;
    }

    return NextResponse.json({
      success: true,
      data: {
        grade,
        subject,
        chapters,
        summary,
      },
    });
  } catch (err) {
    logger.error('subject-readiness: unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL' },
      { status: 500 },
    );
  }
}
