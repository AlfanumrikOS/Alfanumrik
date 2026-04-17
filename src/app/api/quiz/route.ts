import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { validateSubjectWrite } from '@/lib/subjects';

function subjectNotAllowedResponse(error: {
  code: string;
  subject: string;
  reason: string;
  allowed: string[];
}) {
  return NextResponse.json(
    {
      error: error.code,
      subject: error.subject,
      reason: error.reason,
      allowed: error.allowed,
    },
    { status: 422 },
  );
}

/**
 * Recovery-mode helper: validates the (grade, subject, chapter) academic
 * scope via the validate_academic_scope RPC. Returns null when the scope is
 * valid, OR a NextResponse with a 422 + structured reason when invalid.
 *
 * Reasons surfaced (mirrors the RPC):
 *   - student_not_found
 *   - grade_mismatch
 *   - subject_not_allowed   (covers both grade gating and plan gating)
 *   - chapter_not_in_subject
 */
async function rejectIfInvalidScope(
  studentId: string,
  grade: string,
  subject: string,
  chapter: number | null,
): Promise<NextResponse | null> {
  const { data, error } = await supabaseAdmin.rpc('validate_academic_scope', {
    p_student_id:     studentId,
    p_grade:          grade,
    p_subject:        subject,
    p_chapter_number: chapter,
  });
  if (error) {
    // Soft-fail: governance RPC unavailable, allow request through
    logger.warn('validate_academic_scope_unavailable', {
      rpcError: error.message,
      studentId, grade, subject, chapter,
      note: 'Proceeding without scope validation — governance migrations may not be applied',
    });
    return null; // Allow through
  }
  const v = (data ?? {}) as { ok?: boolean; reason?: string; [k: string]: unknown };
  if (v.ok === true) return null;
  return NextResponse.json(
    {
      error: 'invalid_academic_scope',
      reason: v.reason ?? 'unknown',
      detail: v,
    },
    { status: 422 },
  );
}

// ─── Constants ──────────────────────────────────────────────────

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const VALID_COUNTS = [5, 10, 15, 20];
const VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'mixed', 'progressive'];
const VALID_QUESTION_TYPES = ['mcq', 'true_false', 'fill_blank', 'assertion_reason'];
const VALID_GET_ACTIONS = ['questions', 'chapter-progress', 'history-stats', 'exam-paper', 'ncert-coverage'];

// ─── Bilingual Error Messages ───────────────────────────────────

const errors = {
  unauthorized: {
    en: 'Authentication required. Please log in.',
    hi: 'Please log in karein.',
  },
  missingParams: {
    en: 'Missing required parameters: subject and grade.',
    hi: 'Subject aur grade dena zaroori hai.',
  },
  invalidGrade: {
    en: 'Grade must be between 6 and 12.',
    hi: 'Grade 6 se 12 ke beech hona chahiye.',
  },
  invalidCount: {
    en: 'Count must be 5, 10, 15, or 20.',
    hi: 'Count 5, 10, 15, ya 20 hona chahiye.',
  },
  invalidDifficulty: {
    en: 'Invalid difficulty level.',
    hi: 'Difficulty level galat hai.',
  },
  invalidAction: {
    en: 'Invalid action parameter.',
    hi: 'Action parameter galat hai.',
  },
  noStudent: {
    en: 'No student profile found for this account.',
    hi: 'Is account ke liye student profile nahi mili.',
  },
  gradeMismatch: {
    en: 'Requested grade does not match your profile grade.',
    hi: 'Grade aapke profile se match nahi karta.',
  },
  serverError: {
    en: 'An internal error occurred. Please try again.',
    hi: 'Server mein error aaya. Dobara try karein.',
  },
  invalidBody: {
    en: 'Invalid request body.',
    hi: 'Request body galat hai.',
  },
  invalidPostAction: {
    en: 'Invalid action. Use "generate-exam".',
    hi: 'Action galat hai. "generate-exam" use karein.',
  },
} as const;

