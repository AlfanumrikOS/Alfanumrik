import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { schoolAdminPermissionCode } from '@alfanumrik/lib/school-admin/permission-code';
import { assertModuleEnabledForSchool } from '@alfanumrik/lib/modules/route-guard';

// GET — flexible academic report endpoint.
// Permission (Wave C matrix): flag OFF → `institution.view_reports` (original);
// flag ON → `institution.export_reports` (report export matrix code).
export async function GET(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(
    request,
    await schoolAdminPermissionCode({ off: 'institution.view_reports', on: 'institution.export_reports' }),
  );
  if (!auth.authorized) return auth.errorResponse!;

  // Module gate: academic reports belong to the `analytics` module (registry
  // routePrefix `/reports`). Disabled → 404; flag OFF / unresolved → allowed.
  const gate = await assertModuleEnabledForSchool(auth.schoolId, 'analytics');
  if (!gate.allowed) return gate.response;

  const params = new URL(request.url).searchParams;
  const type = params.get('type') || 'school_overview';

  switch (type) {
    case 'school_overview': return schoolOverview(auth.schoolId!);
    case 'class_performance': return classPerformance(auth.schoolId!, params);
    case 'student_detail': return studentDetail(auth.schoolId!, params);
    case 'student_search': return studentSearch(auth.schoolId!, params);
    case 'subject_gaps': return subjectGaps(auth.schoolId!, params);
    default: return NextResponse.json({ success: false, error: `Unknown report type: ${type}` }, { status: 400 });
  }
}

// Every handler returns the canonical school-admin envelope `{ success, data }`
// (the reports page unwraps `json.data` and throws when `!json.success`). The
// 400/404 error paths keep `{ success: false, error }` for the same reason.
function ok(data: unknown) {
  return NextResponse.json({ success: true, data });
}

