/**
 * @deprecated Import from '@/lib/supabase-client' for the pure client.
 * Import from '@/lib/domains/*' for data access functions.
 * This file exists for backward compatibility while the migration proceeds.
 *
 * MIGRATION STATUS: 51 importers remain (tracked in Phase C notes)
 * Do not add new imports from this file.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { XP_RULES } from './xp-rules';
import { calculateScorePercent, calculateQuizXP } from './scoring';

// Re-export from the canonical client module — new code uses supabase-client.ts
export { supabase, supabaseUrl, supabaseAnonKey } from './supabase-client';

// Internal: import client + constants for use by the data functions below
import { supabase, supabaseUrl, supabaseAnonKey } from './supabase-client';

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
    // Send Bearer token so authorizeRequest can authenticate without relying
    // solely on chunked session cookies (which can fail on large JWTs).
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
    } catch { /* proceed without token — cookie fallback */ }

    const res = await fetchWithTimeout('/api/foxy', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        message:   params.message,
        subject:   params.subject   ?? 'general',
        grade:     params.grade     ?? '9',
        chapter:   null,
        board:     null,
        sessionId: params.session_id ?? null,
        mode:      params.mode       ?? 'learn',
      }),
    }, 30000); // 30s timeout for AI responses
    if (!res.ok) {
      return { reply: 'Foxy is unavailable right now. Try again shortly!', xp_earned: 0, session_id: params.session_id ?? '' };
    }
    const data = await res.json();
    return {
      reply:      data.response || 'Let me think...',
      xp_earned:  0,
      session_id: data.sessionId || params.session_id || '',
    };
  } catch (e) {
    console.error('chatWithFoxy:', e);
    const msg = e instanceof DOMException && e.name === 'AbortError'
      ? 'Request timed out — please try again.'
      : 'Connection issue — please try again.';
    return { reply: msg, xp_earned: 0, session_id: params.session_id ?? '' };
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

  // Fetch seen question IDs for dedup (best-effort, ignore errors)
  const seenIds = new Set<string>();
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: studentRow } = await supabase
        .from('students')
        .select('id')
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (studentRow) {
        let historyQuery = supabase
          .from('user_question_history')
          .select('question_id')
          .eq('student_id', studentRow.id)
          .eq('subject', subject)
          .eq('grade', grade);
        if (chapterNumber != null) historyQuery = historyQuery.eq('chapter_number', chapterNumber);
        const { data: historyData } = await historyQuery.limit(500);
        if (historyData) historyData.forEach(h => seenIds.add(h.question_id));
      }
    }
  } catch { /* History fetch failed — proceed without dedup */ }

  // Direct table query fallback — fetch more to ensure enough unseen questions
  const fetchLimit = Math.min(count * 4, 120);
  let query = supabase.from('question_bank')
    .select('id, question_text, question_hi, question_type, options, correct_answer_index, explanation, explanation_hi, hint, difficulty, bloom_level, chapter_number')
    .eq('subject', subject)
    .eq('grade', grade)
    .eq('is_active', true)
    .limit(fetchLimit);
  if (difficulty != null) query = query.eq('difficulty', difficulty);
  if (chapterNumber != null) query = query.eq('chapter_number', chapterNumber);
  const { data, error } = await query;
  if (error) throw error;

  // Validate, deduplicate, prefer unseen questions, shuffle, and trim to count
  const validated = validateQuestions(data ?? []);
  const unseen = validated.filter(q => !seenIds.has(q.id));
  const seen = validated.filter(q => seenIds.has(q.id));
  // Prioritize unseen, then backfill with seen if pool is too small
  const pool = [...unseen.sort(() => Math.random() - 0.5), ...seen.sort(() => Math.random() - 0.5)];
  return pool.slice(0, count);
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

    // Reject template markers (P6: no {{ or [BLANK])
    if (q.question_text.includes('{{') || q.question_text.includes('[BLANK]')) return false;

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

