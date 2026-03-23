import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (typeof window !== 'undefined' && (!supabaseUrl || !supabaseAnonKey)) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);

/* ── Timeout wrapper for fetch calls ── */
function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

/* ── Student snapshot (used by AuthContext) ── */
export async function getStudentSnapshot(studentId: string) {
  try {
    const { data, error } = await supabase.rpc('get_student_snapshot', { p_student_id: studentId });
    if (!error && data) return data as import('./types').StudentSnapshot;
  } catch { /* RPC may not exist — fall back */ }

  const { data: profiles } = await supabase.from('student_learning_profiles').select('*').eq('student_id', studentId);
  const p = profiles ?? [];
  const totalXp = p.reduce((a, r) => a + (r.xp ?? 0), 0);
  const streak = Math.max(...p.map((r) => r.streak_days ?? 0), 0);
  const totalCorrect = p.reduce((a, r) => a + (r.total_questions_answered_correctly ?? 0), 0);
  const totalAsked = p.reduce((a, r) => a + (r.total_questions_asked ?? 0), 0);
  const { count: mastered } = await supabase.from('concept_mastery').select('*', { count: 'exact', head: true }).eq('student_id', studentId).gte('mastery_level', 0.95);
  const { count: inProgress } = await supabase.from('concept_mastery').select('*', { count: 'exact', head: true }).eq('student_id', studentId).lt('mastery_level', 0.95).gt('mastery_level', 0);
  const { count: quizzes } = await supabase.from('quiz_sessions').select('*', { count: 'exact', head: true }).eq('student_id', studentId);

  return {
    total_xp: totalXp, current_streak: streak, topics_mastered: mastered ?? 0,
    topics_in_progress: inProgress ?? 0, quizzes_taken: quizzes ?? 0,
    avg_score: totalAsked > 0 ? Math.round((totalCorrect / totalAsked) * 100) : 0,
  } satisfies import('./types').StudentSnapshot;
}

/* ── Student learning profiles ── */
export async function getStudentProfiles(studentId: string) {
  const { data, error } = await supabase.from('student_learning_profiles').select('*').eq('student_id', studentId).order('xp', { ascending: false });
  if (error) console.error('getStudentProfiles:', error.message);
  return data ?? [];
}

/* ── Subjects list ── */
export async function getSubjects() {
  const { data, error } = await supabase.from('subjects').select('*').eq('is_active', true).order('display_order');
  if (error) console.error('getSubjects:', error.message);
  return data ?? [];
}

/* ── Feature flags ── */
export async function getFeatureFlags() {
  const { data, error } = await supabase.from('feature_flags').select('flag_name, is_enabled');
  if (error) console.error('getFeatureFlags:', error.message);
  const flags: Record<string, boolean> = {};
  (data ?? []).forEach((f) => { flags[f.flag_name] = f.is_enabled; });
  return flags;
}

/* ── Next topics to learn ── */
export async function getNextTopics(studentId: string, subject: string | null | undefined, grade: string) {
  let query = supabase.from('curriculum_topics').select('*').eq('is_active', true).eq('grade', grade).order('display_order').limit(10);
  if (subject) {
    const { data: subjectRow } = await supabase.from('subjects').select('id').eq('code', subject).single();
    if (subjectRow) query = query.eq('subject_id', subjectRow.id);
  }
  const { data, error } = await query;
  if (error) console.error('getNextTopics:', error.message);
  return data ?? [];
}

/* ── Foxy AI tutor chat ── */
export async function chatWithFoxy(params: { message: string; student_id: string; session_id?: string; subject?: string; grade: string; language: string; mode: string; }) {
  try {
    const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/foxy-tutor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseAnonKey}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: params.message }], student_id: params.student_id, session_id: params.session_id, subject: params.subject, grade: params.grade, language: params.language, mode: params.mode }),
    }, 30000); // 30s timeout for AI responses
    if (!res.ok) throw new Error(`Foxy error: ${res.status}`);
    const data = await res.json();
    return { reply: data.text ?? data.reply ?? 'Foxy had a hiccup! Try again.', session_id: data.session_id ?? params.session_id ?? '' };
  } catch (e) {
    console.error('chatWithFoxy:', e);
    const msg = e instanceof DOMException && e.name === 'AbortError'
      ? 'Request timed out — please try again.'
      : 'Connection issue — please try again.';
    return { reply: msg, session_id: params.session_id ?? '' };
  }
}

