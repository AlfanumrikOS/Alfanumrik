import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

interface CreateExamBody {
  class_id: string;
  exam_name: string;
  exam_type?: string;
  exam_date: string;
  subject?: string;
  chapters?: string[];
}

/**
 * POST /api/v1/exam/create — Create an exam for a class
 * Permission: exam.create_for_class
 *
 * Body: { class_id, exam_name, exam_type?, exam_date, subject?, chapters?[] }
 * The teacher must be assigned to the class.
 */
export async function POST(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'exam.create_for_class');
    if (!auth.authorized) return auth.errorResponse!;

    const body: CreateExamBody = await request.json();

    // Validate required fields
    if (!body.class_id || !body.exam_name || !body.exam_date) {
      return NextResponse.json(
        { error: 'Missing required fields: class_id, exam_name, exam_date' },
        { status: 400 }
      );
    }

    // Validate exam_date format
    if (!/^\d{4}-\d{2}-\d{2}/.test(body.exam_date)) {
      return NextResponse.json(
        { error: 'Invalid exam_date format. Use YYYY-MM-DD.' },
        { status: 400 }
      );
    }

    // Resolve teacher_id from the authenticated user
    const { data: teacher } = await supabaseAdmin
      .from('teachers')
      .select('id')
      .eq('user_id', auth.userId)
      .single();

    if (!teacher) {
      return NextResponse.json(
        { error: 'Teacher profile not found' },
        { status: 403 }
      );
    }

    // Verify teacher is assigned to this class
    const { data: classTeacher } = await supabaseAdmin
      .from('class_teachers')
      .select('id')
      .eq('class_id', body.class_id)
      .eq('teacher_id', teacher.id)
      .single();

    if (!classTeacher) {
      return NextResponse.json(
        { error: 'Not assigned to this class' },
        { status: 403 }
      );
    }

    // Get all students in the class
    const { data: students } = await supabaseAdmin
      .from('class_students')
      .select('student_id')
      .eq('class_id', body.class_id);

    if (!students || students.length === 0) {
      return NextResponse.json(
        { error: 'No students found in this class' },
        { status: 404 }
      );
    }

    // Create exam configs for each student
    const examConfigs = students.map((s) => ({
      student_id: s.student_id,
      class_id: body.class_id,
      exam_name: body.exam_name,
      exam_type: body.exam_type || 'unit_test',
      exam_date: body.exam_date,
      subject: body.subject || null,
      created_by: auth.userId,
    }));

    const { data: insertedExams, error: examError } = await supabaseAdmin
      .from('exam_configs')
      .insert(examConfigs)
      .select('id, student_id');

    if (examError) {
      return NextResponse.json(
        { error: 'Failed to create exam configurations' },
        { status: 500 }
      );
    }

    // If chapters are specified, create chapter entries for each exam config
    if (body.chapters && body.chapters.length > 0 && insertedExams) {
      const chapterRows = insertedExams.flatMap((exam) =>
        body.chapters!.map((chapter) => ({
          exam_config_id: exam.id,
          chapter_name: chapter,
        }))
      );

      await supabaseAdmin.from('exam_chapters').insert(chapterRows);
    }

    logAudit(auth.userId, {
      action: 'create',
      resourceType: 'exam',
      details: {
        class_id: body.class_id,
        exam_name: body.exam_name,
        student_count: students.length,
      },
    });

    return NextResponse.json(
      {
        success: true,
        exam_name: body.exam_name,
        students_assigned: students.length,
      },
      { status: 201 }
    );
  } catch (err) {
    logger.error('exam_create_failed', { error: err instanceof Error ? err : new Error(String(err)), route: '/api/v1/exam/create' });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