/**
 * ARCHITECTURAL CONTRACT -- DO NOT MODIFY WITHOUT REVIEW
 *
 * Quiz submission MUST update adaptive learning state. This happens in TWO layers:
 *
 * Layer 1 (SERVER-SIDE, in RPC):
 *   submit_quiz_results RPC -> update_learner_state_post_quiz()
 *   Updates: concept_mastery (BKT), bloom_progression, spaced_repetition,
 *            error classification, retention half-life, streak, CME action
 *   Requires: question_bank.topic_id IS NOT NULL (currently 99.9% populated)
 *   Guarded by: IF v_q_topic_id IS NOT NULL THEN ... END IF
 *
 * Layer 2 (CLIENT-SIDE, belt-and-braces backup):
 *   processAdaptiveLearning() -> CME Edge Function record_response
 *   Updates: cme_concept_state (IRT mastery), error classification
 *   Fires after Layer 1 succeeds, fire-and-forget
 *   NOTE: This is redundant with Layer 1 since migration 20260405000001
 *   unified concept_mastery and cme_concept_state. Kept as safety net
 *   in case Layer 1's topic_id lookup returns NULL for edge-case questions.
 *
 * FALLBACK PATH WARNING:
 *   If submit_quiz_results RPC fails, the fallback uses atomic_quiz_profile_update
 *   which does NOT call update_learner_state_post_quiz. In that case, Layer 2
 *   (processAdaptiveLearning) is the ONLY mastery update path. This is acceptable
 *   because the RPC failure is already logged, and Layer 2 is always called from
 *   the quiz page regardless of which submission path succeeded.
 *
 * INVARIANT: Every quiz submission MUST trigger both layers.
 * If you add a new quiz page, it MUST call submitQuizResults() + processAdaptiveLearning().
 * Test: src/__tests__/adaptive-pipeline.test.ts verifies this contract.
 */
/**
 * P0 fix (migration 20260428160000): server-owned shuffle authority.
 *
 * Calls the start_quiz_session RPC, which generates a server-side shuffle per
 * question, snapshots options + correct_answer_index into
 * quiz_session_shuffles, and returns the SHUFFLED options to the client
 * WITHOUT correct_answer_index. The session_id MUST be passed back to
 * submitQuizResults for v2 scoring.
 *
 * Returns a discriminated result. On RPC failure, returns `{ session_id: null,
 * questions: <raw> }` so the caller can fall back to the legacy path
 * (client-side shuffle + v1 submit). The web client should treat a null
 * session_id as a soft failure and surface a retry-friendly error to the user.
 */
export interface ServerShuffledQuestion {
  question_id: string;
  question_text: string;
  question_hi: string | null;
  question_type: string;
  options_displayed: string[];
  explanation: string | null;
  explanation_hi: string | null;
  hint: string | null;
  difficulty: number;
  bloom_level: string;
  chapter_number: number;
}
export interface ServerQuizSession {
  session_id: string;
  questions: ServerShuffledQuestion[];
}
export async function startQuizSession(
  studentId: string,
  questionIds: string[],
): Promise<ServerQuizSession | null> {
  try {
    const { data, error } = await supabase.rpc('start_quiz_session', {
      p_student_id: studentId,
      p_question_ids: questionIds,
    });
    if (error) {
      console.warn('start_quiz_session RPC failed:', error.message);
      return null;
    }
    if (!data || typeof data !== 'object') return null;
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    if (!parsed?.session_id || !Array.isArray(parsed?.questions)) return null;
    return parsed as ServerQuizSession;
  } catch (e) {
    console.warn('start_quiz_session error:', e);
    return null;
  }
}

/**
 * v2 response payload — client sends ONLY the displayed index it clicked.
 * No more is_correct, no more shuffle_map. Server is the single source of truth.
 */
export interface QuizResponseV2 {
  question_id: string;
  selected_displayed_index: number;
  time_spent: number;
  error_type?: string;
  // Written-answer companion fields (still needed for SA/MA/LA flow, but
  // server scores those separately via ncert-question-engine).
  student_answer_text?: string;
  marks_awarded?: number;
  marks_possible?: number;
  rubric_feedback?: string;
}

// Dedup guard: prevents double-click / SWR retry from re-submitting a quiz (5 min window).
const _quizDedup = new Set<string>();

