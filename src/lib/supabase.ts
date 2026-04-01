import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Lazy-init: avoid throwing during Next.js static page generation (build time)
// where env vars may not yet be available.
let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  _supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
  return _supabase;
}

// Proxy that lazily initializes on first property access
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabase();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

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

  const [profilesResult, masteredResult, inProgressResult, quizzesResult] = await Promise.all([
    supabase.from('student_learning_profiles').select('*').eq('student_id', studentId),
    supabase.from('concept_mastery').select('*', { count: 'exact', head: true }).eq('student_id', studentId).gte('mastery_probability', 0.95),
    supabase.from('concept_mastery').select('*', { count: 'exact', head: true }).eq('student_id', studentId).lt('mastery_probability', 0.95).gt('mastery_probability', 0),
    supabase.from('quiz_sessions').select('*', { count: 'exact', head: true }).eq('student_id', studentId),
  ]);
  const p = profilesResult.data ?? [];
  const totalXp = p.reduce((a, r) => a + (r.xp ?? 0), 0);
  const streak = Math.max(...p.map((r) => r.streak_days ?? 0), 0);
  const totalCorrect = p.reduce((a, r) => a + (r.total_questions_answered_correctly ?? 0), 0);
  const totalAsked = p.reduce((a, r) => a + (r.total_questions_asked ?? 0), 0);
  const mastered = masteredResult.count;
  const inProgress = inProgressResult.count;
  const quizzes = quizzesResult.count;

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

/* ── Feature flags ──
 * Loads flags with scoping awareness.
 *
 * Precedence (from feature-flags.ts):
 * 1. Flag must exist and be globally enabled (is_enabled = true)
 * 2. If target_environments is set, current env must match
 * 3. If target_roles is set, user role must match
 * 4. If target_institutions is set, user school must match
 * 5. If all scoping passes (or is empty = global), flag is ON
 *
 * Client-side: evaluates with available context (role from AuthContext).
 * Server-side: use isFeatureEnabled() from lib/feature-flags.ts directly.
 */
export async function getFeatureFlags(context?: { role?: string; institutionId?: string }) {
  const { data, error } = await supabase.from('feature_flags')
    .select('flag_name, is_enabled, target_roles, target_environments, target_institutions');
  if (error) console.error('getFeatureFlags:', error.message);

  const env = typeof window === 'undefined'
    ? (process.env.VERCEL_ENV || process.env.NODE_ENV || 'production')
    : 'production'; // Client assumes production

  const flags: Record<string, boolean> = {};
  (data ?? []).forEach((f: { flag_name: string; is_enabled: boolean; target_roles: string[] | null; target_environments: string[] | null; target_institutions: string[] | null }) => {
    let enabled = f.is_enabled;

    // Environment scoping
    if (enabled && f.target_environments && f.target_environments.length > 0) {
      if (!f.target_environments.includes(env)) enabled = false;
    }
    // Role scoping
    if (enabled && f.target_roles && f.target_roles.length > 0) {
      if (!context?.role || !f.target_roles.includes(context.role)) enabled = false;
    }
    // Institution scoping
    if (enabled && f.target_institutions && f.target_institutions.length > 0) {
      if (!context?.institutionId || !f.target_institutions.includes(context.institutionId)) enabled = false;
    }

    flags[f.flag_name] = enabled;
  });
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
    // Get the current user's JWT for authenticated edge function calls
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || supabaseAnonKey;

    const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/foxy-tutor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: params.message, session_id: params.session_id, subject: params.subject, grade: params.grade, language: params.language, mode: params.mode }),
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

export async function getQuizQuestions(subject: string, grade: string, count = 10, difficulty?: number | null, chapterNumber?: number | null) {
  // Try RPC first, fall back to direct query
  const params: Record<string, unknown> = { p_subject: subject, p_grade: grade, p_count: count };
  if (difficulty != null) params.p_difficulty = difficulty;
  if (chapterNumber != null) params.p_chapter_number = chapterNumber;
  try {
    const { data, error } = await supabase.rpc('get_quiz_questions', params);
    if (!error && data) return validateQuestions(data);
  } catch { /* RPC may not exist — fall back */ }

  // Direct table query fallback
  let query = supabase.from('question_bank')
    .select('id, question_text, question_hi, question_type, options, correct_answer_index, explanation, explanation_hi, hint, difficulty, bloom_level, chapter_number')
    .eq('subject', subject)
    .eq('grade', grade)
    .eq('is_active', true)
    .limit(Math.min(count * 2, 60)); // fetch extra to account for filtered-out bad questions
  if (difficulty != null) query = query.eq('difficulty', difficulty);
  if (chapterNumber != null) query = query.eq('chapter_number', chapterNumber);
  const { data, error } = await query;
  if (error) throw error;
  // Validate, deduplicate, shuffle, and trim to requested count
  return validateQuestions(data ?? []).sort(() => Math.random() - 0.5).slice(0, count);
}

