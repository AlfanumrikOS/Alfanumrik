import { createClient } from '@supabase/supabase-js';

// ─── Client ───────────────────────────────────────────────────────────────────
const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? 'https://placeholder.supabase.co';
const key  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// ─── Edge Function URLs ────────────────────────────────────────────────────────
export const EDGE = {
  foxyTutor:        `${url}/functions/v1/foxy-tutor`,
  quizEngine:       `${url}/functions/v1/quiz-engine`,
  quizSubmit:       `${url}/functions/v1/quiz-submit`,
  ragEngine:        `${url}/functions/v1/rag-engine`,
  chatHistory:      `${url}/functions/v1/chat-history`,
  studentExp:       `${url}/functions/v1/student-experience`,
  studyPlan:        `${url}/functions/v1/study-plan`,
  studentNotes:     `${url}/functions/v1/student-notes`,
} as const;

// ─── Auth helpers ──────────────────────────────────────────────────────────────
export async function signInWithOTP(email: string) {
  return supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
}
export async function signOut() {
  return supabase.auth.signOut();
}
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

// ─── Student ──────────────────────────────────────────────────────────────────
export async function getOrCreateStudent(authUserId: string, name: string, grade: string) {
  const { data, error } = await supabase.rpc('get_or_create_student' as any, {
    p_auth_user_id: authUserId, p_name: name, p_grade: grade
  });
  if (error) console.error('getOrCreateStudent:', error);
  return data;
}

export async function getStudentByAuthId(authUserId: string) {
  const { data } = await supabase
    .from('students')
    .select('*')
    .eq('auth_user_id', authUserId)
    .single();
  return data;
}

export async function updateStudentProfile(studentId: string, updates: Partial<{
  name: string; grade: string; board: string; preferred_language: string;
  preferred_subject: string; city: string; state: string; school_name: string;
  onboarding_completed: boolean;
}>) {
  const { data, error } = await supabase.from('students').update(updates).eq('id', studentId).select().single();
  if (error) console.error('updateStudent:', error);
  return data;
}

// ─── Learning Snapshot RPC ─────────────────────────────────────────────────────
export async function getLearningSnapshot(studentId: string) {
  const { data, error } = await supabase.rpc('get_learning_snapshot' as any, { p_student_id: studentId });
  if (error) console.error('getLearningSnapshot:', error);
  return data?.[0] ?? null;
}

export async function getStudentProgress(studentId: string, subjectCode: string) {
  const { data, error } = await supabase.rpc('get_student_progress' as any, {
    p_student_id: studentId, p_subject_code: subjectCode
  });
  if (error) console.error('getStudentProgress:', error);
  return data?.[0] ?? null;
}

export async function getNextTopic(studentId: string, subjectCode: string, grade: string) {
  const { data, error } = await supabase.rpc('get_next_topic' as any, {
    p_student_id: studentId, p_subject_code: subjectCode, p_grade: grade
  });
  if (error) console.error('getNextTopic:', error);
  return (data ?? []) as Array<{ topic_id: string; title: string; difficulty_level: number; mastery_probability: number }>;
}

export async function getDueReviews(studentId: string, subjectCode?: string, limit = 10) {
  const { data, error } = await supabase.rpc('get_due_reviews' as any, {
    p_student_id: studentId, p_subject_code: subjectCode ?? null, p_limit: limit
  });
  if (error) console.error('getDueReviews:', error);
  return (data ?? []) as Array<{ topic_id: string; title: string; title_hi: string; mastery_probability: number }>;
}

// ─── Subjects ─────────────────────────────────────────────────────────────────
export async function getSubjects() {
  const { data } = await supabase.from('subjects').select('*').eq('is_active', true).order('name');
  return data ?? [];
}

// ─── Learning Profiles ────────────────────────────────────────────────────────
export async function getLearningProfiles(studentId: string) {
  const { data } = await supabase
    .from('student_learning_profiles')
    .select('*')
    .eq('student_id', studentId);
  return data ?? [];
}

// ─── Foxy Chat ────────────────────────────────────────────────────────────────
export async function foxyChat(params: {
  message: string; studentId: string; studentName: string; grade: string;
  language: string; subject: string; sessionMode: string; personaId?: string;
  history?: Array<{ role: string; content: string }>;
  stream?: boolean;
}) {
  const session = await getSession();
  const res = await fetch(EDGE.foxyTutor, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token ?? key}`,
    },
    body: JSON.stringify({
      message: params.message,
      studentName: params.studentName,
      grade: params.grade,
      language: params.language,
      subject: params.subject,
      sessionMode: params.sessionMode,
      personaId: params.personaId ?? 'friendly_primary',
      history: (params.history ?? []).slice(-12),
      stream: params.stream ?? false,
    }),
  });
  if (!res.ok) throw new Error(`Foxy error ${res.status}`);
  if (params.stream) return res; // caller handles stream
  const data = await res.json();
  return data as { response: string; model: string; usage?: { input_tokens: number; output_tokens: number } };
}

// ─── Chat History ─────────────────────────────────────────────────────────────
export async function saveChatSession(params: {
  studentId: string; subject: string; grade: string; title: string;
  messages: Array<{ role: string; content: string }>;
}) {
  const session = await getSession();
  await fetch(EDGE.chatHistory, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token ?? key}` },
    body: JSON.stringify(params),
  });
}