// v2 response mapper -- strips is_correct + shuffle_map; server re-derives both from snapshot.
type _RX = import('./types').QuizResponse & { error_type?: string; student_answer_text?: string; marks_awarded?: number; marks_possible?: number; rubric_feedback?: string };
function _mapV2(responses: import('./types').QuizResponse[]) {
  return responses.map(r => { const rx = r as _RX; return { question_id: r.question_id, selected_displayed_index: typeof r.selected_option === 'number' ? r.selected_option : Number(r.selected_option), time_spent: r.time_spent, error_type: rx.error_type, student_answer_text: rx.student_answer_text, marks_awarded: rx.marks_awarded, marks_possible: rx.marks_possible, rubric_feedback: rx.rubric_feedback }; });
}

/**
 * ARCHITECTURAL CONTRACT (post-PR #447) -- DO NOT MODIFY WITHOUT REVIEW
 *
 * submitQuizResults dispatches across two layers:
 *   Layer 1: v2 RPC submit_quiz_results_v2 when sessionId is provided
 *            (server-shuffle authority via start_quiz_session snapshot).
 *   Layer 2: v1 RPC submit_quiz_results as fallback / legacy path
 *            (no sessionId -- mobile + in-flight web clients).
 *   Fallback: atomic_quiz_profile_update if both RPCs fail.
 *
 * The v1 RPC `submit_quiz_results` MUST remain callable until mobile cuts
 * over to v2. adaptive-pipeline.test.ts enforces this canary.
 */
export async function submitQuizResults(studentId: string, subject: string, grade: string, topic: string, chapter: number, responses: import('./types').QuizResponse[], time: number, sessionId?: string | null) {
  const _k = `${studentId}:${subject}:${topic}:${responses.length}:${time}`;
  if (_quizDedup.has(_k)) return { duplicate: true };
  _quizDedup.add(_k); setTimeout(() => _quizDedup.delete(_k), 300_000);
  try {
    if (sessionId) { // L1: v2 (server-shuffle)
      try {
        const v2 = await supabase.rpc('submit_quiz_results_v2', { p_session_id: sessionId, p_student_id: studentId, p_subject: subject, p_grade: grade, p_topic: topic, p_chapter: chapter, p_responses: _mapV2(responses), p_time: time });
        if (!v2.error && v2.data) return v2.data;
      } catch { /* fall through */ }
    }
    try { // L2: v1 RPC (legacy)
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
    const scorePct = calculateScorePercent(correct, total);
    const xpEarned = calculateQuizXP(correct, scorePct);

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
  } catch (err) {
    // Release dedup lock so a genuine retry can proceed
    _quizDedup.delete(_k);
    throw err;
  }
}

/**
 * Post-quiz adaptive processing — fire-and-forget, non-blocking.
 *
 * Calls the CME Edge Function `record_response` action per question to update
 * mastery state in `cme_concept_state`. This enables:
 * - Adaptive difficulty in future quizzes (quiz-generator uses concept_mastery)
 * - Spaced repetition scheduling (retention half-life tracking)
 * - Knowledge gap detection (error classification)
 * - Bloom's progression tracking
 *
 * Called from the quiz page AFTER submitQuizResults succeeds. Receives both
 * the responses and the original questions (needed for chapter_number, difficulty,
 * bloom_level which are on the question, not the response).
 *
 * IMPORTANT: This is a best-effort enhancement. If it fails, the quiz score and
 * XP are already saved correctly via the atomic RPC (P1/P2/P3/P4 untouched).
 */
export async function processAdaptiveLearning(
  studentId: string,
  subject: string,
  grade: string,
  responses: Array<{ question_id: string; is_correct: boolean; time_spent: number; selected_option: number; error_type?: string }>,
  questions: Array<{ id: string; chapter_number: number; difficulty: number; bloom_level: string }>,
  sessionId: string,
): Promise<void> {
  // Get the user's access token for CME Edge Function auth
  const { data: { session: authSession } } = await supabase.auth.getSession();
  const token = authSession?.access_token;
  if (!token) return; // Can't call Edge Function without auth

  // Build question lookup by ID
  const questionMap = new Map(questions.map(q => [q.id, q]));

  // Resolve subject code -> subject UUID for curriculum_topics lookup
  const { data: subjectRow } = await supabase
    .from('subjects')
    .select('id')
    .eq('code', subject)
    .maybeSingle();
  if (!subjectRow) return;

  // Collect unique chapter numbers from questions to resolve topic IDs
  const chapterNumbers = new Set<number>();
  for (const q of questions) {
    if (typeof q.chapter_number === 'number' && q.chapter_number > 0) {
      chapterNumbers.add(q.chapter_number);
    }
  }

  // Resolve chapter_number -> curriculum_topics.id (UUID) for CME
  const topicMap = new Map<number, string>(); // chapter_number -> topic UUID
  if (chapterNumbers.size > 0) {
    const { data: topics } = await supabase
      .from('curriculum_topics')
      .select('id, chapter_number')
      .eq('subject_id', subjectRow.id)
      .eq('grade', grade)
      .in('chapter_number', [...chapterNumbers])
      .is('parent_topic_id', null) // top-level chapter topics
      .limit(50);
    if (topics) {
      for (const t of topics) {
        if (t.chapter_number != null && !topicMap.has(t.chapter_number)) {
          topicMap.set(t.chapter_number, t.id);
        }
      }
    }
  }

  // Call CME record_response for each question response.
  // This updates cme_concept_state with BKT mastery, error classification,
  // retention scheduling per concept.
  let cmeFailureCount = 0;
  let cmeSuccessCount = 0;
  for (const response of responses) {
    const question = questionMap.get(response.question_id);
    if (!question) continue;

    const conceptId = topicMap.get(question.chapter_number);
    if (!conceptId) continue; // No matching curriculum_topic — skip

    try {
      await fetchWithTimeout(`${supabaseUrl}/functions/v1/cme-engine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'record_response',
          concept_id: conceptId,
          question_id: response.question_id,
          correct: response.is_correct,
          difficulty: question.difficulty ?? 2,
          response_time_ms: (response.time_spent ?? 10) * 1000,
        }),
      }, 5000); // 5s timeout per call — best-effort
      cmeSuccessCount++;
    } catch {
      cmeFailureCount++;
    }
  }

  // Report adaptive pipeline failures to ops_events via /api/client-error
  // so they appear in the Observability Console and alert rules can fire.
  if (cmeFailureCount > 0) {
    try {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[adaptive-pipeline] CME record_response failed for ${cmeFailureCount}/${cmeFailureCount + cmeSuccessCount} questions`,
          url: '/quiz',
        }),
      }).catch((err: unknown) => {
        console.warn('[adaptive-pipeline] error-report POST failed:', err instanceof Error ? err.message : String(err));
      }); // fire-and-forget, never block
    } catch {
      // Reporting failure is itself non-fatal
    }
  }
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
    .select('id, student_id, subject, topic, chapter_title, front_text, back_text, hint, source, ease_factor, interval_days, streak, repetition_count, total_reviews, correct_reviews, next_review_date, last_review_date, created_at')
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
        apikey: supabaseAnonKey, // Required by Supabase Edge Functions for JWT verification
      },
      body: JSON.stringify({
        action: 'get_next_action',
        subject_id: subjectRow.id,
      }),
    }, 10000);

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