/* ── RPC helpers (existing) ── */
export async function getDashboardData(studentId: string) {
  const { data, error } = await supabase.rpc('get_dashboard_data', { p_student_id: studentId });
  if (error) throw error;
  return data;
}

export async function getQuizQuestions(subject: string, grade: string, count = 10, difficulty?: number | null) {
  const params: Record<string, unknown> = { p_subject: subject, p_grade: grade, p_count: count };
  if (difficulty != null) params.p_difficulty = difficulty;
  const { data, error } = await supabase.rpc('get_quiz_questions', params);
  if (error) throw error;
  return data;
}

export async function submitQuizResults(studentId: string, subject: string, grade: string, topic: string, chapter: number, responses: import('./types').QuizResponse[], time: number) {
  const { data, error } = await supabase.rpc('submit_quiz_results', { p_student_id: studentId, p_subject: subject, p_grade: grade, p_topic: topic, p_chapter: chapter, p_responses: responses, p_time: time });
  if (error) throw error;
  return data;
}

export async function getLeaderboard(period = 'weekly', limit = 20) {
  const { data, error } = await supabase.rpc('get_leaderboard', { p_period: period, p_limit: limit });
  if (error) throw error;
  return data;
}

export async function getStudyPlan(studentId: string) {
  const { data, error } = await supabase.rpc('get_study_plan', { p_student_id: studentId });
  if (error) throw error;
  return data;
}

export async function getReviewCards(studentId: string, limit = 10) {
  const { data, error } = await supabase.rpc('get_review_cards', { p_student_id: studentId, p_limit: limit });
  if (error) throw error;
  return data;
}

export const sendToFoxy = chatWithFoxy;


/* ═══ ROLE & CLASS RPCs ═══ */

export async function getUserRole(authUserId: string) {
  const { data, error } = await supabase.rpc('get_user_role', { p_auth_user_id: authUserId });
  if (error) console.error('getUserRole:', error.message);
  return data;
}

export async function getTeacherDashboard(teacherId: string) {
  const { data, error } = await supabase.rpc('get_teacher_dashboard', { p_teacher_id: teacherId });
  if (error) console.error('getTeacherDashboard:', error.message);
  return data;
}

export async function getClassDetail(classId: string) {
  const { data, error } = await supabase.rpc('get_class_detail', { p_class_id: classId });
  if (error) console.error('getClassDetail:', error.message);
  return data;
}

export async function teacherCreateClass(teacherId: string, name: string, grade: string, section?: string, subject?: string) {
  const { data, error } = await supabase.rpc('teacher_create_class', { p_teacher_id: teacherId, p_name: name, p_grade: grade, p_section: section ?? null, p_subject: subject ?? null });
  if (error) throw error;
  return data;
}

export async function teacherCreateAssignment(teacherId: string, classId: string, title: string, type = 'practice', topicId?: string, subject?: string, dueDate?: string, questionCount = 10) {
  const { data, error } = await supabase.rpc('teacher_create_assignment', { p_teacher_id: teacherId, p_class_id: classId, p_title: title, p_type: type, p_topic_id: topicId ?? null, p_subject: subject ?? null, p_due_date: dueDate ?? null, p_question_count: questionCount });
  if (error) throw error;
  return data;
}

export async function getAssignmentReport(assignmentId: string) {
  const { data, error } = await supabase.rpc('get_assignment_report', { p_assignment_id: assignmentId });
  if (error) console.error('getAssignmentReport:', error.message);
  return data;
}

export async function getGuardianDashboard(guardianId: string) {
  const { data, error } = await supabase.rpc('get_guardian_dashboard', { p_guardian_id: guardianId });
  if (error) console.error('getGuardianDashboard:', error.message);
  return data;
}

