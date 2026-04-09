/**
 * POST /api/diagnostic/start
 *
 * Creates a diagnostic_sessions row and returns the session ID + 15 questions.
 * Questions are included in the response to avoid a second round-trip (P10).
 *
 * Request body: { grade: string, subject: string }
 * Response: { success: true, session_id: string, questions: Question[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

// P5: grades are strings "6"-"10" for diagnostic (6-10 only)
const VALID_DIAGNOSTIC_GRADES = ['6', '7', '8', '9', '10'];

const SUBJECT_BY_GRADE: Record<string, string[]> = {
  '6': ['math', 'science'],
  '7': ['math', 'science'],
  '8': ['math', 'science'],
  '9': ['math', 'physics', 'chemistry', 'biology'],
  '10': ['math', 'physics', 'chemistry', 'biology'],
};

const DIAGNOSTIC_QUESTION_COUNT = 15;

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate via session cookie (P8: RLS-aware, no service role for auth check)
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    // 2. Parse body
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', code: 'INVALID_BODY' },
        { status: 400 }
      );
    }

    const { grade, subject } = body as { grade?: string; subject?: string };

    // 3. Validate grade
    if (!grade || !VALID_DIAGNOSTIC_GRADES.includes(grade)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Grade must be between 6 and 10 for diagnostic assessment.',
          code: 'INVALID_GRADE',
        },
        { status: 400 }
      );
    }

    // 4. Validate subject for grade
    const allowedSubjects = SUBJECT_BY_GRADE[grade] ?? [];
    if (!subject || !allowedSubjects.includes(subject.toLowerCase())) {
      return NextResponse.json(
        {
          success: false,
          error: `Subject must be one of: ${allowedSubjects.join(', ')} for grade ${grade}.`,
          code: 'INVALID_SUBJECT',
        },
        { status: 400 }
      );
    }

    // 5. Resolve student_id via admin client
    const admin = getSupabaseAdmin();
    const { data: student, error: studentError } = await admin
      .from('students')
      .select('id, grade')
      .eq('auth_user_id', user.id)
      .single();

    if (studentError || !student) {
      return NextResponse.json(
        { success: false, error: 'Student profile not found.', code: 'NO_STUDENT' },
        { status: 404 }
      );
    }

    // 6. Fetch 15 questions ordered by difficulty ascending (easy first for diagnostic ramp-up)
    const { data: questions, error: questionsError } = await admin
      .from('question_bank')
      .select(
        'id, question_text, question_hi, question_type, options, correct_answer_index, explanation, explanation_hi, difficulty, bloom_level, chapter_number, topic_id'
      )
      .eq('grade', grade)
      .eq('subject', subject.toLowerCase())
      .eq('is_active', true)
      .order('difficulty', { ascending: true })
      .limit(DIAGNOSTIC_QUESTION_COUNT);

    if (questionsError) {
      logger.error('diagnostic_fetch_questions_failed', {
        error: new Error(questionsError.message),
        route: '/api/diagnostic/start',
        studentId: student.id,
        grade,
        subject,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load questions. Please try again.', code: 'QUESTIONS_ERROR' },
        { status: 500 }
      );
    }

    if (!questions || questions.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No questions available for this grade and subject.',
          code: 'NO_QUESTIONS',
        },
        { status: 404 }
      );
    }

    // 7. Create diagnostic_sessions row
    const { data: session, error: sessionError } = await admin
      .from('diagnostic_sessions')
      .insert({
        student_id: student.id,
        grade,
        subject: subject.toLowerCase(),
        total_questions: questions.length,
        status: 'in_progress',
      })
      .select('id')
      .single();

    if (sessionError || !session) {
      logger.error('diagnostic_create_session_failed', {
        error: new Error(sessionError?.message ?? 'No session returned'),
        route: '/api/diagnostic/start',
        studentId: student.id,
        grade,
        subject,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to start diagnostic session.', code: 'SESSION_CREATE_ERROR' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        session_id: session.id,
        questions,
      },
    });
  } catch (err) {
    logger.error('diagnostic_start_unexpected', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/diagnostic/start',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