/* ── Chapter topics (for /learn/[subject]/[chapter] page) ── */
export async function getChapterTopics(subject: string, grade: string, chapterNumber: number) {
  // Voyage RAG source of truth. curriculum_topics is legacy and will be removed
  // after chapter_concepts + rag_content_chunks fully supersede it.
  const ragGrade = grade.startsWith('Grade') ? grade : `Grade ${grade}`;
  const { data: ragSubjectRow } = await supabase.rpc('subject_code_to_rag_name', { p_code: subject });
  const ragSubject = typeof ragSubjectRow === 'string' && ragSubjectRow ? ragSubjectRow : subject;

  const { data, error } = await supabase.rpc('get_chapter_rag_content', {
    p_grade: ragGrade,
    p_subject: ragSubject,
    p_chapter_number: chapterNumber,
    p_content_type: null,
  });
  if (error) console.error('getChapterTopics (RAG):', error.message);

  interface RagChunk {
    chunk_id: string;
    chunk_text: string | null;
    topic: string | null;
    concept: string | null;
    chapter_title: string | null;
    chunk_index: number | null;
    page_number: number | null;
    media_url: string | null;
  }
  const chunks = (data ?? []) as RagChunk[];

  // Group RAG chunks by concept (or topic) so the Learn page sees one card per
  // concept instead of 10+ raw chunks. Preserves ordering via min chunk_index.
  const byKey = new Map<string, {
    id: string; subject_id: string; title: string; title_hi: string | null;
    description: string | null; grade: string; board: string | null;
    chapter_number: number | null; difficulty_level: number;
    estimated_minutes: number | null; tags: string[] | null;
    is_active: boolean; display_order: number;
    learning_objectives: string[] | null; bloom_focus: string | null;
  }>();

  for (const c of chunks) {
    const key = (c.concept ?? c.topic ?? `chunk-${c.chunk_index ?? c.chunk_id}`).trim() || c.chunk_id;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        id: c.chunk_id,
        subject_id: '',
        title: key,
        title_hi: null,
        description: c.chunk_text ?? '',
        grade,
        board: 'CBSE',
        chapter_number: chapterNumber,
        difficulty_level: 1,
        estimated_minutes: null,
        tags: null,
        is_active: true,
        display_order: c.chunk_index ?? 0,
        learning_objectives: null,
        bloom_focus: null,
      });
    } else if (c.chunk_text) {
      existing.description = (existing.description ?? '') + '\n\n' + c.chunk_text;
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.display_order - b.display_order);
}