// ── Row caps (Task 3.2, RCA fix — unbounded query risk) ─────────────────────
// `studentDetail` already capped its 90-day quiz-history read at 200 rows (a
// single student's own history, so 200 is a generous ceiling). The three
// school/class-wide handlers below had NO cap at all: `schoolOverview` and
// `subjectGaps` read every `quiz_sessions` row for the WHOLE SCHOOL in a
// 7/30-day window, and `classPerformance` reads every row for every student
// enrolled in one class. A large/active school can produce tens of thousands
// of rows in those windows, risking slow queries / request timeouts and large
// response payloads.
//
// Caps chosen per handler (documented reasoning):
//   - SCHOOL_WIDE_QUIZ_ROW_CAP (10,000): schoolOverview/subjectGaps aggregate
//     across the ENTIRE school over a 7/30-day window. 10K rows is enough for
//     a large school (thousands of students × several quizzes/week) while
//     still bounding worst-case payload/query cost; it mirrors the existing
//     10,000-row cap already used elsewhere in this surface for a
//     whole-school CSV export (`data-export/route.ts`'s exportQuizResults).
//   - CLASS_QUIZ_ROW_CAP (2,000): classPerformance aggregates across the
//     students of ONE class. A single class is small (tens of students), so
//     2,000 rows (dozens of quizzes/student) comfortably covers legitimate
//     use while still capping a pathological single-class query.
// Both are well above realistic legitimate volumes, so truncation should be
// rare — the `truncated` flag exists precisely so a caller is told, rather
// than silently served an incomplete aggregate, on the rare occasion the cap
// is hit.
const SCHOOL_WIDE_QUIZ_ROW_CAP = 10_000;
const CLASS_QUIZ_ROW_CAP = 2_000;

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
      // NOTE (Phase 2 Task 2.2): `created_at` is additive to this SELECT to
      // power the new `score_trend` field below. subject/score_percent/
      // student_id were already selected and used unchanged.
      // NOTE (Task 3.2): capped at SCHOOL_WIDE_QUIZ_ROW_CAP+1 (fetch one extra
      // row so we can detect "more rows exist than the cap" without a
      // separate count query; the +1th row is trimmed below).
      .select('subject, score_percent, student_id, created_at')
      .eq('school_id', schoolId)
      .gte('created_at', weekAgo)
      .limit(SCHOOL_WIDE_QUIZ_ROW_CAP + 1),
    supabase
      .from('quiz_sessions')
      .select('id', { count: 'exact' })
      .eq('school_id', schoolId)
      .gte('created_at', twoWeeksAgo)
      .lt('created_at', weekAgo),
  ]);

  const students = studentsRes.data || [];
  // Task 3.2: the query fetched up to SCHOOL_WIDE_QUIZ_ROW_CAP+1 rows; if we
  // got the extra row, more rows exist than the cap — trim it and flag
  // `truncated` so the caller knows the aggregate may be incomplete rather
  // than silently under-reporting.
  const fetchedQuizzes = quizzesRes.data || [];
  const truncated = fetchedQuizzes.length > SCHOOL_WIDE_QUIZ_ROW_CAP;
  const quizzes = truncated ? fetchedQuizzes.slice(0, SCHOOL_WIDE_QUIZ_ROW_CAP) : fetchedQuizzes;
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

  // ── score_trend (Phase 2 Task 2.2, ADDITIVE ONLY) ──────────────────────────
  // Date-bucketed (YYYY-MM-DD) avg score_percent series over the same 7-day
  // window already queried above. New field; every pre-existing key/value in
  // this response is unchanged (see the contract test for a before/after key
  // diff). Days with no quiz activity are simply absent from the array — the
  // LineChart's emptyLabel handles the fully-empty case, and the frontend
  // renders only the days present rather than fabricating zero-score days.
  const trendMap = new Map<string, number[]>();
  for (const q of quizzes) {
    const day = (q.created_at || '').slice(0, 10); // YYYY-MM-DD
    if (!day) continue;
    if (!trendMap.has(day)) trendMap.set(day, []);
    trendMap.get(day)!.push(q.score_percent || 0);
  }
  const score_trend = Array.from(trendMap.entries())
    .map(([date, scores]) => ({
      date,
      avg_score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return ok({
    total_quizzes: quizzes.length,
    avg_score: avgScore,
    active_students: activeStudents,
    total_students: totalStudents,
    completion_rate: completionRate,
    trend_vs_last_week: trend,
    subject_performance,
    grade_performance,
    // NEW (additive, optional) — see comment above.
    score_trend,
    // NEW (Task 3.2, additive) — true when the underlying quiz_sessions read
    // hit SCHOOL_WIDE_QUIZ_ROW_CAP and was trimmed; the aggregates above are
    // then computed over a partial (capped) dataset rather than the full
    // window.
    truncated,
  });
}

// ── Class Performance ───────────────────────────────────────
async function classPerformance(schoolId: string, params: URLSearchParams) {
  const classId = params.get('class_id');
  if (!classId) return NextResponse.json({ success: false, error: 'class_id required' }, { status: 400 });

  const supabase = getSupabaseAdmin();

  // Verify class belongs to school
  const { data: cls } = await supabase
    .from('classes')
    .select('id, name, grade, section')
    .eq('id', classId)
    .eq('school_id', schoolId)
    .single();

  if (!cls) return NextResponse.json({ success: false, error: 'Class not found' }, { status: 404 });

  // Get enrolled students
  const { data: enrollments } = await supabase
    .from('class_enrollments')
    .select('student_id')
    .eq('class_id', classId)
    .eq('is_active', true);

  const studentIds = (enrollments || []).map(e => e.student_id);
  if (studentIds.length === 0) {
    return ok({
      class_info: cls,
      enrolled_count: 0,
      avg_score: 0,
      class_avg_score: 0,
      top_students: [],
      bottom_students: [],
      subject_breakdown: [],
      completion_rate: 0,
      truncated: false,
    });
  }

  // Get quiz data for enrolled students
  // Task 3.2: capped at CLASS_QUIZ_ROW_CAP+1 (fetch one extra row to detect
  // truncation without a separate count query; trimmed below).
  const { data: quizzes } = await supabase
    .from('quiz_sessions')
    .select('student_id, subject, score_percent')
    .in('student_id', studentIds)
    .eq('school_id', schoolId)
    .limit(CLASS_QUIZ_ROW_CAP + 1);

  const fetchedQuizzes = quizzes || [];
  const truncated = fetchedQuizzes.length > CLASS_QUIZ_ROW_CAP;
  const allQuizzes = truncated ? fetchedQuizzes.slice(0, CLASS_QUIZ_ROW_CAP) : fetchedQuizzes;

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

  return ok({
    class_info: cls,
    enrolled_count: studentIds.length,
    avg_score: overallAvg,
    // `class_avg_score` is the field the reports page's class-performance stat
    // card reads; `avg_score` retained for any other consumer / backward compat.
    class_avg_score: overallAvg,
    completion_rate: Math.round((quizTakers.size / studentIds.length) * 100),
    top_students: enriched.slice(0, 5),
    bottom_students: enriched.slice(-5).reverse(),
    subject_breakdown,
    // NEW (Task 3.2, additive) — see CLASS_QUIZ_ROW_CAP comment above.
    truncated,
  });
}

// ── Student Detail ──────────────────────────────────────────
async function studentDetail(schoolId: string, params: URLSearchParams) {
  const studentId = params.get('student_id');
  if (!studentId) return NextResponse.json({ success: false, error: 'student_id required' }, { status: 400 });

  const supabase = getSupabaseAdmin();

  // Verify student belongs to school
  const { data: student } = await supabase
    .from('students')
    .select('id, name, grade, xp_total, last_active, subscription_plan')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .single();

  if (!student) return NextResponse.json({ success: false, error: 'Student not found in your school' }, { status: 404 });

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

  return ok({
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

// ── Student Search ──────────────────────────────────────────
// Powers the student-detail tab's drill-in autocomplete. The page sends
// `?type=student_search&query=<2+ chars>` and reads `json.data` as an array of
// { id, name, grade, xp_total, last_active }. Scoped to active students in the
// caller's school (P8 boundary via authorizeSchoolAdmin's schoolId).
async function studentSearch(schoolId: string, params: URLSearchParams) {
  const query = (params.get('query') || params.get('q') || '').trim();
  if (query.length < 2) {
    return ok([]);
  }

  const supabase = getSupabaseAdmin();
  const { data: students } = await supabase
    .from('students')
    .select('id, name, grade, xp_total, last_active')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .ilike('name', `%${query}%`)
    .order('name', { ascending: true })
    .limit(20);

  const results = (students || []).map(s => ({
    id: s.id,
    name: s.name,
    grade: s.grade, // P5: string
    xp_total: s.xp_total ?? 0,
    last_active: s.last_active ?? null,
  }));

  return ok(results);
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
      return ok({ grade, gaps: [], truncated: false });
    }
    query = query.in('student_id', studentIds);
  }

  // Task 3.2: capped at SCHOOL_WIDE_QUIZ_ROW_CAP+1 (fetch one extra row to
  // detect truncation without a separate count query; trimmed below).
  const { data: quizzes } = await query.limit(SCHOOL_WIDE_QUIZ_ROW_CAP + 1);
  const fetchedQuizzes = quizzes || [];
  const truncated = fetchedQuizzes.length > SCHOOL_WIDE_QUIZ_ROW_CAP;
  const allQuizzes = truncated ? fetchedQuizzes.slice(0, SCHOOL_WIDE_QUIZ_ROW_CAP) : fetchedQuizzes;

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

  // NEW (Task 3.2, additive) — see SCHOOL_WIDE_QUIZ_ROW_CAP comment above.
  return ok({ grade: grade || 'all', gaps, truncated });
}
