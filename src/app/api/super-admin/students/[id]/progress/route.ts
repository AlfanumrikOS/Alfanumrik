import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, isValidUUID } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  validateImpersonationSession,
  recordPageView,
} from '../../_lib/validate-session';

// GET /api/super-admin/students/[id]/progress — mastery data for Live View progress tab
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const { id: studentId } = await params;
  if (!isValidUUID(studentId)) {
    return NextResponse.json({ error: 'Invalid student ID' }, { status: 400 });
  }

  // Require active impersonation session
  const valid = await validateImpersonationSession(auth.adminId, studentId);
  if (!valid) {
    return NextResponse.json(
      { error: 'No active impersonation session' },
      { status: 403 }
    );
  }

  try {
    // Get student's grade to scope curriculum topics
    const { data: student } = await supabaseAdmin
      .from('students')
      .select('grade')
      .eq('id', studentId)
      .single();

    const [masteryRes, topicsRes, quizRes] = await Promise.all([
      // Concept mastery with topic info
      supabaseAdmin
        .from('concept_mastery')
        .select(
          'topic_id, mastery_probability, mastery_level, attempts, correct_attempts, confidence_score, bloom_mastery, updated_at, curriculum_topics(title, subject_id, subjects(code))'
        )
        .eq('student_id', studentId),

      // Curriculum topics for the student's grade
      student?.grade
        ? supabaseAdmin
            .from('curriculum_topics')
            .select('id, title, title_hi, grade, difficulty_level, chapter_number, subject_id, subjects(code)')
            .eq('grade', student.grade)
            .eq('is_active', true)
            .order('chapter_number', { ascending: true })
        : Promise.resolve({ data: [], error: null }),

      // Recent quizzes for velocity calculation
      supabaseAdmin
        .from('quiz_sessions')
        .select(
          'id, subject, score_percent, total_questions, correct_answers, difficulty_level, completed_at, created_at'
        )
        .eq('student_id', studentId)
        .eq('is_completed', true)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

    // Fire-and-forget page view tracking
    recordPageView(auth.adminId, studentId, 'progress');

    return NextResponse.json({
      mastery: masteryRes.data || [],
      topics: topicsRes.data || [],
      recentQuizzes: quizRes.data || [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
