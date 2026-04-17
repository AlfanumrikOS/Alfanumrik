import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

// ── Constants ────────────────────────────────────────────────

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const VALID_BLOOM_LEVELS = [
  'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
] as const;

const MAX_BULK_SIZE = 100;

// ── P6 Question Validation ───────────────────────────────────

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

  // 3. correct_answer_index: 0-3
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

// ── GET — List questions ─────────────────────────────────────

/**
 * GET /api/school-admin/content — List school questions
 * Permission: school.manage_content
 *
 * Query params:
 *   ?page=       — page number (default 1)
 *   ?limit=      — items per page (default 20, max 100)
 *   ?subject=    — filter by subject
 *   ?grade=      — filter by grade (string "6"-"12")
 *   ?approved=   — filter by approval status (true|false)
 *   ?search=     — search in question_text
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_content');
    if (!auth.authorized) return auth.errorResponse;

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;
    const subject = searchParams.get('subject');
    const grade = searchParams.get('grade');
    const approvedParam = searchParams.get('approved');
    const search = searchParams.get('search');

    // Validate grade if provided (P5)
    if (grade && !VALID_GRADES.includes(grade)) {
      return NextResponse.json(
        { success: false, error: 'Invalid grade. Must be "6" through "12".' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('school_questions')
      .select(
        'id, subject, grade, topic, question_text, options, correct_answer_index, explanation, difficulty, bloom_level, approved, created_by, created_at, updated_at',
        { count: 'exact' }
      )
      .eq('school_id', auth.schoolId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (subject) {
      query = query.eq('subject', subject);
    }
    if (grade) {
      query = query.eq('grade', grade);
    }
    if (approvedParam === 'true') {
      query = query.eq('approved', true);
    } else if (approvedParam === 'false') {
      query = query.eq('approved', false);
    }
    if (search && search.trim()) {
      query = query.ilike('question_text', `%${search.trim()}%`);
    }

    const { data: questions, error, count } = await query;

    if (error) {
      logger.error('school_admin_content_list_error', {
        error: new Error(error.message),
        route: '/api/school-admin/content',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch questions' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        questions: questions || [],
        pagination: {
          page,
          limit,
          total: count ?? 0,
          total_pages: count ? Math.ceil(count / limit) : 0,
        },
      },
    });
  } catch (err) {
    logger.error('school_admin_content_get_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/content',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ── POST — Create question(s) ────────────────────────────────

/**
 * POST /api/school-admin/content — Create one or more questions
 * Permission: school.manage_content
 *
 * Body (single):
 *   { subject, grade, topic, question_text, options, correct_answer_index,
 *     explanation, difficulty, bloom_level }
 *
 * Body (bulk):
 *   { questions: [ ...array of the above ] }
 *
 * New questions start with approved = false.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_content');
    if (!auth.authorized) return auth.errorResponse;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    // Determine if single or bulk
    let questionsToCreate: QuestionInput[];

    if (Array.isArray(body.questions)) {
      questionsToCreate = body.questions as QuestionInput[];
      if (questionsToCreate.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Questions array must not be empty' },
          { status: 400 }
        );
      }
      if (questionsToCreate.length > MAX_BULK_SIZE) {
        return NextResponse.json(
          { success: false, error: `Bulk upload limited to ${MAX_BULK_SIZE} questions at a time` },
          { status: 400 }
        );
      }
    } else {
      // Single question — treat as array of 1
      questionsToCreate = [body as QuestionInput];
    }

    // Validate all questions (P6)
    const allErrors: ValidationError[] = [];
    for (let i = 0; i < questionsToCreate.length; i++) {
      const errs = validateQuestion(questionsToCreate[i], i);
      allErrors.push(...errs);
    }

    if (allErrors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          validation_errors: allErrors,
          created_count: 0,
        },
        { status: 400 }
      );
    }

    // Build insert rows
    const rows = questionsToCreate.map((q) => ({
      school_id: auth.schoolId,
      subject: (q.subject as string).trim(),
      grade: q.grade as string, // string per P5
      topic: q.topic && typeof q.topic === 'string' ? q.topic.trim() : null,
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

    const { data: created, error } = await supabase
      .from('school_questions')
      .insert(rows)
      .select('id, subject, grade, topic, question_text, difficulty, bloom_level, approved, created_at');

    if (error) {
      logger.error('school_admin_content_create_error', {
        error: new Error(error.message),
        route: '/api/school-admin/content',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to create questions' },
        { status: 500 }
      );
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
    logger.error('school_admin_content_post_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/content',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ── PATCH — Update question or approve/reject ────────────────

/**
 * PATCH /api/school-admin/content — Update a question
 * Permission: school.manage_content
 *
 * Body: {
 *   id: string (question UUID),
 *   updates: {
 *     question_text?, options?, correct_answer_index?, explanation?,
 *     difficulty?, bloom_level?, approved?
 *   }
 * }
 *
 * Content field changes are re-validated with P6 rules.
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_content');
    if (!auth.authorized) return auth.errorResponse;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { id, updates } = body as {
      id?: string;
      updates?: Record<string, unknown>;
    };

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Question ID is required' },
        { status: 400 }
      );
    }

    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one field to update is required' },
        { status: 400 }
      );
    }

    // Whitelist allowed update fields
    const ALLOWED_FIELDS = [
      'question_text', 'options', 'correct_answer_index', 'explanation',
      'difficulty', 'bloom_level', 'approved',
    ];
    const sanitizedUpdates: Record<string, unknown> = {};

    for (const key of Object.keys(updates)) {
      if (ALLOWED_FIELDS.includes(key)) {
        sanitizedUpdates[key] = updates[key];
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return NextResponse.json(
        { success: false, error: `Allowed fields: ${ALLOWED_FIELDS.join(', ')}` },
        { status: 400 }
      );
    }

    // If content fields are being updated, we need to fetch the current question
    // and validate the merged result against P6.
    const CONTENT_FIELDS = ['question_text', 'options', 'correct_answer_index', 'explanation', 'difficulty', 'bloom_level'];
    const hasContentUpdates = CONTENT_FIELDS.some((f) => f in sanitizedUpdates);

    const supabase = getSupabaseAdmin();

    if (hasContentUpdates) {
      // Fetch current question to merge with updates for validation
      const { data: currentQ, error: fetchError } = await supabase
        .from('school_questions')
        .select('question_text, options, correct_answer_index, explanation, difficulty, bloom_level, grade, subject')
        .eq('id', id)
        .eq('school_id', auth.schoolId)
        .single();

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          return NextResponse.json(
            { success: false, error: 'Question not found' },
            { status: 404 }
          );
        }
        logger.error('school_admin_content_fetch_error', {
          error: new Error(fetchError.message),
          route: '/api/school-admin/content',
          schoolId: auth.schoolId,
        });
        return NextResponse.json(
          { success: false, error: 'Failed to fetch question for validation' },
          { status: 500 }
        );
      }

      if (!currentQ) {
        return NextResponse.json(
          { success: false, error: 'Question not found' },
          { status: 404 }
        );
      }

      // Merge current values with updates for P6 validation
      const merged: QuestionInput = {
        question_text: (sanitizedUpdates.question_text as string) ?? currentQ.question_text,
        options: (sanitizedUpdates.options as string[]) ?? currentQ.options,
        correct_answer_index: sanitizedUpdates.correct_answer_index ?? currentQ.correct_answer_index,
        explanation: (sanitizedUpdates.explanation as string) ?? currentQ.explanation,
        difficulty: (sanitizedUpdates.difficulty as string) ?? currentQ.difficulty,
        bloom_level: (sanitizedUpdates.bloom_level as string) ?? currentQ.bloom_level,
        grade: currentQ.grade, // grade not editable via PATCH to prevent cross-grade issues
        subject: currentQ.subject, // subject not editable either
      };

      const validationErrors = validateQuestion(merged, 0);
      if (validationErrors.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Validation failed',
            validation_errors: validationErrors,
          },
          { status: 400 }
        );
      }

      // Trim string content fields
      if (typeof sanitizedUpdates.question_text === 'string') {
        sanitizedUpdates.question_text = sanitizedUpdates.question_text.trim();
      }
      if (typeof sanitizedUpdates.explanation === 'string') {
        sanitizedUpdates.explanation = sanitizedUpdates.explanation.trim();
      }
      if (Array.isArray(sanitizedUpdates.options)) {
        sanitizedUpdates.options = (sanitizedUpdates.options as string[]).map((o: string) => o.trim());
      }
      if (sanitizedUpdates.correct_answer_index !== undefined) {
        sanitizedUpdates.correct_answer_index = Number(sanitizedUpdates.correct_answer_index);
      }
    }

    // Validate approved field if present
    if ('approved' in sanitizedUpdates && typeof sanitizedUpdates.approved !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'approved must be a boolean' },
        { status: 400 }
      );
    }

    const { data: updated, error } = await supabase
      .from('school_questions')
      .update(sanitizedUpdates)
      .eq('id', id)
      .eq('school_id', auth.schoolId)
      .select('id, subject, grade, topic, question_text, options, correct_answer_index, explanation, difficulty, bloom_level, approved, updated_at')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { success: false, error: 'Question not found' },
          { status: 404 }
        );
      }
      logger.error('school_admin_content_update_error', {
        error: new Error(error.message),
        route: '/api/school-admin/content',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to update question' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    logger.error('school_admin_content_patch_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/content',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ── DELETE — Remove question(s) ──────────────────────────────

/**
 * DELETE /api/school-admin/content — Hard delete question(s)
 * Permission: school.manage_content
 *
 * Body: { id: string } or { ids: string[] }
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_content');
    if (!auth.authorized) return auth.errorResponse;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    // Support single id or array of ids
    let idsToDelete: string[];

    if (Array.isArray(body.ids)) {
      idsToDelete = body.ids as string[];
    } else if (typeof body.id === 'string') {
      idsToDelete = [body.id];
    } else {
      return NextResponse.json(
        { success: false, error: 'Provide "id" (string) or "ids" (string[])' },
        { status: 400 }
      );
    }

    if (idsToDelete.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one ID is required' },
        { status: 400 }
      );
    }

    if (idsToDelete.length > MAX_BULK_SIZE) {
      return NextResponse.json(
        { success: false, error: `Bulk delete limited to ${MAX_BULK_SIZE} questions at a time` },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: deleted, error } = await supabase
      .from('school_questions')
      .delete()
      .in('id', idsToDelete)
      .eq('school_id', auth.schoolId)
      .select('id');

    if (error) {
      logger.error('school_admin_content_delete_error', {
        error: new Error(error.message),
        route: '/api/school-admin/content',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to delete questions' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        deleted_count: deleted?.length ?? 0,
        deleted_ids: (deleted || []).map((d: { id: string }) => d.id),
      },
    });
  } catch (err) {
    logger.error('school_admin_content_delete_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/content',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