export async function getChatHistory(studentId: string, limit = 20) {
  const { data } = await supabase
    .from('chat_sessions')
    .select('id, subject, grade, title, created_at, messages')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

// ─── Quiz Engine ──────────────────────────────────────────────────────────────
export async function getQuizQuestions(params: {
  studentId: string; subject: string; grade: string; chapterNumber?: number; limit?: number;
}) {
  const session = await getSession();
  const res = await fetch(EDGE.quizEngine, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token ?? key}` },
    body: JSON.stringify({ ...params, action: 'get_questions' }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.questions ?? [];
}

export async function submitQuiz(params: {
  studentId: string; subject: string; grade: string; chapterNumber?: number;
  topicTitle?: string; questions: unknown[]; responses: unknown[]; timeTakenSeconds: number;
}) {
  const session = await getSession();
  const res = await fetch(EDGE.quizSubmit, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token ?? key}` },
    body: JSON.stringify(params),
  });
  if (!res.ok) return null;
  return res.json();
}

// ─── Study Plan ───────────────────────────────────────────────────────────────
export async function getStudyPlan(studentId: string) {
  const session = await getSession();
  const res = await fetch(EDGE.studyPlan, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token ?? key}` },
    body: JSON.stringify({ studentId, action: 'get_plan' }),
  });
  if (!res.ok) return null;
  return res.json();
}

// ─── Student Notes ────────────────────────────────────────────────────────────
export async function getNotes(studentId: string) {
  const { data } = await supabase
    .from('student_notes')
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

// ─── Achievements ─────────────────────────────────────────────────────────────
export async function getAchievements() {
  const { data } = await supabase.from('achievements').select('*').order('xp_reward');
  return data ?? [];
}
export async function getStudentAchievements(studentId: string) {
  const { data } = await supabase
    .from('student_achievements')
    .select('*, achievement:achievement_id(*)')
    .eq('student_id', studentId);
  return data ?? [];
}

// ─── Daily Activity ───────────────────────────────────────────────────────────
export async function getDailyActivity(studentId: string, days = 30) {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from('daily_activity')
    .select('*')
    .eq('student_id', studentId)
    .gte('activity_date', since)
    .order('activity_date', { ascending: true });
  return data ?? [];
}

// ─── Tutor Personas ───────────────────────────────────────────────────────────
export async function getTutorPersonas() {
  const { data } = await supabase.from('tutor_personas').select('*');
  return data ?? [];
}

// ─── Feature Flags ────────────────────────────────────────────────────────────
export async function getFeatureFlags(): Promise<Record<string, boolean>> {
  const { data } = await supabase.from('feature_flags').select('flag_name, is_enabled');
  const flags: Record<string, boolean> = {};
  (data ?? []).forEach(f => { flags[f.flag_name] = f.is_enabled; });
  return flags;
}

// ─── Subscription ─────────────────────────────────────────────────────────────
export async function getSubscriptionPlans() {
  const { data } = await supabase.from('subscription_plans').select('*').order('price_monthly');
  return data ?? [];
}
export async function getStudentSubscription(studentId: string) {
  const { data } = await supabase
    .from('student_subscriptions')
    .select('*, plan:plan_id(*)')
    .eq('student_id', studentId)
    .eq('status', 'active')
    .single();
  return data;
}

// ─── Guardian ─────────────────────────────────────────────────────────────────
export async function getGuardianStudents(guardianId: string) {
  const { data } = await supabase
    .from('guardian_student_links')
    .select('*, student:student_id(*)')
    .eq('guardian_id', guardianId);
  return data ?? [];
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
export async function getLeaderboard(period: 'weekly' | 'monthly' | 'all_time' = 'weekly', limit = 20) {
  const { data } = await supabase
    .from('leaderboard')
    .select('*, student:student_id(name, grade, avatar_url)')
    .eq('period', period)
    .order('rank', { ascending: true })
    .limit(limit);
  return data ?? [];
}

// ─── Spaced Repetition Cards ──────────────────────────────────────────────────
export async function getSpacedRepCards(studentId: string) {
  const { data } = await supabase
    .from('spaced_repetition_cards')
    .select('*')
    .eq('student_id', studentId)
    .lte('next_review_at', new Date().toISOString())
    .order('next_review_at', { ascending: true })
    .limit(20);
  return data ?? [];
}

// ─── XP & Streak ─────────────────────────────────────────────────────────────
export async function awardXP(studentId: string, subject: string, xp: number) {
  await supabase.rpc('award_xp' as any, { p_student_id: studentId, p_subject: subject, p_xp: xp });
}
export async function updateStreak(studentId: string, subject: string) {
  await supabase.rpc('update_streak' as any, { p_student_id: studentId, p_subject: subject });
}
