import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

// GET — flexible academic report endpoint
export async function GET(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.view_reports');
  if (!auth.authorized) return auth.errorResponse!;

  const params = new URL(request.url).searchParams;
  const type = params.get('type') || 'school_overview';

  switch (type) {
    case 'school_overview': return schoolOverview(auth.schoolId!);
    case 'class_performance': return classPerformance(auth.schoolId!, params);
    case 'student_detail': return studentDetail(auth.schoolId!, params);
    case 'subject_gaps': return subjectGaps(auth.schoolId!, params);
    default: return NextResponse.json({ error: `Unknown report type: ${type}` }, { status: 400 });
  }
}

// ── School Overview ─────────────────────────────────────────
async function schoolOverview(schoolId: string) {
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000).toISOString();

  const [studentsRes, quizzesRes, prevQuizzesRes] = await Promise.all([
    supabase
      .from('students')
      .select('id, grade, is_active, last_active', { count: 'exact' })
      .eq('school_id', schoolId)
      .eq('is_active', true),
    supabase
      .from('quiz_sessions')
      .select('subject, score_percent, student_id')
      .eq('school_id', schoolId)
      .gte('created_at', weekAgo),
    supabase
      .from('quiz_sessions')
      .select('id', { count: 'exact' })
      .eq('school_id', schoolId)
      .gte('created_at', twoWeeksAgo)
      .lt('created_at', weekAgo),
  ]);

  const students = studentsRes.data || [];
  const quizzes = quizzesRes.data || [];
  const totalStudents = studentsRes.count || 0;

  // Active students (last_active within 7 days)
  const activeStudents = students.filter(s => s.last_active && s.last_active > weekAgo).length;

  // Avg score
  const avgScore = quizzes.length > 0
    ? Math.round(quizzes.reduce((sum, q) => sum + (q.score_percent || 0), 0) / quizzes.length)
    : 0;

  // Subject breakdown
  const subjectMap = new Map<string, { scores: number[]; students: Set<string> }>();
  for (const q of quizzes) {
    if (!subjectMap.has(q.subject)) subjectMap.set(q.subject, { scores: [], students: new Set() });
    const entry = subjectMap.get(q.subject)!;
    entry.scores.push(q.score_percent || 0);
    entry.students.add(q.student_id);
  }

  const subject_performance = Array.from(subjectMap.entries()).map(([subject, data]) => ({
    subject,
    quiz_count: data.scores.length,
    avg_score: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
    student_count: data.students.size,
  })).sort((a, b) => b.quiz_count - a.quiz_count);

  // Grade breakdown
  const gradeMap = new Map<string, number>();
  for (const s of students) {
    gradeMap.set(s.grade, (gradeMap.get(s.grade) || 0) + 1);
  }

  const grade_performance = Array.from(gradeMap.entries()).map(([grade, count]) => {
    const gradeQuizzes = quizzes.filter(q => {
      const student = students.find(s => s.id === q.student_id);
      return student?.grade === grade;
    });
    return {
      grade, // P5: string
      student_count: count,
      avg_score: gradeQuizzes.length > 0
        ? Math.round(gradeQuizzes.reduce((sum, q) => sum + (q.score_percent || 0), 0) / gradeQuizzes.length)
        : 0,
      quiz_count: gradeQuizzes.length,
    };
  }).sort((a, b) => parseInt(a.grade) - parseInt(b.grade));

  // Unique quiz-taking students
  const quizStudents = new Set(quizzes.map(q => q.student_id));
  const completionRate = totalStudents > 0
    ? Math.round((quizStudents.size / totalStudents) * 100)
    : 0;

  // Trend
  const prevWeekCount = prevQuizzesRes.count || 0;
  const trend = quizzes.length - prevWeekCount;

  return NextResponse.json({
    total_quizzes: quizzes.length,
    avg_score: avgScore,
    active_students: activeStudents,
    total_students: totalStudents,
    completion_rate: completionRate,
    trend_vs_last_week: trend,
    subject_performance,
    grade_performance,
  });
}

// ── Class Performance ───────────────────────────────────────
async function classPerformance(schoolId: string, params: URLSearchParams) {
  const classId = params.get('class_id');
  if (!classId) return NextResponse.json({ error: 'class_id required' }, { status: 400 });

  const supabase = getSupabaseAdmin();

  // Verify class belongs to school
  const { data: cls } = await supabase
    .from('classes')
    .select('id, name, grade, section')
    .eq('id', classId)
    .eq('school_id', schoolId)
    .single();

  if (!cls) return NextResponse.json({ error: 'Class not found' }, { status: 404 });

  // Get enrolled students
  const { data: enrollments } = await supabase
    .from('class_enrollments')
    .select('student_id')
    .eq('class_id', classId)
    .eq('is_active', true);

  const studentIds = (enrollments || []).map(e => e.student_id);
  if (studentIds.length === 0) {
    return NextResponse.json({
      class_info: cls,
      enrolled_count: 0,
      avg_score: 0,
      top_students: [],
      bottom_students: [],
      subject_breakdown: [],
      completion_rate: 0,
    });
  }

  // Get quiz data for enrolled students
  const { data: quizzes } = await supabase
    .from('quiz_sessions')
    .select('student_id, subject, score_percent')
    .in('student_id', studentIds)
    .eq('school_id', schoolId);

  const allQuizzes = quizzes || [];

  // Student averages
  const studentScores = new Map<string, number[]>();
  for (const q of allQuizzes) {
    if (!studentScores.has(q.student_id)) studentScores.set(q.student_id, []);
    studentScores.get(q.student_id)!.push(q.score_percent || 0);
  }

  const studentAvgs = Array.from(studentScores.entries()).map(([sid, scores]) => ({
    student_id: sid,
    avg_score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    quiz_count: scores.length,
  }));

  // Get student names
  const { data: studentNames } = await supabase
    .from('students')
    .select('id, name, grade')
    .in('id', studentIds);

  const nameMap = new Map((studentNames || []).map(s => [s.id, s.name]));
  const enriched = studentAvgs.map(s => ({ ...s, name: nameMap.get(s.student_id) || 'Unknown' }));
  enriched.sort((a, b) => b.avg_score - a.avg_score);

  // Subject breakdown
  const subjectMap = new Map<string, number[]>();
  for (const q of allQuizzes) {
    if (!subjectMap.has(q.subject)) subjectMap.set(q.subject, []);
    subjectMap.get(q.subject)!.push(q.score_percent || 0);
  }

  const subject_breakdown = Array.from(subjectMap.entries()).map(([subject, scores]) => ({
    subject,
    avg_score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    quiz_count: scores.length,
  }));

  const overallAvg = allQuizzes.length > 0
    ? Math.round(allQuizzes.reduce((sum, q) => sum + (q.score_percent || 0), 0) / allQuizzes.length)
    : 0;

  const quizTakers = new Set(allQuizzes.map(q => q.student_id));

  return NextResponse.json({
    class_info: cls,
    enrolled_count: studentIds.length,
    avg_score: overallAvg,
    completion_rate: Math.round((quizTakers.size / studentIds.length) * 100),
    top_students: enriched.slice(0, 5),
    bottom_students: enriched.slice(-5).reverse(),
    subject_breakdown,
  });
}

