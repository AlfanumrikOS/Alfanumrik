import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Alfanumrik v2 — Production Supabase Client
// Project: kdnumyjajfuktvgdyljz (ap-south-1)
// ============================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase: SupabaseClient | null =
  supabaseUrl ? createClient(supabaseUrl, supabaseAnonKey) : null;

// Foxy edge function URL (same Supabase project)
const FOXY_URL = supabaseUrl
  ? `${supabaseUrl}/functions/v1/foxy-tutor`
  : '';

// ============================================================
// TYPES — matching the v2 database schema exactly
// ============================================================

export interface DBStudent {
  id: string;
  name: string;
  enrolled_grade: number;
  actual_level: number | null;
  board: string;
  preferred_language: string;
  preferred_subject: string;
  xp_total: number;
  xp_weekly: number;
  streak_days: number;
  streak_best: number;
  last_active_date: string | null;
  onboarding_completed: boolean;
  difficulty_preference: string;
  subscription_plan: string;
  created_at: string;
}

export interface DBConcept {
  id: string;
  subject_id: string;
  grade: number;
  chapter_number: number;
  chapter_name: string;
  topic: string;
  title_en: string;
  title_hi: string | null;
  bloom_level: string;
  cbse_competency: string | null;
  estimated_difficulty: number;
  cognitive_load: number;
  estimated_minutes: number;
}

export interface DBQuestion {
  id: string;
  concept_id: string;
  question_type: string;
  question_text_en: string;
  question_text_hi: string | null;
  options: Array<{ id: string; text_en: string; text_hi: string; is_correct: boolean }>;
  correct_answer: string;
  explanation_en: string | null;
  explanation_hi: string | null;
  hint_en: string | null;
  hint_hi: string | null;
  bloom_level: string;
  difficulty: number;
}

export interface DBBadge {
  id: string;
  name_en: string;
  name_hi: string | null;
  description_en: string;
  description_hi: string | null;
  icon: string;
  category: string;
  xp_reward: number;
}

export interface StudentSnapshot {
  student: {
    id: string;
    name: string;
    grade: number;
    actual_level: number | null;
    xp_total: number;
    xp_weekly: number;
    streak_days: number;
    streak_best: number;
  };
  mastery: {
    not_started: number;
    attempted: number;
    familiar: number;
    proficient: number;
    mastered: number;
  };
  due_reviews: number;
}

export interface BKTResult {
  p_mastery: number;
  mastery_level: string;
  old_mastery: string;
  regressed: boolean;
}

export interface XPResult {
  xp_total: number;
  streak_days: number;
  is_new_day: boolean;
}

export interface NextConcept {
  status: string;
  concept_id: string | null;
  title_en: string | null;
  title_hi: string | null;
  grade: number | null;
  chapter: string | null;
  bloom_level: string | null;
  estimated_minutes: number | null;
}

// ============================================================
// STUDENT OPERATIONS
// ============================================================

/** Create or get a student — called during onboarding */
export async function createStudent(data: {
  name: string;
  grade: number;
  board: string;
  language: string;
  difficulty?: string;
}): Promise<DBStudent | null> {
  if (!supabase) return null;
  try {
    const { data: student, error } = await supabase
      .from('students')
      .insert({
        name: data.name,
        enrolled_grade: data.grade,
        board: data.board,
        preferred_language: data.language,
        difficulty_preference: data.difficulty || 'normal',
        onboarding_completed: true,
      })
      .select()
      .single();
    if (error) { console.error('createStudent error:', error.message); return null; }
    return student;
  } catch (err) { console.error('createStudent failed:', err); return null; }
}

/** Get student by ID */
export async function getStudent(studentId: string): Promise<DBStudent | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('id', studentId)
      .single();
    if (error) return null;
    return data;
  } catch { return null; }
}

/** Get full student snapshot for dashboard — calls the RPC */
export async function getStudentSnapshot(studentId: string): Promise<StudentSnapshot | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('get_student_snapshot', {
      p_student_id: studentId,
    });
    if (error) { console.error('getStudentSnapshot error:', error.message); return null; }
    return data as StudentSnapshot;
  } catch { return null; }
}

// ============================================================
// ADAPTIVE ENGINE — BKT, XP, Knowledge Graph
// ============================================================

/** Update BKT after a student answers a question — the core adaptive loop */
export async function updateBKT(
  studentId: string,
  conceptId: string,
  isCorrect: boolean,
  questionId?: string
): Promise<BKTResult | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('update_bkt', {
      p_student_id: studentId,
      p_concept_id: conceptId,
      p_is_correct: isCorrect,
      p_question_id: questionId || null,
    });
    if (error) { console.error('updateBKT error:', error.message); return null; }
    return data as BKTResult;
  } catch { return null; }
}