function errorResponse(
  err: (typeof errors)[keyof typeof errors],
  status: number,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    { success: false, error: err.en, error_hi: err.hi, ...extra },
    { status }
  );
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Look up the student record for the authenticated user and validate grade.
 * Returns { studentId, studentGrade } or a NextResponse error.
 */
async function resolveStudent(
  authUserId: string,
  authStudentId: string | null,
  requestedGrade: string
): Promise<
  | { ok: true; studentId: string; studentGrade: string }
  | { ok: false; response: NextResponse }
> {
  let studentId = authStudentId;
  let studentGrade: string | null = null;

  if (studentId) {
    // Fetch grade for the already-resolved student
    const { data: student, error } = await supabaseAdmin
      .from('students')
      .select('id, grade')
      .eq('id', studentId)
      .single();

    if (error || !student) {
      return { ok: false, response: errorResponse(errors.noStudent, 404) };
    }
    studentGrade = String(student.grade);
  } else {
    // Fallback: look up student by auth user id
    const { data: student, error } = await supabaseAdmin
      .from('students')
      .select('id, grade')
      .eq('auth_user_id', authUserId)
      .single();

    if (error || !student) {
      return { ok: false, response: errorResponse(errors.noStudent, 404) };
    }
    studentId = student.id;
    studentGrade = String(student.grade);
  }

  // Validate requested grade matches student grade
  if (requestedGrade !== studentGrade) {
    return { ok: false, response: errorResponse(errors.gradeMismatch, 400) };
  }

  return { ok: true, studentId: studentId!, studentGrade };
}

// ─── GET Handler ────────────────────────────────────────────────