/* ── Questions filtered by chapter (for chapter quiz + quick-check) ── */
export async function getChapterQuestions(subject: string, grade: string, chapterNumber: number, count = 20, difficulty?: number | null) {
  let query = supabase.from('question_bank')
    .select('id, question_text, question_hi, question_type, options, correct_answer_index, explanation, explanation_hi, hint, difficulty, bloom_level, chapter_number')
    .eq('subject', subject)
    .eq('grade', grade)
    .eq('is_active', true)
    .eq('chapter_number', chapterNumber)
    .limit(Math.min(count, 50));
  if (difficulty != null) query = query.eq('difficulty', difficulty);
  const { data, error } = await query;
  if (error) console.error('getChapterQuestions:', error.message);
  return (data ?? []).sort(() => Math.random() - 0.5);
}

/* ── Distinct chapters for a subject/grade (for quiz chapter selector) ──
 * Reads from `chapters` (Voyage-RAG-aligned registry with ncert_page_start/end
 * and total_questions) instead of the legacy `curriculum_topics` shadow.
 * Both tables were 1:1 on chapter_number+title after the NCERT 2024 refresh,
 * but chapters is the source of truth and gets rebuilt when content re-indexes.
 */
/**
 * Recovery-mode (compat shim). Delegates to GET /api/student/chapters,
 * which is governed by available_chapters_for_student_subject RPC and
 * therefore enforces grade ∩ plan ∩ stream ∩ is_content_ready. The
 * `grade` arg is now ignored — the server resolves the student's grade
 * from auth context and refuses cross-grade requests.
 *
 * New code MUST call `useAllowedChapters(subject)` from
 * '@/lib/useAllowedChapters' instead.
 *
 * @deprecated Use `useAllowedChapters` from '@/lib/useAllowedChapters'.
 */
export async function getChaptersForSubject(subject: string, _grade: string) {
  void _grade;
  try {
    // Auth tokens live in localStorage (no middleware to sync to cookies).
    // Send the access token as Bearer header so /api/student/chapters can
    // authenticate the request. Without this, the route returns 401 and the
    // picker shows "No chapters available for this subject yet" even though
    // cbse_syllabus has data. Matches useAllowedSubjects() behavior.
    const headers: Record<string, string> = {};
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
    } catch {
      // Proceed without — server will return 401 and we fall back to [].
    }

    const r = await fetch(
      `/api/student/chapters?subject=${encodeURIComponent(subject)}`,
      { headers },
    );
    if (!r.ok) {
      // 422 = subject not allowed for this student; 401 = unauthenticated.
      // Either way the correct UI behavior is "no chapters available".
      return [] as Array<{ chapter_number: number; title: string }>;
    }
    // API v2 returns { chapters: [{ chapter_number, chapter_title, chapter_title_hi, verified_question_count }] }
    // QuizSetup expects { chapter_number, title } so map server column
    // `chapter_title` → client field `title`. Prefer Hindi when available.
    const body = (await r.json()) as {
      chapters?: Array<{
        chapter_number: number;
        chapter_title?: string;
        chapter_title_hi?: string | null;
        // Legacy shape kept for back-compat with older server revisions.
        title?: string;
      }>;
    };
    return (body.chapters ?? []).map((c) => ({
      chapter_number: c.chapter_number,
      title: c.chapter_title ?? c.title ?? `Chapter ${c.chapter_number}`,
    }));
  } catch (e) {
    console.error('getChaptersForSubject(compat):', e instanceof Error ? e.message : String(e));
    return [];
  }
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