/** Filter out broken, duplicate, or template questions before they reach students. */
interface QuestionRecord {
  id: string;
  question_text: string;
  question_hi: string | null;
  question_type: string;
  options: string | string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  hint: string | null;
  difficulty: number;
  bloom_level: string;
  chapter_number: number;
  [key: string]: unknown;
}

function validateQuestions(questions: QuestionRecord[]): QuestionRecord[] {
  const seen = new Set<string>();
  return questions.filter(q => {
    if (!q.question_text || typeof q.question_text !== 'string') return false;
    if (q.question_text.length < 15) return false;

    const opts = Array.isArray(q.options) ? q.options : [];
    if (opts.length !== 4) return false;
    if (q.correct_answer_index < 0 || q.correct_answer_index > 3) return false;

    // Reject template/garbage questions
    const text = q.question_text.toLowerCase();
    if (text.includes('unrelated topic')) return false;
    if (text.startsWith('a student studying') && text.includes('should focus on')) return false;
    if (text.startsWith('which of the following best describes the main topic')) return false;
    if (text.startsWith('why is') && text.includes('important for grade')) return false;
    if (text.startsWith('the chapter') && text.includes('most closely related to which area')) return false;
    if (text.startsWith('what is the primary purpose of studying')) return false;

    // Reject garbage options
    const optTexts = opts.map((o: string) => (o || '').toLowerCase().trim());
    if (optTexts.some((o: string) =>
      o.includes('unrelated topic') || o.includes('physical education') ||
      o.includes('art and craft') || o.includes('music theory') ||
      o.includes('it is not important') || o.includes('no board exam')
    )) return false;

    // Reject if fewer than 3 distinct options
    if (new Set(optTexts).size < 3) return false;

    // Reject self-contradicting or unreliable explanations
    if (q.explanation) {
      const expl = q.explanation.toLowerCase();
      if (expl.includes('does not match any option') ||
          expl.includes('suggesting a possible error') ||
          expl.includes('assuming a typo') ||
          expl.includes('not listed') ||
          expl.includes('however, the correct') ||
          expl.includes('this is incorrect') ||
          expl.includes('none of the options') ||
          expl.includes('there seems to be') ||
          expl.includes('closest plausible')) return false;
    }

    // Reject very short or missing explanations
    if (!q.explanation || q.explanation.length < 20) return false;

    // Reject explanations that are just restating the question
    if (q.explanation && q.question_text) {
      const explWords = q.explanation.toLowerCase().split(/\s+/);
      const qWords = q.question_text.toLowerCase().split(/\s+/);
      if (explWords.length < 8) return false; // too terse to be educational
    }

    // Deduplicate
    const key = q.question_text.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);

    return true;
  });
}