/**
 * GET /api/quiz?action=questions|chapter-progress|history-stats|exam-paper|ncert-coverage
 * Permission: quiz.attempt
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Auth
    const auth = await authorizeRequest(request, 'quiz.attempt', {
      requireStudentId: true,
    });
    if (!auth.authorized) return auth.errorResponse!;

    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    // 2. Validate action
    if (!action || !VALID_GET_ACTIONS.includes(action)) {
      return errorResponse(errors.invalidAction, 400, {
        valid_actions: VALID_GET_ACTIONS,
      });
    }

    // 3. Common required params
    const subject = url.searchParams.get('subject');
    const grade = url.searchParams.get('grade');

    if (!subject || !grade) {
      return errorResponse(errors.missingParams, 400);
    }

    if (!VALID_GRADES.includes(grade)) {
      return errorResponse(errors.invalidGrade, 400);
    }

    // 4. Resolve & validate student
    const studentResult = await resolveStudent(auth.userId!, auth.studentId, grade);
    if (!studentResult.ok) return studentResult.response;

    const { studentId } = studentResult;

    // 4b. Subject governance (soft-fail when RPCs unavailable)
    try {
      const subjectValidation = await validateSubjectWrite(studentId, subject, {
        supabase: supabaseAdmin,
      });
      if (!subjectValidation.ok) return subjectNotAllowedResponse(subjectValidation.error);
    } catch (govErr) {
      logger.warn('quiz_subject_governance_unavailable', {
        error: govErr instanceof Error ? govErr.message : String(govErr),
        subject, studentId, handler: 'GET',
        note: 'Proceeding without subject governance — migrations may not be applied',
      });
    }

    // 4c. Academic-scope validation — for actions that take a chapter, also
    //     verify the chapter belongs to the (subject, grade) triple. The
    //     `questions` action accepts an optional chapter via query string;
    //     other actions don't carry chapter context here.
    if (action === 'questions') {
      const chapterParam = new URL(request.url).searchParams.get('chapter');
      const chapterForScope = chapterParam ? parseInt(chapterParam, 10) : null;
      if (chapterParam && (Number.isNaN(chapterForScope!) || chapterForScope! < 1)) {
        return NextResponse.json(
          { success: false, error: 'chapter must be a positive integer.' },
          { status: 400 },
        );
      }
      const scopeReject = await rejectIfInvalidScope(studentId, grade, subject, chapterForScope);
      if (scopeReject) return scopeReject;
    }

    // 5. Dispatch by action
    switch (action) {
      case 'questions':
        return await handleGetQuestions(request, studentId, subject, grade);

      case 'chapter-progress':
        return await handleChapterProgress(studentId, subject, grade);

      case 'history-stats':
        return await handleHistoryStats(studentId, subject, grade);

      case 'exam-paper':
        return await handleGetExamPaper(request, studentId, subject, grade);

      case 'ncert-coverage':
        return await handleNcertCoverage(studentId, subject, grade);

      default:
        return errorResponse(errors.invalidAction, 400);
    }
  } catch (err) {
    logger.error('quiz_api_get_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/quiz',
    });
    return errorResponse(errors.serverError, 500);
  }
}

// ─── POST Handler ───────────────────────────────────────────────

/**
 * POST /api/quiz
 * Body: { action: 'generate-exam', subject, grade, chapters?, templateId? }
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Auth
    const auth = await authorizeRequest(request, 'quiz.attempt', {
      requireStudentId: true,
    });
    if (!auth.authorized) return auth.errorResponse!;

    // 2. Parse body
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errorResponse(errors.invalidBody, 400);
    }

    const { action, subject, grade, chapters, templateId } = body as {
      action?: string;
      subject?: string;
      grade?: string;
      chapters?: number[];
      templateId?: string;
    };

    // 3. Validate action
    if (action !== 'generate-exam') {
      return errorResponse(errors.invalidPostAction, 400);
    }

    // 4. Validate required fields
    if (!subject || !grade) {
      return errorResponse(errors.missingParams, 400);
    }

    if (!VALID_GRADES.includes(grade)) {
      return errorResponse(errors.invalidGrade, 400);
    }

    // 5. Validate optional fields
    if (chapters !== undefined) {
      if (
        !Array.isArray(chapters) ||
        chapters.length === 0 ||
        !chapters.every((c) => typeof c === 'number' && Number.isInteger(c) && c > 0)
      ) {
        return NextResponse.json(
          {
            success: false,
            error: 'chapters must be a non-empty array of positive integers.',
            error_hi: 'chapters mein positive integers hone chahiye.',
          },
          { status: 400 }
        );
      }
    }

    if (templateId !== undefined && typeof templateId !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'templateId must be a string.',
          error_hi: 'templateId string hona chahiye.',
        },
        { status: 400 }
      );
    }

    // 6. Resolve & validate student
    const studentResult = await resolveStudent(auth.userId!, auth.studentId, grade);
    if (!studentResult.ok) return studentResult.response;

    const { studentId } = studentResult;

    // 6b. Subject governance (soft-fail when RPCs unavailable)
    try {
      const subjectValidation = await validateSubjectWrite(studentId, subject, {
        supabase: supabaseAdmin,
      });
      if (!subjectValidation.ok) return subjectNotAllowedResponse(subjectValidation.error);
    } catch (govErr) {
      logger.warn('quiz_subject_governance_unavailable', {
        error: govErr instanceof Error ? govErr.message : String(govErr),
        subject, studentId, handler: 'POST',
        note: 'Proceeding without subject governance — migrations may not be applied',
      });
    }

    // 6c. Academic-scope validation per chapter (if chapters provided)
    //     The exam-generation contract: every chapter must belong to (subject, grade).
    //     We validate them one-by-one rather than a single triple call so the error
    //     message can name the offending chapter.
    if (Array.isArray(chapters) && chapters.length > 0) {
      for (const ch of chapters) {
        const reject = await rejectIfInvalidScope(studentId, grade, subject, ch);
        if (reject) return reject;
      }
    } else {
      const reject = await rejectIfInvalidScope(studentId, grade, subject, null);
      if (reject) return reject;
    }

    // 7. Call RPC to generate exam paper
    const { data, error } = await supabaseAdmin.rpc('generate_exam_paper', {
      p_student_id: studentId,
      p_subject: subject,
      p_grade: grade,
      p_chapters: chapters ?? null,
      p_template_id: templateId ?? null,
    });

    if (error) {
      logger.error('quiz_generate_exam_rpc_failed', {
        error: new Error(error.message),
        route: '/api/quiz',
        studentId,
        subject,
        grade,
      });
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to generate exam paper. Please try again.',
          error_hi: 'Exam paper banane mein error aaya. Dobara try karein.',
        },
        { status: 500 }
      );
    }

    logAudit(auth.userId!, {
      action: 'generate_exam',
      resourceType: 'quiz',
      resourceId: studentId,
      details: { subject, grade, chapters, templateId },
    });

    return NextResponse.json({ success: true, paper: data });
  } catch (err) {
    logger.error('quiz_api_post_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/quiz',
    });
    return errorResponse(errors.serverError, 500);
  }
}

// ─── Action Handlers ────────────────────────────────────────────

/**
 * Fetch quiz questions via select_quiz_questions_v2 RPC.
 * Supports non-repetition, concept balancing, and progressive difficulty.
 */