/** Award XP and update streak */
export async function awardXP(
  studentId: string,
  xp: number,
  source: string = 'quiz'
): Promise<XPResult | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('award_xp', {
      p_student_id: studentId,
      p_xp: xp,
      p_source: source,
    });
    if (error) { console.error('awardXP error:', error.message); return null; }
    return data as XPResult;
  } catch { return null; }
}

/** Get next concept to learn from knowledge graph traversal */
export async function getNextConcept(
  studentId: string,
  subjectId: string
): Promise<NextConcept | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('get_next_concept', {
      p_student_id: studentId,
      p_subject_id: subjectId,
    });
    if (error) { console.error('getNextConcept error:', error.message); return null; }
    return data as NextConcept;
  } catch { return null; }
}

/** Get spaced repetition cards due for review */
export async function getDueReviews(
  studentId: string,
  limit: number = 10
): Promise<{ due_count: number; cards: Array<{ card_id: string; concept_id: string; title_en: string; title_hi: string }> } | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('get_due_reviews', {
      p_student_id: studentId,
      p_limit: limit,
    });
    if (error) { console.error('getDueReviews error:', error.message); return null; }
    return data;
  } catch { return null; }
}

// ============================================================
// CONTENT — Questions, Concepts, Badges from the real DB
// ============================================================

/** Fetch questions for a specific concept from question_bank */
export async function getQuestions(conceptId: string): Promise<DBQuestion[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('concept_id', conceptId)
      .eq('is_active', true)
      .order('difficulty', { ascending: true });
    if (error) { console.error('getQuestions error:', error.message); return []; }
    return (data || []) as DBQuestion[];
  } catch { return []; }
}

/** Fetch questions for a quiz — by subject, grade, or mixed */
export async function getQuizQuestions(params: {
  subjectId?: string;
  grade?: number;
  limit?: number;
  bloomLevel?: string;
}): Promise<DBQuestion[]> {
  if (!supabase) return [];
  try {
    let query = supabase
      .from('questions')
      .select('*, concepts!inner(subject_id, grade)')
      .eq('is_active', true);

    if (params.subjectId) {
      query = query.eq('concepts.subject_id', params.subjectId);
    }
    if (params.grade) {
      query = query.eq('concepts.grade', params.grade);
    }
    if (params.bloomLevel) {
      query = query.eq('bloom_level', params.bloomLevel);
    }

    const { data, error } = await query
      .order('difficulty', { ascending: true })
      .limit(params.limit || 10);

    if (error) { console.error('getQuizQuestions error:', error.message); return []; }
    return (data || []) as DBQuestion[];
  } catch { return []; }
}

/** Fetch all concepts for a subject */
export async function getConcepts(subjectId: string): Promise<DBConcept[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('concepts')
      .select('*')
      .eq('subject_id', subjectId)
      .eq('is_active', true)
      .order('grade', { ascending: true })
      .order('chapter_number', { ascending: true });
    if (error) return [];
    return (data || []) as DBConcept[];
  } catch { return []; }
}

/** Fetch all subjects */
export async function getSubjects() {
  if (!supabase) return [];
  try {
    const { data } = await supabase
      .from('subjects')
      .select('*')
      .eq('is_active', true);
    return data || [];
  } catch { return []; }
}

/** Fetch all badges */
export async function getBadges(): Promise<DBBadge[]> {
  if (!supabase) return [];
  try {
    const { data } = await supabase
      .from('badges')
      .select('*')
      .eq('is_active', true);
    return (data || []) as DBBadge[];
  } catch { return []; }
}

/** Fetch earned badges for a student */
export async function getStudentBadges(studentId: string): Promise<string[]> {
  if (!supabase) return [];
  try {
    const { data } = await supabase
      .from('student_badges')
      .select('badge_id')
      .eq('student_id', studentId);
    return (data || []).map(b => b.badge_id);
  } catch { return []; }
}

/** Get leaderboard */
export async function getLeaderboard(limit: number = 20) {
  if (!supabase) return [];
  try {
    const { data } = await supabase
      .from('students')
      .select('id, name, enrolled_grade, xp_total, streak_days')
      .order('xp_total', { ascending: false })
      .limit(limit);
    return data || [];
  } catch { return []; }
}

// ============================================================
// QUIZ SESSION — Save results to DB + trigger BKT updates
// ============================================================

