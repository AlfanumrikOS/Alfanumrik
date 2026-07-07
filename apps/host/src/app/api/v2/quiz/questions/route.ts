/**
 * GET /api/v2/quiz/questions — fetch in-scope quiz questions (mobile + web).
 *
 * THIN reuse of the existing /api/quiz GET `questions` path:
 *   - same RBAC permission (quiz.attempt, requireStudentId),
 *   - same student-grade resolution,
 *   - same subject-governance gate (validateSubjectWrite, soft-fail),
 *   - same academic-scope gate (validate_academic_scope RPC, soft-fail),
 *   - same questions RPC (select_quiz_questions_rag),
 *   - same strict in-scope chapter filter + insufficient_questions_in_scope 422.
 *
 * The ONLY differences vs /api/quiz GET are the /v2 envelope ({ success, data })
 * and the projected response shape (QuizQuestionsResponse, schemaVersion 1).
 *
 * P6: correct_answer_index is NEVER returned. The RPC's served shape already
 * omits it; we additionally project only the contract fields so a future RPC
 * change can't leak the answer.
 *
 * No scoring / XP / anti-cheat math here.
 */
import { NextRequest } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { validateSubjectWrite } from '@alfanumrik/lib/subjects';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';
import { QuizQuestion, type TQuizQuestion } from '@alfanumrik/lib/api/v2/contract';

const VALID_COUNTS = [5, 10, 15, 20];
const VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'mixed', 'progressive'];
const VALID_MODES = ['practice', 'cognitive', 'exam'];

/** Project a raw RPC row to the contract QuizQuestion (drops correct_answer_index). */
function projectQuestion(row: Record<string, unknown>): TQuizQuestion {
  const optsRaw = Array.isArray(row.options) ? row.options : [];
  const options = optsRaw.map((o) =>
    typeof o === 'string'
      ? o
      : o && typeof o === 'object' && 'text' in (o as Record<string, unknown>)
        ? String((o as { text?: unknown }).text ?? '')
        : '',
  );
  return {
    question_id: String(row.question_id ?? row.id ?? ''),
    question_text: String(row.question_text ?? ''),
    question_hi: (row.question_hi as string | null) ?? null,
    question_type: String(row.question_type ?? 'mcq'),
    options,
    explanation: (row.explanation as string | null) ?? null,
    explanation_hi: (row.explanation_hi as string | null) ?? null,
    hint: (row.hint as string | null) ?? null,
    difficulty: typeof row.difficulty === 'number' ? row.difficulty : Number(row.difficulty ?? 2),
    bloom_level: (row.bloom_level as string | null) ?? null,
    chapter_number:
      row.chapter_number == null ? null : Number(row.chapter_number),
  };
}