async function handleGetQuestions(
  request: NextRequest,
  studentId: string,
  subject: string,
  grade: string
): Promise<NextResponse> {
  const url = new URL(request.url);

  // Parse optional params
  const chapterParam = url.searchParams.get('chapter');
  const chapter = chapterParam ? parseInt(chapterParam, 10) : null;
  if (chapterParam && (isNaN(chapter!) || chapter! < 1)) {
    return NextResponse.json(
      {
        success: false,
        error: 'chapter must be a positive integer.',
        error_hi: 'chapter ek positive number hona chahiye.',
      },
      { status: 400 }
    );
  }

  const countParam = url.searchParams.get('count');
  const count = countParam ? parseInt(countParam, 10) : 10;
  if (!VALID_COUNTS.includes(count)) {
    return errorResponse(errors.invalidCount, 400);
  }

  const difficulty = url.searchParams.get('difficulty') || 'mixed';
  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    return errorResponse(errors.invalidDifficulty, 400);
  }

  const typesParam = url.searchParams.get('types') || 'mcq';
  const types = typesParam.split(',').map((t) => t.trim()).filter(Boolean);
  const invalidTypes = types.filter((t) => !VALID_QUESTION_TYPES.includes(t));
  if (invalidTypes.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `Invalid question types: ${invalidTypes.join(', ')}. Valid: ${VALID_QUESTION_TYPES.join(', ')}`,
        error_hi: `Galat question types: ${invalidTypes.join(', ')}`,
      },
      { status: 400 }
    );
  }

  // Call the RAG RPC for non-repetition, concept balancing, and vector similarity
  // p_query_embedding is null for now — will be populated when client-side generates embeddings
  const { data, error } = await supabaseAdmin.rpc('select_quiz_questions_rag', {
    p_student_id: studentId,
    p_subject: subject,
    p_grade: grade,
    p_chapter_number: chapter,
    p_count: count,
    p_difficulty_mode: difficulty,
    p_question_types: types,
    p_query_embedding: null,
  });

  if (error) {
    logger.error('quiz_select_questions_rpc_failed', {
      error: new Error(error.message),
      route: '/api/quiz',
      studentId,
      subject,
      grade,
      chapter,
      count,
      difficulty,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load quiz questions. Please try again.',
        error_hi: 'Quiz questions load nahi ho paye. Dobara try karein.',
      },
      { status: 500 }
    );
  }

  // Strict scope contract (recovery mode): when the caller specified a
  // chapter, every returned question MUST be from that chapter. We do NOT
  // silently broaden. If the RPC returns cross-chapter rows, drop them and
  // fall through to the insufficient-questions path below.
  let questions: Array<Record<string, unknown>> = Array.isArray(data) ? data : [];
  if (chapter != null) {
    questions = questions.filter((q) => Number(q.chapter_number) === chapter);
  }

  // If the chapter was specified and we don't have enough valid in-scope
  // questions, return a structured 422 with { available, requested }. The
  // UI must show a "try another chapter" affordance — never fake a quiz.
  if (chapter != null && questions.length < count) {
    return NextResponse.json(
      {
        success: false,
        error: 'insufficient_questions_in_scope',
        error_hi: 'Is chapter mein itne questions available nahi hain.',
        available: questions.length,
        requested: count,
        scope: { subject, grade, chapter },
      },
      { status: 422 },
    );
  }

  return NextResponse.json({ success: true, questions });
}

