import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logSchoolAudit } from '@alfanumrik/lib/audit';

// ── Constants ────────────────────────────────────────────────

/** P5: grades are strings "6"–"12", never integers. */
const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const VALID_BLOOM_LEVELS = [
  'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
] as const;

/** Hard cap per request — CSV bulk upload endpoint. */
const MAX_BULK_SIZE = 500;

// ── P6 Question Validation ───────────────────────────────────
// Mirrors the validator in the sibling route
// (src/app/api/school-admin/content/route.ts) so both entry points
// enforce identical P6 quality rules.

interface QuestionInput {
  subject?: string;
  grade?: string;
  topic?: string;
  question_text?: string;
  options?: unknown;
  correct_answer_index?: unknown;
  explanation?: string;
  difficulty?: string;
  bloom_level?: string;
}

interface ValidationError {
  index: number;
  field: string;
  message: string;
}

/**
 * Validates a single question against P6 quality rules and P5 grade format.
 * Returns an array of errors (empty = valid).
 */
function validateQuestion(q: QuestionInput, index: number): ValidationError[] {
  const errors: ValidationError[] = [];

  // 1. question_text: non-empty, no {{ or [BLANK] placeholders
  if (!q.question_text || typeof q.question_text !== 'string' || !q.question_text.trim()) {
    errors.push({ index, field: 'question_text', message: 'Question text is required and must be non-empty' });
  } else if (/\{\{/.test(q.question_text) || /\[BLANK\]/.test(q.question_text)) {
    errors.push({ index, field: 'question_text', message: 'Question text must not contain {{ or [BLANK] placeholders' });
  }

  // 2. options: array of exactly 4 non-empty strings, all distinct
  if (!Array.isArray(q.options) || q.options.length !== 4) {
    errors.push({ index, field: 'options', message: 'Options must be an array of exactly 4 strings' });
  } else {
    const allStrings = q.options.every((o: unknown) => typeof o === 'string' && o.trim().length > 0);
    if (!allStrings) {
      errors.push({ index, field: 'options', message: 'All 4 options must be non-empty strings' });
    } else {
      const trimmed = q.options.map((o: string) => o.trim().toLowerCase());
      const unique = new Set(trimmed);
      if (unique.size !== 4) {
        errors.push({ index, field: 'options', message: 'All 4 options must be distinct' });
      }
    }
  }

  // 3. correct_answer_index: integer 0-3
  const cai = Number(q.correct_answer_index);
  if (
    q.correct_answer_index === undefined ||
    q.correct_answer_index === null ||
    !Number.isInteger(cai) ||
    cai < 0 ||
    cai > 3
  ) {
    errors.push({ index, field: 'correct_answer_index', message: 'correct_answer_index must be an integer 0-3' });
  }

  // 4. explanation: non-empty
  if (!q.explanation || typeof q.explanation !== 'string' || !q.explanation.trim()) {
    errors.push({ index, field: 'explanation', message: 'Explanation is required and must be non-empty' });
  }

  // 5. difficulty
  if (!q.difficulty || !VALID_DIFFICULTIES.includes(q.difficulty as typeof VALID_DIFFICULTIES[number])) {
    errors.push({
      index,
      field: 'difficulty',
      message: `Difficulty must be one of: ${VALID_DIFFICULTIES.join(', ')}`,
    });
  }

  // 6. bloom_level
  if (!q.bloom_level || !VALID_BLOOM_LEVELS.includes(q.bloom_level as typeof VALID_BLOOM_LEVELS[number])) {
    errors.push({
      index,
      field: 'bloom_level',
      message: `bloom_level must be one of: ${VALID_BLOOM_LEVELS.join(', ')}`,
    });
  }

  // 7. grade: string "6"-"12" (P5)
  if (!q.grade || typeof q.grade !== 'string' || !VALID_GRADES.includes(q.grade)) {
    errors.push({ index, field: 'grade', message: 'Grade must be a string "6" through "12"' });
  }

  // subject: required non-empty
  if (!q.subject || typeof q.subject !== 'string' || !q.subject.trim()) {
    errors.push({ index, field: 'subject', message: 'Subject is required' });
  }

  return errors;
}

// ── POST — Bulk create questions (CSV upload) ────────────────

/**
 * POST /api/school-admin/content/bulk — Bulk-create questions
 * Permission: school.manage_content
 *
 * Body:
 *   { questions: [ { subject, grade, topic, question_text,
 *       options: string[4], correct_answer_index, explanation,
 *       difficulty, bloom_level } ] }
 *
 * Contract (all-or-nothing):
 *   - Every question is validated against P6 before any insert.
 *   - Any validation failure → 400 with per-row validation_errors and
 *     ZERO rows inserted.
 *   - All valid → single batch insert, 201 with created rows.
 *
 * All inserts are scoped to the caller's school_id (tenant isolation)
 * and start with approved = false (pending review).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_content');
    if (!auth.authorized) return auth.errorResponse!;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.questions)) {
      return NextResponse.json(
        { success: false, error: 'Body must contain a "questions" array' },
        { status: 400 }
      );
    }

    const questionsToCreate = body.questions as QuestionInput[];

    if (questionsToCreate.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Questions array must not be empty' },
        { status: 400 }
      );
    }

    if (questionsToCreate.length > MAX_BULK_SIZE) {
      return NextResponse.json(
        {
          success: false,
          error: `Bulk upload limited to ${MAX_BULK_SIZE} questions per request (received ${questionsToCreate.length})`,
        },
        { status: 400 }
      );
    }

    // Validate ALL questions (P6) before inserting ANY (all-or-nothing)
    const allErrors: ValidationError[] = [];
    for (let i = 0; i < questionsToCreate.length; i++) {
      allErrors.push(...validateQuestion(questionsToCreate[i], i));
    }

    if (allErrors.length > 0) {
      const failedRows = new Set(allErrors.map((e) => e.index)).size;
      return NextResponse.json(
        {
          success: false,
          error: `Validation failed: ${failedRows} of ${questionsToCreate.length} questions invalid. No questions were uploaded.`,
          validation_errors: allErrors,
          created_count: 0,
        },
        { status: 400 }
      );
    }

    // Build insert rows — tenant-scoped to the caller's school
    const rows = questionsToCreate.map((q) => ({
      school_id: auth.schoolId,
      subject: (q.subject as string).trim(),
      grade: q.grade as string, // string per P5
      // topic is NOT NULL in school_questions — coerce missing topic to ''
      topic: typeof q.topic === 'string' ? q.topic.trim() : '',
      question_text: (q.question_text as string).trim(),
      options: (q.options as string[]).map((o: string) => o.trim()),
      correct_answer_index: Number(q.correct_answer_index),
      explanation: (q.explanation as string).trim(),
      difficulty: q.difficulty as string,
      bloom_level: q.bloom_level as string,
      created_by: auth.userId,
      approved: false,
    }));

    const supabase = getSupabaseAdmin();

    // Single batch insert (max 500 rows — well within PostgREST limits)
    const { data: created, error } = await supabase
      .from('school_questions')
      .insert(rows)
      .select('id, subject, grade, topic, question_text, difficulty, bloom_level, approved, created_at');

    if (error) {
      logger.error('school_admin_content_bulk_create_error', {
        error: new Error(error.message),
        route: '/api/school-admin/content/bulk',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to upload questions' },
        { status: 500 }
      );
    }

    // Fire-and-forget audit trail (metadata only — no question text, no PII)
    if (auth.schoolId) {
      const subjects = Array.from(new Set(rows.map((r) => r.subject)));
      const grades = Array.from(new Set(rows.map((r) => r.grade)));
      void logSchoolAudit({
        schoolId: auth.schoolId,
        actorId: auth.userId ?? 'unknown',
        action: 'content.bulk_uploaded',
        resourceType: 'school_question',
        // resource_id column is uuid-typed; omit for multi-row uploads
        metadata: {
          uploaded_count: created?.length ?? 0,
          subjects: subjects.slice(0, 20),
          grades,
        },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: created || [],
        created_count: created?.length ?? 0,
        validation_errors: [],
      },
      { status: 201 }
    );
  } catch (err) {
    logger.error('school_admin_content_bulk_post_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/content/bulk',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
