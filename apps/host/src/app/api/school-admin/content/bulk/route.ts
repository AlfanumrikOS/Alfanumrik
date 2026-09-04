import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logSchoolAudit } from '@alfanumrik/lib/audit';
import {
  validateQuestion,
  type QuestionInput,
  type ValidationError,
} from '@alfanumrik/lib/school-admin/question-validation';

/** Hard cap per request — CSV bulk upload endpoint. */
const MAX_BULK_SIZE = 500;

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
