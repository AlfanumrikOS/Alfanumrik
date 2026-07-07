/**
 * GET /api/v1/chapter-readiness
 *
 * Phase 1 of "Exam-Ready 360°" — per-chapter readiness signal that tells the
 * student "are you ready for this chapter's exam?". Backed by the
 * `compute_chapter_readiness` RPC (migration 20260508200000) which aggregates
 * concept mastery, recent quiz performance, and spaced-repetition retention
 * into a 4-level rubric (not_yet/building/almost/ready) + composite score
 * + bilingual next-action message.
 *
 * Query params:
 *   subject  string (required) — canonical subject code, e.g. 'science'
 *   chapter  int    (required) — chapter number within the student's grade
 *   student_id uuid  (optional) — for parents/teachers viewing a linked student.
 *                                  Defaults to the caller's own studentId.
 *
 * Permission: `progress.view_own` (mirrors /api/v1/performance). When a
 * non-self student_id is supplied, `canAccessStudent` gates the call against
 * the parent/teacher linkage table.
 *
 * Grade is NOT in the query string — it's read from the resolved student row
 * (P5: grades are strings '6'..'12'; binding to the student avoids a class
 * of cross-grade enumeration mistakes).
 *
 * Bilingual: response includes both `message_en` and `message_hi`. Client
 * (e.g. /learn/[subject]/[chapter] page) picks one via AuthContext.isHi.
 */

import { NextResponse } from 'next/server';
import { authorizeRequest, canAccessStudent } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isValidUUID } from '@alfanumrik/lib/sanitize';

interface ChapterReadinessRow {
  level: 'not_yet' | 'building' | 'almost' | 'ready';
  score: number;
  mastery_avg: number;
  concepts_total: number;
  concepts_mastered: number;
  recent_quiz_avg: number;
  recent_quiz_count: number;
  spaced_reviews: number;
  rag_ready: boolean;
  next_action: string;
  message_en: string;
  message_hi: string;
}

const VALID_SUBJECT_CODE = /^[a-z][a-z0-9_-]{0,40}$/;

export async function GET(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'progress.view_own');
    if (!auth.authorized) return auth.errorResponse!;

    const url = new URL(request.url);
    const subject = url.searchParams.get('subject');
    const chapterRaw = url.searchParams.get('chapter');
    const requestedStudentId = url.searchParams.get('student_id');

    // ── Validate subject ──
    // Subject codes are short lowercase alphanumeric tokens (e.g. 'science',
    // 'math', 'sst', 'english'). We don't accept arbitrary text — the RPC
    // joins on chapter_concepts.subject which is also TEXT but enforced by
    // upstream curriculum seeding. Reject obviously-bad input here so the
    // RPC never sees garbage.
    if (!subject || !VALID_SUBJECT_CODE.test(subject)) {
      return NextResponse.json(
        { error: 'Invalid or missing `subject` (lowercase alphanumeric, max 40 chars)', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }

    // ── Validate chapter ──
    if (!chapterRaw) {
      return NextResponse.json(
        { error: 'Missing required `chapter` query param', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }
    const chapter = Number.parseInt(chapterRaw, 10);
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > 50) {
      return NextResponse.json(
        { error: '`chapter` must be an integer between 1 and 50', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }

    // ── Resolve target student (self, or linked-student for parent/teacher) ──
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

    // ── Look up the student's grade ──
    // Grade lives on the student row, not the query string. Binding here
    // prevents a parent/teacher from accidentally (or maliciously) probing
    // the wrong grade — the RPC will simply find zero concepts and return
    // not_yet, but we'd rather fail fast with a clear 404 than leak the
    // shape of an empty result.
    const { data: studentRow, error: studentErr } = await supabaseAdmin
      .from('students')
      .select('id, grade')
      .eq('id', targetStudentId)
      .single();

    if (studentErr || !studentRow) {
      logger.warn('chapter-readiness: student lookup failed', {
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
      // Defensive: prod data has grades '6'..'12' per P5. If we somehow get
      // a malformed value (legacy 'Grade 6' or null), refuse rather than
      // silently produce garbage downstream.
      return NextResponse.json(
        { error: 'Student has no valid grade on file', code: 'NO_GRADE' },
        { status: 422 },
      );
    }

    // ── Call RPC ──
    const { data, error } = await supabaseAdmin.rpc('compute_chapter_readiness', {
      p_student_id: targetStudentId,
      p_grade: grade,
      p_subject: subject,
      p_chapter_number: chapter,
    });

    if (error) {
      logger.error('chapter-readiness: RPC failed', {
        error: error.message,
        studentId: targetStudentId,
        grade,
        subject,
        chapter,
      });
      return NextResponse.json(
        { error: 'Failed to compute chapter readiness', code: 'RPC_ERROR' },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as ChapterReadinessRow[];
    if (rows.length === 0) {
      // RPC returned empty resultset — either student resolution failed
      // (auth.uid mismatch) or chapter has no concepts catalogued. Either
      // way, surface a clean "not enough data" response so the client can
      // render an empty state without special-casing 404 vs 200.
      return NextResponse.json({
        success: true,
        data: {
          level: 'not_yet' as const,
          score: 0,
          mastery_avg: 0,
          concepts_total: 0,
          concepts_mastered: 0,
          recent_quiz_avg: 0,
          recent_quiz_count: 0,
          spaced_reviews: 0,
          rag_ready: false,
          next_action: 'introduce_concept',
          message_en: 'This chapter is still being prepared. Check back soon.',
          message_hi: 'यह अध्याय तैयार किया जा रहा है। थोड़ी देर में check करो।',
          grade,
          subject,
          chapter,
        },
      });
    }

    const readiness = rows[0];

    return NextResponse.json({
      success: true,
      data: {
        ...readiness,
        grade,
        subject,
        chapter,
      },
    });
  } catch (err) {
    logger.error('chapter-readiness: unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL' },
      { status: 500 },
    );
  }
}