export async function studentJoinClass(studentId: string, classCode: string) {
  const { data, error } = await supabase.rpc('student_join_class', { p_student_id: studentId, p_class_code: classCode });
  if (error) throw error;
  return data;
}

export async function getUnreadNotifications(recipientType: string, recipientId: string) {
  const { data, error } = await supabase.rpc('get_unread_notifications', { p_recipient_type: recipientType, p_recipient_id: recipientId });
  if (error) console.error('getUnreadNotifications:', error.message);
  return data;
}

export async function markNotificationRead(notificationId: string) {
  const { error } = await supabase.rpc('mark_notification_read', { p_notification_id: notificationId });
  if (error) console.error('markNotificationRead:', error.message);
}

export async function getCurriculumBrowser(grade: string, subject?: string) {
  const { data, error } = await supabase.rpc('get_curriculum_browser', { p_grade: grade, p_subject: subject ?? null });
  if (error) console.error('getCurriculumBrowser:', error.message);
  return data;
}

export async function getMasteryOverview(studentId: string, subject?: string) {
  const { data, error } = await supabase.rpc('get_mastery_overview', { p_student_id: studentId, p_subject: subject ?? null });
  if (error) console.error('getMasteryOverview:', error.message);
  return data;
}

export async function recordLearningEvent(studentId: string, topicId: string, isCorrect: boolean, interactionType = 'practice', bloomLevel?: string) {
  const { data, error } = await supabase.rpc('record_learning_event', { p_student_id: studentId, p_topic_id: topicId, p_is_correct: isCorrect, p_interaction_type: interactionType, p_bloom_level: bloomLevel ?? null });
  if (error) console.error('recordLearningEvent:', error.message);
  return data;
}

/* ── Generate Study Plan (AI weekly plan) ── */
export async function generateStudyPlan(studentId: string, subject?: string, dailyMinutes = 60, days = 7) {
  const { data, error } = await supabase.rpc('generate_weekly_study_plan', {
    p_student_id: studentId,
    p_subject: subject || null,
    p_daily_minutes: dailyMinutes,
    p_days: days,
  });
  if (error) throw error;
  return data;
}

/* ── Competitions & Olympiads ── */
export async function getCompetitions(studentId: string, status?: string) {
  const { data, error } = await supabase.rpc('get_competitions', { p_student_id: studentId, p_status: status || null });
  if (error) console.error('getCompetitions:', error.message);
  return data ?? [];
}

export async function joinCompetition(studentId: string, competitionId: string) {
  const { data, error } = await supabase.rpc('join_competition', { p_student_id: studentId, p_competition_id: competitionId });
  if (error) throw error;
  return data;
}

export async function getCompetitionLeaderboard(competitionId: string, limit = 50) {
  const { data, error } = await supabase.rpc('get_competition_leaderboard', { p_competition_id: competitionId, p_limit: limit });
  if (error) console.error('getCompetitionLeaderboard:', error.message);
  return data ?? [];
}

export async function getHallOfFame(limit = 30) {
  const { data, error } = await supabase.rpc('get_hall_of_fame', { p_limit: limit });
  if (error) console.error('getHallOfFame:', error.message);
  return data ?? [];
}

/* ── Notifications (Duolingo-style) ── */
export async function getStudentNotifications(studentId: string, limit = 30) {
  const { data, error } = await supabase.rpc('get_student_notifications', { p_student_id: studentId, p_limit: limit });
  if (error) console.error('getStudentNotifications:', error.message);
  return data;
}

export async function generateNotifications(studentId: string) {
  const { data, error } = await supabase.rpc('generate_student_notifications', { p_student_id: studentId });
  if (error) console.error('generateNotifications:', error.message);
  return data;
}

export async function markAllNotificationsRead(studentId: string) {
  const { error } = await supabase.rpc('mark_all_notifications_read', { p_student_id: studentId });
  if (error) console.error('markAllNotificationsRead:', error.message);
}