/* ═══ QUIZ V2 & NCERT COVERAGE APIs ═══ */

/** Helper: resolve current student ID from auth session */
async function resolveStudentId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();
  if (!student) throw new Error('Student not found');

  return student.id;
}

/* ── Quiz Questions — Edge Function first (adaptive + RAG + CME) ── */
export async function getQuizQuestionsV2(
  subject: string,
  grade: string,
  count: number = 10,
  difficultyMode: string = 'mixed',
  chapterNumber: number | null = null,
  questionTypes: string[] = ['mcq']
) {
  const studentId = await resolveStudentId();
  const diffMap: Record<string, number | null> = { easy: 1, medium: 2, hard: 3, mixed: null, progressive: null };

  // ── Fetch IRT theta (student ability estimate) from learning profile ──
  // IRT theta is the student's calibrated ability level in this subject.
  // Passing it to quiz-generator enables 3PL IRT item selection: questions
  // are chosen from the difficulty band closest to theta, maximising
  // information gain and keeping the student in ZPD.
  let irtTheta: number | null = null;
  try {
    const { data: profileData } = await supabase
      .from('student_learning_profiles')
      .select('irt_theta')
      .eq('student_id', studentId)
      .maybeSingle();
    if (profileData?.irt_theta != null) {
      irtTheta = profileData.irt_theta as number;
    }
  } catch {
    // Non-fatal: quiz-generator will use default difficulty band
  }

  // ── PRIMARY: quiz-generator Edge Function ──
  // This is the CME-driven source. It does adaptive selection based on
  // student mastery, RAG Q&A from NCERT content, and question_bank —
  // all in one call. It handles interleaving, Bloom's distribution,
  // weak-topic targeting, and AI generation for pool deficits internally.
  let edgeFunctionQuestions: unknown[] | null = null;
  try {
    const { data: funcData, error: funcError } = await supabase.functions.invoke('quiz-generator', {
      body: {
        student_id: studentId,
        subject,
        grade,
        count,
        difficulty: diffMap[difficultyMode] ?? null,
        chapter_number: chapterNumber,
        // IRT theta — student ability estimate for adaptive item selection.
        // null means quiz-generator will use its default difficulty logic.
        ability_estimate: irtTheta,
      },
    });

    if (!funcError && funcData?.questions) {
      const questions = Array.isArray(funcData.questions) ? funcData.questions : [];
      if (questions.length >= count) {
        // Edge function returned the full requested count — use it directly
        return questions;
      }
      if (questions.length > 0) {
        // Partial results — try RPCs for full count, keep these as fallback
        console.warn(`quiz-generator returned ${questions.length}/${count} questions, trying RPCs for full count`);
        edgeFunctionQuestions = questions;
      }
    }
    if (!edgeFunctionQuestions) {
      console.warn('quiz-generator returned no questions, falling back to RPC');
    }
  } catch (e) {
    console.warn('quiz-generator Edge Function failed, falling back to RPC:', e);
  }

  // ── FALLBACK 1: select_quiz_questions_rag RPC ──
  try {
    const { data, error } = await supabase.rpc('select_quiz_questions_rag', {
      p_student_id: studentId,
      p_subject: subject,
      p_grade: grade,
      p_chapter_number: chapterNumber,
      p_count: count,
      p_difficulty_mode: difficultyMode,
      p_question_types: questionTypes,
      p_query_embedding: null,
    });
    if (!error && data) {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      const questions = Array.isArray(parsed) ? parsed : [];
      if (questions.length > 0) return questions;
    }
  } catch {
    // RAG RPC failed
  }

  // ── FALLBACK 2: select_quiz_questions_v2 RPC ──
  try {
    const { data, error } = await supabase.rpc('select_quiz_questions_v2', {
      p_student_id: studentId,
      p_subject: subject,
      p_grade: grade,
      p_chapter_number: chapterNumber,
      p_count: count,
      p_difficulty_mode: difficultyMode,
      p_question_types: questionTypes,
    });
    if (!error && data) {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      const questions = Array.isArray(parsed) ? parsed : [];
      if (questions.length > 0) return questions;
    }
  } catch {
    // v2 RPC failed
  }

  // ── FALLBACK 3: direct question_bank query (v1) ──
  const v1Questions = await getQuizQuestions(subject, grade, count, diffMap[difficultyMode] ?? null, chapterNumber);
  // If edge function had partial results and v1 returned fewer, use the edge function's results
  // (they have dedup/history tracking already applied)
  if (edgeFunctionQuestions && edgeFunctionQuestions.length > v1Questions.length) {
    return edgeFunctionQuestions;
  }
  return v1Questions;
}