// ── Student Detail ──────────────────────────────────────────
async function studentDetail(schoolId: string, params: URLSearchParams) {
  const studentId = params.get('student_id');
  if (!studentId) return NextResponse.json({ error: 'student_id required' }, { status: 400 });

  const supabase = getSupabaseAdmin();

  // Verify student belongs to school
  const { data: student } = await supabase
    .from('students')
    .select('id, name, grade, xp_total, last_active, subscription_plan')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single();

  if (!student) return NextResponse.json({ error: 'Student not found in your school' }, { status: 404 });

  // Get quiz history (last 90 days)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data: quizzes } = await supabase
    .from('quiz_sessions')
    .select('subject, score_percent, total_questions, correct_answers, created_at')
    .eq('student_id', studentId)
    .gte('created_at', ninetyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(200);

  const allQuizzes = quizzes || [];

  // Per-subject stats
  const subjectMap = new Map<string, number[]>();
  for (const q of allQuizzes) {
    if (!subjectMap.has(q.subject)) subjectMap.set(q.subject, []);
    subjectMap.get(q.subject)!.push(q.score_percent || 0);
  }

  const subject_scores = Array.from(subjectMap.entries()).map(([subject, scores]) => ({
    subject,
    avg_score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    quiz_count: scores.length,
  })).sort((a, b) => b.avg_score - a.avg_score);

  const bestSubject = subject_scores[0]?.subject || null;
  const weakestSubject = subject_scores[subject_scores.length - 1]?.subject || null;
  const overallAvg = allQuizzes.length > 0
    ? Math.round(allQuizzes.reduce((sum, q) => sum + (q.score_percent || 0), 0) / allQuizzes.length)
    : 0;

  return NextResponse.json({
    student: {
      id: student.id,
      name: student.name,
      grade: student.grade, // P5: string
      xp_total: student.xp_total,
      last_active: student.last_active,
    },
    total_quizzes: allQuizzes.length,
    avg_score: overallAvg,
    best_subject: bestSubject,
    weakest_subject: weakestSubject,
    subject_scores,
    recent_quizzes: allQuizzes.slice(0, 20),
  });
}

// ── Subject Gaps ────────────────────────────────────────────
async function subjectGaps(schoolId: string, params: URLSearchParams) {
  const grade = params.get('grade'); // P5: string or null for all
  const supabase = getSupabaseAdmin();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  let query = supabase
    .from('quiz_sessions')
    .select('subject, score_percent, student_id')
    .eq('school_id', schoolId)
    .gte('created_at', thirtyDaysAgo);

  if (grade) {
    // Filter to students in this grade
    const { data: gradeStudents } = await supabase
      .from('students')
      .select('id')
      .eq('school_id', schoolId)
      .eq('grade', grade) // P5: string
      .eq('is_active', true);

    const studentIds = (gradeStudents || []).map(s => s.id);
    if (studentIds.length === 0) {
      return NextResponse.json({ grade, gaps: [] });
    }
    query = query.in('student_id', studentIds);
  }

  const { data: quizzes } = await query;
  const allQuizzes = quizzes || [];

  // Group by subject
  const subjectMap = new Map<string, { scores: number[]; students: Set<string> }>();
  for (const q of allQuizzes) {
    if (!subjectMap.has(q.subject)) subjectMap.set(q.subject, { scores: [], students: new Set() });
    const entry = subjectMap.get(q.subject)!;
    entry.scores.push(q.score_percent || 0);
    entry.students.add(q.student_id);
  }

  const gaps = Array.from(subjectMap.entries()).map(([subject, data]) => {
    const avg = Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length);
    let status: 'critical' | 'needs_attention' | 'good';
    if (avg < 50) status = 'critical';
    else if (avg < 70) status = 'needs_attention';
    else status = 'good';

    return {
      subject,
      avg_score: avg,
      quiz_count: data.scores.length,
      student_count: data.students.size,
      status,
    };
  }).sort((a, b) => a.avg_score - b.avg_score);

  return NextResponse.json({ grade: grade || 'all', gaps });
}
