import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, isValidUUID } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/super-admin/students/[id]/profile — aggregated student data for Data Panel
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

  try {
    // Run all queries in parallel
    const [
      studentRes,
      masteryRes,
      gapsRes,
      quizRes,
      chatRes,
      usageRes,
      parentRes,
      classRes,
      subRes,
      opsRes,
    ] = await Promise.all([
      // 1. Student record
      supabaseAdmin.from('students').select('*').eq('id', studentId).single(),

      // 2. Concept mastery — join via curriculum_topics for subject info
      supabaseAdmin
        .from('concept_mastery')
        .select(
          'topic_id, mastery_probability, mastery_level, attempts, correct_attempts, updated_at, curriculum_topics(title, subject_id, subjects(code))'
        )
        .eq('student_id', studentId),

      // 3. Knowledge gaps
      supabaseAdmin
        .from('knowledge_gaps')
        .select(
          'id, target_concept_name, missing_prerequisite_name, detection_method, confidence_score, status, remediation_plan, detected_at'
        )
        .eq('student_id', studentId)
        .neq('status', 'resolved')
        .order('detected_at', { ascending: false })
        .limit(20),

      // 4. Recent quiz sessions
      supabaseAdmin
        .from('quiz_sessions')
        .select(
          'id, subject, topic_title, score_percent, total_questions, correct_answers, difficulty_level, time_taken_seconds, is_completed, completed_at, created_at'
        )
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(10),

      // 5. Recent chat sessions (legacy foxy-tutor)
      supabaseAdmin
        .from('chat_sessions')
        .select('id, subject, title, message_count, created_at')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(10),

      // 6. Daily usage (feature-based)
      supabaseAdmin
        .from('student_daily_usage')
        .select('feature, usage_date, usage_count')
        .eq('student_id', studentId)
        .order('usage_date', { ascending: false })
        .limit(30),

      // 7. Parent/guardian links
      supabaseAdmin
        .from('guardian_student_links')
        .select('guardian_id, status, guardians(id, name, email, phone)')
        .eq('student_id', studentId),

      // 8. Class enrollments
      supabaseAdmin
        .from('class_students')
        .select('class_id, classes(id, name, grade, section)')
        .eq('student_id', studentId),

      // 9. Subscription
      supabaseAdmin
        .from('student_subscriptions')
        .select('*')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(1),

      // 10. Ops events
      supabaseAdmin
        .from('ops_events')
        .select('id, occurred_at, category, source, severity, message')
        .eq('subject_id', studentId)
        .order('occurred_at', { ascending: false })
        .limit(20),
    ]);

    // If student not found, return 404
    if (!studentRes.data) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    // Compute subjectMastery from concept_mastery data
    const subjectMastery: Record<string, { topics: number; avgMastery: number }> = {};
    if (masteryRes.data) {
      const bySubject: Record<string, number[]> = {};
      for (const row of masteryRes.data as any[]) {
        const subjectCode =
          row.curriculum_topics?.subjects?.code as string | undefined;
        const masteryVal = row.mastery_probability as number | null;
        if (subjectCode && masteryVal != null) {
          (bySubject[subjectCode] = bySubject[subjectCode] || []).push(
            masteryVal
          );
        }
      }
      for (const [code, vals] of Object.entries(bySubject)) {
        subjectMastery[code] = {
          topics: vals.length,
          avgMastery: Math.round(
            (vals.reduce((a, b) => a + b, 0) / vals.length) * 100
          ),
        };
      }
    }

    // Compute bloomDistribution from question_responses
    // quiz_sessions doesn't have bloom_level, so we derive from question_responses
    const bloomDistribution: Record<string, number> = {};
    try {
      const { data: responses } = await supabaseAdmin
        .from('quiz_responses')
        .select('bloom_level')
        .eq('student_id', studentId)
        .not('bloom_level', 'is', null);

      if (responses) {
        for (const r of responses) {
          const level = r.bloom_level as string;
          bloomDistribution[level] = (bloomDistribution[level] || 0) + 1;
        }
      }
    } catch {
      // Non-fatal: bloom distribution may not be available
    }

    return NextResponse.json({
      student: studentRes.data,
      subjectMastery,
      knowledgeGaps: gapsRes.data || [],
      bloomDistribution,
      recentQuizzes: quizRes.data || [],
      recentChats: chatRes.data || [],
      dailyUsage: usageRes.data || [],
      parentLinks: parentRes.data || [],
      classLinks: classRes.data || [],
      subscription: subRes.data?.[0] || null,
      opsEvents: opsRes.data || [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