/**
 * Get chapter completion status for a student in a subject.
 */
async function handleChapterProgress(
  studentId: string,
  subject: string,
  grade: string
): Promise<NextResponse> {
  const { data, error } = await supabaseAdmin.rpc('get_chapter_progress', {
    p_student_id: studentId,
    p_subject: subject,
    p_grade: grade,
  });

  if (error) {
    logger.error('quiz_chapter_progress_rpc_failed', {
      error: new Error(error.message),
      route: '/api/quiz',
      studentId,
      subject,
      grade,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load chapter progress.',
        error_hi: 'Chapter progress load nahi ho paya.',
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, chapters: data ?? [] });
}

/**
 * Get question history stats: pool coverage, seen/unseen counts, etc.
 */
async function handleHistoryStats(
  studentId: string,
  subject: string,
  grade: string
): Promise<NextResponse> {
  const { data, error } = await supabaseAdmin.rpc('get_question_history_stats', {
    p_student_id: studentId,
    p_subject: subject,
    p_grade: grade,
  });

  if (error) {
    logger.error('quiz_history_stats_rpc_failed', {
      error: new Error(error.message),
      route: '/api/quiz',
      studentId,
      subject,
      grade,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load question history stats.',
        error_hi: 'Question history stats load nahi ho paye.',
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, stats: data ?? {} });
}

/**
 * GET-based exam paper retrieval (for fetching a previously generated paper).
 */
async function handleGetExamPaper(
  request: NextRequest,
  studentId: string,
  subject: string,
  grade: string
): Promise<NextResponse> {
  const url = new URL(request.url);
  const templateId = url.searchParams.get('templateId') || null;

  const { data, error } = await supabaseAdmin.rpc('get_exam_paper', {
    p_student_id: studentId,
    p_subject: subject,
    p_grade: grade,
    p_template_id: templateId,
  });

  if (error) {
    logger.error('quiz_get_exam_paper_rpc_failed', {
      error: new Error(error.message),
      route: '/api/quiz',
      studentId,
      subject,
      grade,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load exam paper.',
        error_hi: 'Exam paper load nahi ho paya.',
      },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        success: false,
        error: 'No exam paper found.',
        error_hi: 'Koi exam paper nahi mila.',
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, paper: data });
}

/**
 * Get NCERT coverage data: which NCERT topics have been practiced, coverage %.
 */
async function handleNcertCoverage(
  studentId: string,
  subject: string,
  grade: string
): Promise<NextResponse> {
  const { data, error } = await supabaseAdmin.rpc('get_ncert_coverage', {
    p_student_id: studentId,
    p_subject: subject,
    p_grade: grade,
  });

  if (error) {
    logger.error('quiz_ncert_coverage_rpc_failed', {
      error: new Error(error.message),
      route: '/api/quiz',
      studentId,
      subject,
      grade,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load NCERT coverage data.',
        error_hi: 'NCERT coverage data load nahi ho paya.',
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, coverage: data ?? [] });
}