export async function submitQuizResults(studentId: string, subject: string, grade: string, topic: string, chapter: number, responses: import('./types').QuizResponse[], time: number) {
  // Try RPC first
  try {
    const { data, error } = await supabase.rpc('submit_quiz_results', {
      p_student_id: studentId, p_subject: subject, p_grade: grade,
      p_topic: topic, p_chapter: chapter, p_responses: responses, p_time: time,
    });
    if (!error && data) return data;
    console.warn('submit_quiz_results RPC failed, using fallback:', error?.message);
  } catch (e) {
    console.warn('submit_quiz_results RPC error, using fallback:', e);
  }

  // ── Robust client-side fallback ──
  // Uses atomic RPC for XP/profile updates to prevent race conditions
  // when multiple quiz submissions happen concurrently.
  const total = responses.length;
  const correct = responses.filter(r => r.is_correct).length;
  const scorePct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const xpEarned = correct * 10 + (scorePct >= 80 ? 20 : 0) + (scorePct === 100 ? 50 : 0);

  // 1. Insert quiz session (columns must match DB schema exactly)
  const { data: session, error: sessErr } = await supabase.from('quiz_sessions').insert({
    student_id: studentId, subject, grade, total_questions: total,
    correct_answers: correct, wrong_answers: total - correct,
    score_percent: scorePct, score: xpEarned,
    time_taken_seconds: time, total_answered: total,
    is_completed: true, completed_at: new Date().toISOString(),
  }).select('id').single();
  if (sessErr) console.error('Fallback: quiz_sessions insert failed:', sessErr.message);

  // 2. Atomically update learning profile and student XP via RPC
  // This avoids the read-modify-write race condition where concurrent
  // quiz submissions could lose XP or corrupt counters.
  try {
    await supabase.rpc('atomic_quiz_profile_update', {
      p_student_id: studentId,
      p_subject: subject,
      p_xp: xpEarned,
      p_total: total,
      p_correct: correct,
      p_time_seconds: time,
    });
  } catch (atomicErr) {
    console.warn('atomic_quiz_profile_update failed, using non-atomic fallback:', atomicErr);
    // Last-resort fallback: upsert with ON CONFLICT if the RPC doesn't exist
    await supabase.from('student_learning_profiles').upsert({
      student_id: studentId, subject, xp: xpEarned,
      total_sessions: 1, total_questions_asked: total,
      total_questions_answered_correctly: correct,
      total_time_minutes: Math.max(1, Math.round(time / 60)),
      last_session_at: new Date().toISOString(),
      streak_days: 1, level: 1, current_level: 'beginner',
    }, { onConflict: 'student_id,subject' });
  }

  return {
    session_id: session?.id ?? '',
    total, correct, score_percent: scorePct, xp_earned: xpEarned,
  };
}

export async function getLeaderboard(period = 'weekly', limit = 20) {
  try {
    const { data, error } = await supabase.rpc('get_leaderboard', { p_period: period, p_limit: limit });
    if (!error && data) return data;
  } catch { /* RPC may not exist */ }

  // Fallback: direct query
  const since = new Date();
  since.setDate(since.getDate() - (period === 'monthly' ? 30 : 7));
  const { data } = await supabase.from('students')
    .select('id, name, xp_total, streak_days, avatar_url, grade, school_name, city, board')
    .eq('is_active', true)
    .gte('last_active', since.toISOString())
    .order('xp_total', { ascending: false })
    .limit(limit);
  return (data ?? []).map((s, i) => ({
    rank: i + 1, student_id: s.id, name: s.name,
    total_xp: s.xp_total ?? 0, streak: s.streak_days ?? 0,
    avatar_url: s.avatar_url, grade: s.grade,
    school: s.school_name, city: s.city, board: s.board,
  }));
}

export async function getStudyPlan(studentId: string) {
  try {
    const { data, error } = await supabase.rpc('get_study_plan', { p_student_id: studentId });
    if (!error && data) return data;
  } catch { /* RPC may not exist */ }

  // Fallback: direct query
  const { data: plan } = await supabase.from('study_plans')
    .select('*')
    .eq('student_id', studentId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!plan) return { has_plan: false };

  const { data: tasks } = await supabase.from('study_plan_tasks')
    .select('*')
    .eq('plan_id', plan.id)
    .order('day_number')
    .order('task_order');

  return { has_plan: true, plan, tasks: tasks ?? [] };
}

export async function getReviewCards(studentId: string, limit = 10) {
  try {
    const { data, error } = await supabase.rpc('get_review_cards', { p_student_id: studentId, p_limit: limit });
    if (!error && data) return data;
  } catch { /* RPC may not exist */ }

  // Fallback: use spaced_repetition_cards if available, else concept_mastery
  const today = new Date().toISOString().split('T')[0]; // next_review_date is DATE type
  const { data: cards } = await supabase.from('spaced_repetition_cards')
    .select('id, student_id, subject, topic, chapter_title, front_text, back_text, hint, ease_factor, interval_days, streak, repetition_count, total_reviews, correct_reviews, next_review_date')
    .eq('student_id', studentId)
    .lte('next_review_date', today)
    .order('next_review_date')
    .limit(limit);
  if (cards && cards.length > 0) {
    return cards.map(c => ({ ...c, topic: c.topic, chapter_title: c.chapter_title || c.topic }));
  }
  // Final fallback: concept_mastery (limited columns)
  const { data } = await supabase.from('concept_mastery')
    .select('id, topic_id, ease_factor, mastery_probability, consecutive_correct, next_review_at')
    .eq('student_id', studentId)
    .lte('next_review_at', new Date().toISOString())
    .order('next_review_at')
    .limit(limit);
  return (data ?? []).map(cm => ({ ...cm, topic: cm.topic_id, front_text: '', back_text: '' }));
}

