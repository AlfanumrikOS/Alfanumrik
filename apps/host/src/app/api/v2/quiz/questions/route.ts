/**
 * GET /api/v2/quiz/questions — fetch in-scope quiz questions (mobile + web).
 *
 * THIN reuse of the existing /api/quiz GET `questions` path:
 *   - same RBAC permission (quiz.attempt, requireStudentId),
 *   - same student-grade resolution,
 *   - same subject-governance gate (validateSubjectWrite; unlike /api/quiz this
 *     route FAILS CLOSED — 503 SUBJECT_GOVERNANCE_UNAVAILABLE on RPC outage),
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
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { validateSubjectWrite } from '@alfanumrik/lib/subjects';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';
import { QuizQuestion, type TQuizQuestion } from '@alfanumrik/lib/api/v2/contract';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { withRoute } from '@alfanumrik/lib/api/v2/with-route';

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

export const GET = withRoute(async (request: NextRequest) => {
  try {
    // 1. Auth — same permission + requireStudentId as /api/quiz GET.
    const auth = await authorizeRequest(request, 'quiz.attempt', {
      requireStudentId: true,
    });
    if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

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

    // 3. Subject governance — FAIL CLOSED (P2-7b). The old soft-fail
    // ("migrations may not be applied") was a fossil: get_available_subjects
    // ships in the baseline migration (00000000000000_baseline_from_prod.sql),
    // so a throw here means a real RPC outage — and proceeding would silently
    // disable subject gating. 503 + retryable:true (same idiom as quiz/submit's
    // transient RPC_FAILED) so clients retry instead of discarding.
    let subjectValidation: Awaited<ReturnType<typeof validateSubjectWrite>>;
    try {
      subjectValidation = await validateSubjectWrite(studentId, subject, { supabase: admin });
    } catch (govErr) {
      logger.error('v2_quiz_questions_subject_governance_unavailable', {
        error: govErr instanceof Error ? govErr : new Error(String(govErr)),
        route: '/api/v2/quiz/questions',
        subject,
      });
      return v2Error(
        'Subject eligibility could not be verified — please retry',
        503,
        'SUBJECT_GOVERNANCE_UNAVAILABLE',
        true,
      );
    }
    if (!subjectValidation.ok) {
      // P2-7a: name the SUBJECT, not the cause enum. `error.reason` is
      // 'grade' | 'plan' (a CAUSE discriminator) — interpolating it alone
      // produced "Subject not allowed: grade", which reads as if the `grade`
      // query param were the problem. Surface the structured shape the same
      // validator already gets on PATCH /api/student/profile.
      const { subject: rejectedSubject, reason, allowed } = subjectValidation.error;
      const reasonText =
        reason === 'plan'
          ? 'locked by your current plan'
          : 'not available for your grade';
      return v2Error(
        `Subject '${rejectedSubject}' is not allowed (${reasonText}). Allowed subject codes: ${allowed.join(', ')}`,
        403,
        subjectValidation.error.code,
        undefined,
        { subject: rejectedSubject, reason, allowed },
      );
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
    } else if (rows.length < count) {
      // Whole-subject mode: NOT a hard reject. Spec docs/superpowers/specs/
      // 2026-08-02-quiz-rag-verification-gate-correctness.md §3.6: after
      // migration 20260802100000's Tier-0 predicates on
      // select_quiz_questions_rag, a whole-subject request can come back
      // short of `count` for a reason other than pre-existing content
      // thinness, and the RPC's own §3.5 telemetry only covers the
      // enforced-and-locally-thin case, not this one (mobile + web both hit
      // this route directly, per this file's header). Emit ops telemetry
      // only — this route's response contract is unchanged.
      void logOpsEvent({
        category: 'grounding.quiz_serving',
        severity: 'warning',
        source: 'api/v2/quiz/questions/route.ts',
        message: 'quiz_questions_below_requested_count',
        subjectType: 'quiz_verification_pair',
        subjectId: `${grade}::${subject}`,
        context: {
          grade,
          subject,
          chapter_number: null,
          difficulty_mode: difficulty,
          question_types: ['mcq'],
          requested_count: count,
          returned_count: rows.length,
        },
      });
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
});