/** Save a completed quiz session and update BKT for each response */
export async function saveQuizSession(params: {
  studentId: string;
  subjectId: string;
  quizType?: string;
  grade?: number;
  responses: Array<{
    questionId: string;
    conceptId: string;
    selectedAnswer: string;
    isCorrect: boolean;
    timeTakenSeconds: number;
  }>;
  durationSeconds: number;
}): Promise<{ sessionId: string; xpEarned: number } | null> {
  if (!supabase) return null;
  try {
    const correct = params.responses.filter(r => r.isCorrect).length;
    const total = params.responses.length;
    const xpEarned = correct * 10 + (correct === total ? 25 : 0); // 10 XP per correct + 25 bonus for perfect

    // 1. Create quiz session
    const { data: session, error: sessionErr } = await supabase
      .from('quiz_sessions')
      .insert({
        student_id: params.studentId,
        subject_id: params.subjectId,
        quiz_type: params.quizType || 'practice',
        grade: params.grade,
        total_questions: total,
        correct_answers: correct,
        score_percent: total > 0 ? (correct / total) * 100 : 0,
        duration_seconds: params.durationSeconds,
        xp_earned: xpEarned,
        is_completed: true,
        completed_at: new Date().toISOString(),
        concept_ids: [...new Set(params.responses.map(r => r.conceptId))],
      })
      .select('id')
      .single();

    if (sessionErr) { console.error('saveQuizSession error:', sessionErr.message); return null; }

    // 2. Save individual responses + log to student_responses
    for (const resp of params.responses) {
      // Save to student_responses (feeds BKT)
      await supabase.from('student_responses').insert({
        student_id: params.studentId,
        question_id: resp.questionId,
        concept_id: resp.conceptId,
        selected_answer: resp.selectedAnswer,
        is_correct: resp.isCorrect,
        time_taken_seconds: resp.timeTakenSeconds,
        session_type: params.quizType || 'practice',
      });

      // Save to quiz_responses (links to session)
      await supabase.from('quiz_responses').insert({
        quiz_session_id: session.id,
        question_id: resp.questionId,
        selected_answer: resp.selectedAnswer,
        is_correct: resp.isCorrect,
        time_taken_seconds: resp.timeTakenSeconds,
        question_order: params.responses.indexOf(resp) + 1,
      });

      // 3. Update BKT for each response — the core adaptive loop
      await updateBKT(params.studentId, resp.conceptId, resp.isCorrect, resp.questionId);
    }

    // 4. Award XP
    await awardXP(params.studentId, xpEarned, 'quiz');

    return { sessionId: session.id, xpEarned };
  } catch (err) { console.error('saveQuizSession failed:', err); return null; }
}

// ============================================================
// FOXY AI TUTOR — calls the edge function
// ============================================================

/** Send a message to Foxy AI Tutor */
export async function foxyChat(params: {
  message: string;
  studentName: string;
  grade: number;
  language: string;
  subject?: string;
  sessionMode?: string;
  history?: Array<{ role: string; content: string }>;
}): Promise<{ response: string; model: string }> {
  const fallback = {
    response: getFallbackResponse(params.message, params.studentName, params.language === 'hi'),
    model: 'fallback',
  };

  if (!FOXY_URL) return fallback;

  try {
    const res = await fetch(FOXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({
        message: params.message,
        studentName: params.studentName,
        grade: params.grade,
        language: params.language,
        subject: params.subject || 'science',
        sessionMode: params.sessionMode || 'learn',
        history: (params.history || []).slice(-10),
      }),
    });

    if (!res.ok) {
      console.warn('Foxy API error:', res.status);
      return fallback;
    }

    const data = await res.json();
    return {
      response: data.response || fallback.response,
      model: data.model || 'unknown',
    };
  } catch (err) {
    console.warn('Foxy fetch error:', err);
    return fallback;
  }
}

/** Save a Foxy chat session */
export async function saveChatSession(params: {
  studentId: string;
  subjectId?: string;
  conceptId?: string;
  sessionMode: string;
  messages: Array<{ role: string; content: string }>;
  xpEarned?: number;
}): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data: session, error } = await supabase
      .from('chat_sessions')
      .insert({
        student_id: params.studentId,
        subject_id: params.subjectId,
        concept_id: params.conceptId,
        session_mode: params.sessionMode,
        messages_count: params.messages.length,
        xp_earned: params.xpEarned || 0,
      })
      .select('id')
      .single();

    if (error || !session) return null;

    // Save messages
    const messagesToInsert = params.messages.map((msg, i) => ({
      session_id: session.id,
      role: msg.role === 'foxy' ? 'foxy' : msg.role === 'system' ? 'system' : 'student',
      content: msg.content,
      message_order: i + 1,
    }));

    await supabase.from('chat_messages').insert(messagesToInsert);

    return session.id;
  } catch { return null; }
}

// ============================================================
// FALLBACK RESPONSES (when edge function is unavailable)
// ============================================================