export const sendToFoxy = chatWithFoxy;

/* ── CME Engine: get next learning action ── */
export async function getCmeNextAction(
  studentId: string,
  subject: string,
  grade: string
): Promise<import('./types').CmeAction | null> {
  try {
    // Resolve subject code → subject_id (UUID)
    const { data: subjectRow } = await supabase
      .from('subjects')
      .select('id')
      .eq('code', subject)
      .single();
    if (!subjectRow) return null;

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || supabaseAnonKey;

    const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/cme-engine`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: 'get_next_action',
        subject_id: subjectRow.id,
      }),
    }, 8000); // 8s timeout — best-effort, non-blocking

    if (!res.ok) return null;
    const data = await res.json();
    if (data.error || !data.type) return null;
    return data as import('./types').CmeAction;
  } catch {
    // Silently fail — CME is best-effort enhancement
    return null;
  }
}


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
  try {
    const { data, error } = await supabase.rpc('get_student_notifications', { p_student_id: studentId, p_limit: limit });
    if (!error && data) return data;
  } catch { /* RPC may not exist */ }
  return { unread_count: 0, notifications: [] };
}

export async function generateNotifications(studentId: string) {
  try {
    const { data, error } = await supabase.rpc('generate_student_notifications', { p_student_id: studentId });
    if (!error) return data;
  } catch { /* RPC may not exist */ }
  return null;
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
  quiz_session_id?: string;
  questions_in_zpd?: number;
  questions_too_easy?: number;
  questions_too_hard?: number;
  zpd_accuracy_rate?: number;
  fatigue_detected?: boolean;
  difficulty_adjustments?: number;
  avg_response_time_seconds?: number;
  interleaved_questions?: number;
  blocked_questions?: number;
  session_start?: string;
  session_end?: string;
}) {
  const { error } = await supabase.from('cognitive_session_metrics').insert(metrics);
  if (error) console.error('saveCognitiveMetrics:', error.message);
}

/* ── Question Responses (detailed per-question tracking) ── */
export async function saveQuestionResponses(responses: Array<{
  student_id: string;
  question_id: string;
  quiz_session_id?: string;
  selected_answer?: string;
  is_correct: boolean;
  response_time_seconds: number;
  bloom_level_attempted: string;
  was_in_zpd?: boolean;
  cognitive_load_experienced?: string;
  reflection_prompt?: string;
  reflection_response?: string;
  reflection_quality?: number;
  error_type?: string;
  misconception_detected?: string;
  quality?: number;
  interleaved?: boolean;
}>) {
  const { error } = await supabase.from('question_responses').insert(responses);
  if (error) console.error('saveQuestionResponses:', error.message);
}

/* ── Update Bloom Progression ── */
export async function upsertBloomProgression(data: {
  student_id: string;
  concept_id: string;
  subject: string;
  current_bloom_level?: string;
  zpd_bloom_level?: string;
  remember_mastery?: number;
  understand_mastery?: number;
  apply_mastery?: number;
  analyze_mastery?: number;
  evaluate_mastery?: number;
  create_mastery?: number;
}) {
  const { error } = await supabase.from('bloom_progression').upsert(
    { ...data, last_practiced_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'student_id,concept_id' },
  );
  if (error) console.error('upsertBloomProgression:', error.message);
}

// ─── Topic Diagrams ──────────────────────────────────────

export async function getTopicDiagrams(subject: string, grade: string, chapterNumber: number) {
  const g = grade.startsWith('Grade') ? grade : `Grade ${grade}`;
  const { data, error } = await supabase
    .from('topic_diagrams')
    .select('id, image_url, caption, caption_hi, alt_text, diagram_type, display_order, topic')
    .eq('subject', subject)
    .eq('grade', g)
    .eq('chapter_number', chapterNumber)
    .eq('is_active', true)
    .order('display_order');
  if (error) console.error('getTopicDiagrams:', error.message);
  return data ?? [];
}