/* ── RBAC: Guardian-Student linking ── */
export async function linkGuardianToStudent(guardianId: string, inviteCode: string) {
  const { data, error } = await supabase.rpc('link_guardian_to_student_via_code', {
    p_guardian_id: guardianId,
    p_invite_code: inviteCode,
  });
  if (error) throw error;
  return data;
}


/* ═══ ALFANUMRIK 2.0: COGNITIVE ENGINE APIs ═══ */

/* ── Board Exam Questions ── */
export async function getBoardExamQuestions(subject: string, grade: string, year?: number, count = 20) {
  const params: Record<string, unknown> = { p_subject: subject, p_grade: grade, p_count: count };
  if (year != null) params.p_year = year;
  const { data, error } = await supabase.rpc('get_board_exam_questions', params);
  if (error) throw error;
  return data;
}

/* ── CBSE Board Papers list ── */
export async function getBoardPapers(subject?: string) {
  let query = supabase.from('cbse_board_papers').select('*').eq('is_active', true).order('year', { ascending: false });
  if (subject) query = query.eq('subject', subject);
  const { data, error } = await query;
  if (error) console.error('getBoardPapers:', error.message);
  return data ?? [];
}

/* ── Bloom's Progression ── */
export async function getBloomProgression(studentId: string, subject?: string) {
  const params: Record<string, unknown> = { p_student_id: studentId };
  if (subject) params.p_subject = subject;
  const { data, error } = await supabase.rpc('get_bloom_progression', params);
  if (error) console.error('getBloomProgression:', error.message);
  return data ?? [];
}

/* ── Knowledge Gaps ── */
export async function getKnowledgeGaps(studentId: string, subject?: string, limit = 10) {
  const params: Record<string, unknown> = { p_student_id: studentId, p_limit: limit };
  if (subject) params.p_subject = subject;
  const { data, error } = await supabase.rpc('get_knowledge_gaps', params);
  if (error) console.error('getKnowledgeGaps:', error.message);
  return data ?? [];
}

/* ── Learning Velocity ── */
export async function getLearningVelocity(studentId: string, subject?: string) {
  let query = supabase.from('learning_velocity').select('*').eq('student_id', studentId);
  if (subject) query = query.eq('subject', subject);
  const { data, error } = await query.order('updated_at', { ascending: false }).limit(20);
  if (error) console.error('getLearningVelocity:', error.message);
  return data ?? [];
}

/* ── Cognitive Session Metrics ── */
export async function saveCognitiveMetrics(metrics: {
  student_id: string;
  session_id?: string;
  zpd_target?: number;
  zpd_actual?: number;
  bloom_distribution?: Record<string, number>;
  interleaving_ratio?: number;
  fatigue_detected?: boolean;
  difficulty_adjustments?: number;
  consecutive_errors?: number;
  consecutive_correct?: number;
  avg_response_time?: number;
  session_duration?: number;
  questions_attempted?: number;
}) {
  const { error } = await supabase.from('cognitive_session_metrics').insert(metrics);
  if (error) console.error('saveCognitiveMetrics:', error.message);
}

/* ── Question Responses (detailed per-question tracking) ── */
export async function saveQuestionResponses(responses: Array<{
  student_id: string;
  question_id: string;
  session_id?: string;
  selected_option: number;
  is_correct: boolean;
  time_spent?: number;
  bloom_level?: string;
  difficulty?: number;
  source?: string;
  board_year?: number;
  reflection_shown?: boolean;
  reflection_type?: string;
}>) {
  const { error } = await supabase.from('question_responses').insert(responses);
  if (error) console.error('saveQuestionResponses:', error.message);
}

/* ── Update Bloom Progression ── */
export async function upsertBloomProgression(data: {
  student_id: string;
  topic_id: string;
  bloom_level: string;
  attempts: number;
  correct: number;
  mastery: number;
}) {
  const { error } = await supabase.from('bloom_progression').upsert(data, {
    onConflict: 'student_id,topic_id,bloom_level',
  });
  if (error) console.error('upsertBloomProgression:', error.message);
}
