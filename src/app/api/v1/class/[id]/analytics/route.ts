import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/v1/class/:id/analytics — View class-level analytics
 * Permission: class.view_analytics
 *
 * Returns aggregate performance data for all students in the class:
 * average scores, mastery distribution, weak topics, and velocity trends.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: classId } = await params;

    const auth = await authorizeRequest(request, 'class.view_analytics');
    if (!auth.authorized) return auth.errorResponse!;

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
      .eq('class_id', classId)
      .eq('teacher_id', teacher.id)
      .single();

    if (!classTeacher) {
      return NextResponse.json(
        { error: 'Not assigned to this class' },
        { status: 403 }
      );
    }

    // Get student IDs in the class
    const { data: classStudents } = await supabaseAdmin
      .from('class_students')
      .select('student_id')
      .eq('class_id', classId);

    if (!classStudents || classStudents.length === 0) {
      return NextResponse.json({
        class_id: classId,
        student_count: 0,
        quizzes: [],
        mastery: [],
        velocity: [],
      });
    }

    const studentIds = classStudents.map((s) => s.student_id);

    // Fetch analytics in parallel
    const [quizzes, mastery, velocity] = await Promise.all([
      supabaseAdmin
        .from('quiz_sessions')
        .select(
          'student_id, subject, score_percent, total_questions, correct_answers, completed_at'
        )
        .in('student_id', studentIds)
        .order('completed_at', { ascending: false })
        .limit(200),
      supabaseAdmin
        .from('concept_mastery')
        .select(
          'student_id, topic_id, mastery_probability, consecutive_correct, updated_at'
        )
        .in('student_id', studentIds),
      supabaseAdmin
        .from('learning_velocity')
        .select(
          'student_id, subject, weekly_mastery_rate, acceleration, predicted_mastery_date'
        )
        .in('student_id', studentIds),
    ]);

    // Compute aggregate statistics
    const quizData = quizzes.data || [];
    const avgScore =
      quizData.length > 0
        ? quizData.reduce((sum, q) => sum + (q.score_percent || 0), 0) /
          quizData.length
        : 0;

    const masteryData = mastery.data || [];
    const avgMastery =
      masteryData.length > 0
        ? masteryData.reduce(
            (sum, m) => sum + (m.mastery_probability || 0),
            0
          ) / masteryData.length
        : 0;

    // Identify weak topics (mastery < 0.5)
    const weakTopics = masteryData
      .filter((m) => (m.mastery_probability || 0) < 0.5)
      .reduce(
        (acc, m) => {
          acc[m.topic_id] = (acc[m.topic_id] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

    const weakTopicsSorted = Object.entries(weakTopics)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([topic_id, student_count]) => ({ topic_id, student_count }));

    logAudit(auth.userId, {
      action: 'view',
      resourceType: 'class_analytics',
      resourceId: classId,
    });

    return NextResponse.json({
      class_id: classId,
      student_count: studentIds.length,
      summary: {
        average_quiz_score: Math.round(avgScore * 100) / 100,
        average_mastery: Math.round(avgMastery * 1000) / 1000,
        total_quizzes: quizData.length,
      },
      weak_topics: weakTopicsSorted,
      quizzes: quizData,
      mastery: masteryData,
      velocity: velocity.data || [],
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