/* ── Update Chapter Progress (fire-and-forget after quiz) ── */
export async function updateChapterProgress(subject: string, grade: string, chapterNumber: number) {
  try {
    const studentId = await resolveStudentId();
    const { error } = await supabase.rpc('update_chapter_progress', {
      p_student_id: studentId,
      p_subject: subject,
      p_grade: grade,
      p_chapter_number: chapterNumber,
    });
    if (error) console.warn('update_chapter_progress failed:', error.message);
  } catch (e) {
    console.warn('update_chapter_progress RPC error:', e);
  }
}

/* ── Generate Exam Paper (structured exam from template) ── */
export async function generateExamPaper(
  subject: string,
  grade: string,
  chapters: number[],
  templateId: string | null = null
) {
  try {
    const studentId = await resolveStudentId();
    const { data, error } = await supabase.rpc('generate_exam_paper', {
      p_student_id: studentId,
      p_subject: subject,
      p_grade: grade,
      p_chapters: chapters,
      p_template_id: templateId,
    });
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('generateExamPaper:', e);
    throw e;
  }
}

/* ── NCERT Coverage Report ── */
export async function getNCERTCoverageReport(grade: string, subject?: string) {
  try {
    const studentId = await resolveStudentId();
    const { data, error } = await supabase.rpc('get_ncert_coverage_report', {
      p_student_id: studentId,
      p_grade: grade,
      p_subject: subject ?? null,
    });
    if (!error && data) return data;
    console.warn('get_ncert_coverage_report failed:', error?.message);
  } catch (e) {
    console.warn('get_ncert_coverage_report RPC error:', e);
  }
  return null;
}

/* ── Question History Stats (seen vs total for a chapter) ── */
export async function getQuestionHistoryStats(
  subject: string,
  grade: string,
  chapterNumber?: number | null
) {
  try {
    const studentId = await resolveStudentId();

    // Total questions available
    let totalQuery = supabase.from('question_bank')
      .select('*', { count: 'exact', head: true })
      .eq('subject', subject)
      .eq('grade', grade)
      .eq('is_active', true);
    if (chapterNumber != null) totalQuery = totalQuery.eq('chapter_number', chapterNumber);

    // Fetch question IDs for this subject/grade/chapter, then count
    // how many the student has already answered via question_responses
    let questionIdsQuery = supabase.from('question_bank')
      .select('id')
      .eq('subject', subject)
      .eq('grade', grade)
      .eq('is_active', true);
    if (chapterNumber != null) questionIdsQuery = questionIdsQuery.eq('chapter_number', chapterNumber);

    const [totalResult, questionIdsResult] = await Promise.all([
      totalQuery,
      questionIdsQuery,
    ]);

    const totalCount = totalResult.count ?? 0;
    const questionIds = (questionIdsResult.data ?? []).map(q => q.id);

    let seenCount = 0;
    if (questionIds.length > 0) {
      const { count } = await supabase.from('question_responses')
        .select('question_id', { count: 'exact', head: true })
        .eq('student_id', studentId)
        .in('question_id', questionIds);
      seenCount = count ?? 0;
    }

    return {
      total_questions: totalCount,
      seen_questions: seenCount,
      unseen_questions: totalCount - seenCount,
      coverage_percent: totalCount > 0 ? Math.round((seenCount / totalCount) * 100) : 0,
    };
  } catch (e) {
    console.error('getQuestionHistoryStats:', e);
    return { total_questions: 0, seen_questions: 0, unseen_questions: 0, coverage_percent: 0 };
  }
}