function getFallbackResponse(text: string, name: string, isHi: boolean): string {
  const t = text.toLowerCase();
  if (t.includes('newton') || t.includes('force') || t.includes('बल') || t.includes('न्यूटन'))
    return isHi
      ? `🦊 बढ़िया सवाल, ${name}! चलो न्यूटन के नियम समझते हैं:\n\n🏏 **पहला नियम:** क्रिकेट की गेंद मैदान में रुकी है — जब तक कोई मारे नहीं, हिलेगी नहीं!\n\n**दूसरा नियम (F=ma):** जितनी जोर से मारोगे, गेंद उतनी तेज जाएगी।\n\n**तीसरा नियम:** दीवार को धक्का मारो, दीवार भी उतना ही धक्का मारती है!\n\n🤔 बताओ — साइकिल ब्रेक लगाने पर आगे क्यों झुकते हो?`
      : `🦊 Great question, ${name}! Let's explore Newton's Laws:\n\n🏏 **First Law:** A cricket ball on the pitch won't move until hit!\n\n**Second Law (F=ma):** Harder hit = faster ball.\n\n**Third Law:** Push a wall, it pushes you back equally!\n\n🤔 When you brake your bicycle, why do you lean forward? Which law?`;
  if (t.includes('ohm') || t.includes('circuit') || t.includes('current') || t.includes('विद्युत'))
    return isHi
      ? `🦊 ओम का नियम सीखते हैं, ${name}!\n\n⚡ **V = I × R**\n\nV = वोल्टेज, I = करंट, R = प्रतिरोध\n\n**उदाहरण:** 12V बैटरी, 4Ω प्रतिरोध\nI = V/R = 12/4 = **3 Ampere** ⚡\n\n🤔 अगर प्रतिरोध दोगुना (8Ω), करंट कितना?`
      : `🦊 Let's learn Ohm's Law, ${name}!\n\n⚡ **V = I × R**\n\nV = Voltage, I = Current, R = Resistance\n\n**Example:** 12V battery, 4Ω resistance\nI = V/R = 12/4 = **3 Ampere** ⚡\n\n🤔 If we double resistance to 8Ω, what happens to current?`;
  if (t.includes('quadratic') || t.includes('द्विघात') || t.includes('equation'))
    return isHi
      ? `🦊 चलो ${name}, step-by-step सीखते हैं!\n\n📐 **द्विघात समीकरण:** ax² + bx + c = 0\n\nउदाहरण: x² - 5x + 6 = 0\n\n**Step 1:** गुणनफल=6, योग=-5 → -2 और -3\n**Step 2:** (x-2)(x-3) = 0\n**Step 3:** x = 2 या x = 3 ✅\n\nअब तुम try करो: x² - 7x + 12 = 0 का हल?`
      : `🦊 Let's break it down, ${name}!\n\n📐 **Quadratic:** ax² + bx + c = 0\n\nSolve: x² - 5x + 6 = 0\n\n**Step 1:** Product=6, sum=-5 → -2,-3\n**Step 2:** (x-2)(x-3)=0\n**Step 3:** x=2 or x=3 ✅\n\nNow you try: x² - 7x + 12 = 0?`;
  if (t.includes('photosynthesis') || t.includes('प्रकाश संश्लेषण') || t.includes('plant') || t.includes('पौधा'))
    return isHi
      ? `🦊 प्रकाश संश्लेषण — पौधे कैसे खाना बनाते हैं!\n\n🌱 **समीकरण:**\nCO₂ + H₂O + सूर्य प्रकाश → ग्लूकोज + O₂\n\n1. 🌞 पत्तियाँ सूरज की रोशनी पकड़ती हैं\n2. 💧 जड़ें जमीन से पानी लाती हैं\n3. 🌬️ पत्तियाँ हवा से CO₂ लेती हैं\n4. 🍬 ग्लूकोज (खाना) बनता है!\n5. 🫁 O₂ बाहर — जो हम साँस लेते हैं!\n\n🤔 पौधे को अँधेरे में रखें तो?`
      : `🦊 Photosynthesis — how plants make food!\n\n🌱 **Equation:**\nCO₂ + H₂O + Sunlight → Glucose + O₂\n\n1. 🌞 Leaves capture sunlight (chlorophyll)\n2. 💧 Roots absorb water\n3. 🌬️ Leaves take CO₂ from air\n4. 🍬 Glucose (food) is made!\n5. 🫁 O₂ released — which we breathe!\n\n🤔 What happens in complete darkness?`;
  return isHi
    ? `🦊 अच्छा सवाल, ${name}! 🤔\n\nमुझे बताओ — इसमें सबसे ज़्यादा क्या confuse करता है? Step by step चलते हैं!\n\n*टिप: जितना specific पूछोगे, उतना अच्छा समझा पाऊँगी* 😊`
    : `🦊 Great question, ${name}! 🤔\n\nTell me — what part confuses you most? Let's go step by step!\n\n*Tip: The more specific, the better I can help* 😊`;
}