export async function GET(request: NextRequest) {
  try {
    // 1. Auth — same permission + requireStudentId as /api/quiz GET.
    const auth = await authorizeRequest(request, 'quiz.attempt', {
      requireStudentId: true,
    });
    if (!auth.authorized) return auth.errorResponse!;

    const url = new URL(request.url);
    const subject = url.searchParams.get('subject');
    const grade = url.searchParams.get('grade');

    if (!subject || !grade) {
      return v2Error('Missing required parameters: subject and grade', 400, 'VALIDATION_ERROR');
    }
    if (!/^(6|7|8|9|10|11|12)$/.test(grade)) {
      return v2Error('Grade must be a string from "6" through "12"', 400, 'VALIDATION_ERROR');
    }

    const countParam = url.searchParams.get('count');
    const count = countParam ? parseInt(countParam, 10) : NaN;
    if (!VALID_COUNTS.includes(count)) {
      return v2Error('count must be 5, 10, 15, or 20', 400, 'VALIDATION_ERROR');
    }

    const chapterParam = url.searchParams.get('chapter');
    const chapter = chapterParam ? parseInt(chapterParam, 10) : null;
    if (chapterParam && (Number.isNaN(chapter!) || chapter! < 1)) {
      return v2Error('chapter must be a positive integer', 400, 'VALIDATION_ERROR');
    }

    const difficulty = url.searchParams.get('difficulty') || 'mixed';
    if (!VALID_DIFFICULTIES.includes(difficulty)) {
      return v2Error('Invalid difficulty level', 400, 'VALIDATION_ERROR');
    }

    const mode = url.searchParams.get('mode');
    if (mode && !VALID_MODES.includes(mode)) {
      return v2Error('Invalid mode', 400, 'VALIDATION_ERROR');
    }

    const admin = getSupabaseAdmin();

    // 2. Resolve student + validate grade matches profile (same as /api/quiz).
    const { data: student, error: studentErr } = await admin
      .from('students')
      .select('id, grade')
      .eq('id', auth.studentId)
      .single();
    if (studentErr || !student) {
      return v2Error('No student profile found for this account', 404, 'NO_STUDENT_PROFILE');
    }
    if (String(student.grade) !== grade) {
      return v2Error('Requested grade does not match your profile grade', 403, 'GRADE_MISMATCH');
    }
    const studentId = student.id;

    // 3. Subject governance — soft-fail when RPCs unavailable (mirrors /api/quiz).
    try {
      const subjectValidation = await validateSubjectWrite(studentId, subject, { supabase: admin });
      if (!subjectValidation.ok) {
        return v2Error(
          `Subject not allowed: ${subjectValidation.error.reason}`,
          403,
          subjectValidation.error.code,
        );
      }
    } catch (govErr) {
      logger.warn('v2_quiz_questions_subject_governance_unavailable', {
        error: govErr instanceof Error ? govErr.message : String(govErr),
        subject,
        note: 'Proceeding without subject governance — migrations may not be applied',
      });
    }

    // 4. Academic-scope gate (only when a chapter is specified) — soft-fail.
    if (chapter != null) {
      const { data: scopeData, error: scopeErr } = await admin.rpc('validate_academic_scope', {
        p_student_id: studentId,
        p_grade: grade,
        p_subject: subject,
        p_chapter_number: chapter,
      });
      if (!scopeErr) {
        const v = (scopeData ?? {}) as { ok?: boolean; reason?: string };
        if (v.ok !== true) {
          return v2Error(`invalid_academic_scope: ${v.reason ?? 'unknown'}`, 422, 'INVALID_ACADEMIC_SCOPE');
        }
      } else {
        logger.warn('v2_quiz_questions_scope_unavailable', {
          error: scopeErr.message,
          note: 'Proceeding without scope validation',
        });
      }
    }

    // 5. Fetch via the same RAG RPC as /api/quiz GET.
    const { data, error } = await admin.rpc('select_quiz_questions_rag', {
      p_student_id: studentId,
      p_subject: subject,
      p_grade: grade,
      p_chapter_number: chapter,
      p_count: count,
      p_difficulty_mode: difficulty,
      p_question_types: ['mcq'],
      p_query_embedding: null,
    });

    if (error) {
      logger.error('v2_quiz_questions_rpc_failed', {
        error: new Error(error.message),
        route: '/api/v2/quiz/questions',
      });
      return v2Error('Failed to load quiz questions', 500, 'INTERNAL_ERROR');
    }

    // 6. Strict in-scope chapter filter (mirrors /api/quiz GET recovery mode).
    let rows: Array<Record<string, unknown>> = Array.isArray(data) ? data : [];
    if (chapter != null) {
      rows = rows.filter((q) => Number(q.chapter_number) === chapter);
      if (rows.length < count) {
        // 422 with structured scope — UI must offer "try another chapter".
        return v2Error(
          `insufficient_questions_in_scope (available=${rows.length}, requested=${count})`,
          422,
          'INSUFFICIENT_QUESTIONS_IN_SCOPE',
        );
      }
    }

    // 7. Project to the contract shape (drops correct_answer_index — P6).
    const questions = rows.map((r) => QuizQuestion.parse(projectQuestion(r)));

    return v2Success({ schemaVersion: 1 as const, questions });
  } catch (err) {
    logger.error('v2_quiz_questions_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/quiz/questions',
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
}
