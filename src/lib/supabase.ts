/**
 * @deprecated Import from '@/lib/supabase-client' for the pure client.
 * Import from '@/lib/domains/*' for data access functions.
 * This file exists for backward compatibility while the migration proceeds.
 *
 * MIGRATION STATUS: 51 importers remain (tracked in Phase C notes)
 * Do not add new imports from this file.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { XP_RULES } from './xp-config';
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

/* ── Concurrency helper (exported for tests) ── */
export async function mapWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency = 4,
): Promise<Array<{ ok: boolean; value?: R; err?: unknown }>> {
  const results: Array<{ ok: boolean; value?: R; err?: unknown }> = new Array(items.length);
  let i = 0;

  async function runner() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      try {
        const v = await worker(items[idx]);
        results[idx] = { ok: true, value: v };
      } catch (err) {
        results[idx] = { ok: false, err };
      }
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runner());
  await Promise.all(runners);
  return results;
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
    if (subjectRow) {
      query = query.eq('subject_id', subjectRow.id);
    } else {
      console.warn(
        '[getNextTopics] preferred_subject did not resolve to a subjects.code row; ' +
          'falling back to "any subject" for grade.',
        { studentId, subject, grade },
      );
    }
  }
  const { data, error } = await query;
  if (error) console.error('getNextTopics:', error.message);
  return data ?? [];
}

/* ── Foxy AI tutor chat ── */
export async function chatWithFoxy(params: { message: string; student_id: string; session_id?: string; subject?: string; grade: string; language: string; mode: string; }) {
  try {
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
  const params: Record<string, unknown> = { p_subject: subject, p_grade: grade, p_count: count };
  if (difficulty != null) params.p_difficulty = difficulty;
  if (chapterNumber != null) params.p_chapter_number = chapterNumber;
  try {
    const { data, error } = await supabase.rpc('get_quiz_questions', params);
    if (!error && data) return validateQuestions(data);
  } catch { /* RPC may not exist — fall back */ }

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

  const validated = validateQuestions(data ?? []);
  const unseen = validated.filter(q => !seenIds.has(q.id));
  const seen = validated.filter(q => seenIds.has(q.id));
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

    if (q.question_text.includes('{{') || q.question_text.includes('[BLANK]')) return false;

    const text = q.question_text.toLowerCase();
    if (text.includes('unrelated topic')) return false;
    if (text.startsWith('a student studying') && text.includes('should focus on')) return false;
    if (text.startsWith('which of the following best describes the main topic')) return false;
    if (text.startsWith('why is') && text.includes('important for grade')) return false;
    if (text.startsWith('the chapter') && text.includes('most closely related to which area')) return false;
    if (text.startsWith('what is the primary purpose of studying')) return false;

    const optTexts = opts.map((o: string) => (o || '').toLowerCase().trim());
    if (optTexts.some((o: string) =>
      o.includes('unrelated topic') || o.includes('physical education') ||
      o.includes('art and craft') || o.includes('music theory') ||
      o.includes('it is not important') || o.includes('no board exam')
    )) return false;

    if (new Set(optTexts).size < 3) return false;

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

    if (!q.explanation || q.explanation.length < 20) return false;

    if (q.explanation && q.question_text) {
      const explWords = q.explanation.toLowerCase().split(/\s+/);
      const qWords = q.question_text.toLowerCase().split(/\s+/);
      if (explWords.length < 8) return false; // too terse to be educational
    }

    const key = q.question_text.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);

    return true;
  });
}

/** ARCHITECTURAL CONTRACT -- DO NOT MODIFY WITHOUT REVIEW */
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

export interface QuizResponseV2 {
  question_id: string;
  selected_displayed_index: number;
  time_spent: number;
  error_type?: string;
  student_answer_text?: string;
  marks_awarded?: number;
  marks_possible?: number;
  rubric_feedback?: string;
}

const _quizDedup = new Set<string>();

type _RX = import('./types').QuizResponse & { error_type?: string; student_answer_text?: string; marks_awarded?: number; marks_possible?: number; rubric_feedback?: string };
function _mapV2(responses: import('./types').QuizResponse[]) {
  return responses.map(r => {
    const rx = r as _RX;
    return {
      question_id: r.question_id,
      selected_displayed_index: typeof (r as any).selected_option === 'number' ? (r as any).selected_option : Number((r as any).selected_opt),
      time_spent: r.time_spent,
      error_type: rx.error_type,
      student_answer_text: rx.student_answer_text,
      marks_awarded: rx.marks_awarded,
      marks_possible: rx.marks_possible,
      rubric_feedback: rx.rubric_feedback,
    } as QuizResponseV2;
  });
}

export async function submitQuizResults(studentId: string, subject: string, grade: string, topic: string, chapter: number, responses: import('./types').QuizResponse[], time: number, sessionId?: string) {
  const _k = `${studentId}:${subject}:${topic}:${responses.length}:${time}`;
  if (_quizDedup.has(_k)) return { duplicate: true };
  _quizDedup.add(_k); setTimeout(() => _quizDedup.delete(_k), 300_000);
  try {
    if (sessionId) {
      try {
        const v2 = await supabase.rpc('submit_quiz_results_v2', { p_session_id: sessionId, p_student_id: studentId, p_subject: subject, p_grade: grade, p_topic: topic, p_chapter: chapter, p_responses: responses, p_time: time });
        if (!v2.error && v2.data) return v2.data;
      } catch { /* fall through */ }
    }
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

    const total = responses.length;
    const correct = responses.filter(r => r.is_correct).length;
    const scorePct = calculateScorePercent(correct, total);
    const xpEarnedUncapped = calculateQuizXP(correct, scorePct);

    const { data: session, error: sessErr } = await supabase.from('quiz_sessions').insert({
      student_id: studentId, subject, grade, total_questions: total,
      correct_answers: correct, wrong_answers: total - correct,
      score_percent: scorePct, score: xpEarnedUncapped,
      time_taken_seconds: time, total_answered: total,
      is_completed: true, completed_at: new Date().toISOString(),
    }).select('id').single();
    if (sessErr) console.error('Fallback: quiz_sessions insert failed:', sessErr.message);

    let effectiveXp = xpEarnedUncapped;
    let xpCapped = false;
    try {
      const { data: rpcData } = await supabase.rpc('atomic_quiz_profile_update', {
        p_student_id: studentId,
        p_subject: subject,
        p_xp: xpEarnedUncapped,
        p_total: total,
        p_correct: correct,
        p_time_seconds: time,
      });
      if (rpcData && typeof rpcData === 'object') {
        const r = rpcData as Record<string, unknown>;
        if (typeof r.effective_xp === 'number') effectiveXp = r.effective_xp;
        if (typeof r.xp_capped === 'boolean') xpCapped = r.xp_capped;
      }
    } catch (atomicErr) {
      console.warn('atomic_quiz_profile_update failed, using non-atomic fallback:', atomicErr);
      await supabase.from('student_learning_profiles').upsert({
        student_id: studentId, subject, xp: xpEarnedUncapped,
        total_sessions: 1, total_questions_asked: total,
        total_questions_answered_correctly: correct,
        total_time_minutes: Math.max(1, Math.round(time / 60)),
        last_session_at: new Date().toISOString(),
        streak_days: 1, level: 1, current_level: 'beginner',
      }, { onConflict: 'student_id,subject' });
    }

    return {
      session_id: session?.id ?? '',
      total, correct, score_percent: scorePct,
      xp_earned: effectiveXp,
      xp_capped: xpCapped,
      xp_uncapped: xpEarnedUncapped,
    };
  } catch (err) {
    _quizDedup.delete(_k);
    throw err;
  }
}

export async function processAdaptiveLearning(
  studentId: string,
  subject: string,
  grade: string,
  responses: Array<{ question_id: string; is_correct: boolean; time_spent: number; selected_option: number; error_type?: string }>,
  questions: Array<{ id: string; chapter_number: number; difficulty: number; bloom_level: string }>,
  sessionId: string,
): Promise<void> {
  const { data: { session: authSession } } = await supabase.auth.getSession();
  const token = authSession?.access_token;
  if (!token) return;

  const questionMap = new Map(questions.map(q => [q.id, q]));

  const { data: subjectRow } = await supabase
    .from('subjects')
    .select('id')
    .eq('code', subject)
    .maybeSingle();
  if (!subjectRow) return;

  const chapterNumbers = new Set<number>();
  for (const q of questions) {
    if (typeof q.chapter_number === 'number' && q.chapter_number > 0) {
      chapterNumbers.add(q.chapter_number);
    }
  }

  const topicMap = new Map<number, string>();
  if (chapterNumbers.size > 0) {
    const { data: topics } = await supabase
      .from('curriculum_topics')
      .select('id, chapter_number')
      .eq('subject_id', subjectRow.id)
      .eq('grade', grade)
      .in('chapter_number', [...chapterNumbers])
      .is('parent_topic_id', null)
      .limit(50);
    if (topics) {
      for (const t of topics) {
        if (t.chapter_number != null && !topicMap.has(t.chapter_number)) {
          topicMap.set(t.chapter_number, t.id);
        }
      }
    }
  }

  // Build per-response payloads
  const payloads: Array<{
    action: string;
    concept_id: string;
    question_id: string;
    correct: boolean;
    difficulty: number;
    response_time_ms: number;
  }> = [];

  for (const response of responses) {
    const question = questionMap.get(response.question_id);
    if (!question) continue;

    const conceptId = topicMap.get(question.chapter_number);
    if (!conceptId) continue;

    payloads.push({
      action: 'record_response',
      concept_id: conceptId,
      question_id: response.question_id,
      correct: Boolean(response.is_correct),
      difficulty: question.difficulty ?? 2,
      response_time_ms: (response.time_spent ?? 10) * 1000,
    });
  }

  if (payloads.length === 0) return;

  // Configurable concurrency
  const concurrency = Number(process.env.CME_CONCURRENCY || '4');
  const retryEnabled = process.env.CME_RETRY_ENABLED !== 'false';

  // Worker with optional single retry for transient failures
  async function worker(pl: typeof payloads[number]) {
    const url = `${supabaseUrl}/functions/v1/cme-engine`;
    const doFetch = async () => {
      await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(pl),
      }, 5000);
      return true;
    };

    try {
      return await doFetch();
    } catch (err) {
      if (retryEnabled) {
        // simple backoff
        await new Promise(r => setTimeout(r, 200));
        return await doFetch();
      }
      throw err;
    }
  }

  const results = await mapWithConcurrency(payloads, worker, concurrency);

  const cmeFailureCount = results.filter(r => !r.ok).length;
  const cmeSuccessCount = results.filter(r => r.ok).length;

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
      });
    } catch {
      // non-fatal
    }
  }
}

export async function getLeaderboard(period = 'weekly', limit = 20) {
  try {
    const { data, error } = await supabase.rpc('get_leaderboard', { p_period: period, p_limit: limit });
    if (!error && data) return data;
  } catch { /* RPC may not exist */ }

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

  const today = new Date().toISOString().split('T')[0];
  const { data: cards } = await supabase.from('spaced_repetition_cards')
    .select('id, student_id, subject, topic, chapter_title, front_text, back_text, hint, source, ease_factor, interval_days, streak, repetition_count, total_reviews, correct_reviews, next_review_date')
    .eq('student_id', studentId)
    .lte('next_review_date', today)
    .order('next_review_date')
    .limit(limit);
  if (cards && cards.length > 0) {
    return cards.map(c => ({ ...c, topic: c.topic, chapter_title: c.chapter_title || c.topic }));
  }
  const { data } = await supabase.from('concept_mastery')
    .select('id, topic_id, ease_factor, mastery_probability, consecutive_correct, next_review_at')
    .eq('student_id', studentId)
    .lte('next_review_at', new Date().toISOString())
    .order('next_review_at')
    .limit(limit);
  return (data ?? []).map(cm => ({ ...cm, topic: cm.topic_id, front_text: '', back_text: '' }));
}

export const sendToFoxy = chatWithFoxy;

export async function getCmeNextAction(
  studentId: string,
  subject: string,
  grade: string
): Promise<import('./types').CmeAction | null> {
  try {
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
        apikey: supabaseAnonKey,
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
    return null;
  }
}

export async function getUserRole(authUserId: string) {
  const { data, error } = await supabase.rpc('get_user_role', { p_auth_user_id: authUserId });
  if (error) console.error('getUserRole:', error.message);
  return data;
}

// ... (rest of file unchanged) ...

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
  }

  // Parallel invocation: edge function + RPCs
  const edgePromise = (async () => {
    try {
      const { data: funcData, error: funcError } = await supabase.functions.invoke('quiz-generator', {
        body: {
          student_id: studentId,
          subject,
          grade,
          count,
          difficulty: diffMap[difficultyMode] ?? null,
          chapter_number: chapterNumber,
          ability_estimate: irtTheta,
        },
      });
      if (!funcError && funcData?.questions) {
        return Array.isArray(funcData.questions) ? funcData.questions : [];
      }
      return [];
    } catch {
      return [];
    }
  })();

  const rpcRagPromise = (async () => {
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
        return Array.isArray(parsed) ? parsed : [];
      }
      return [];
    } catch {
      return [];
    }
  })();

  const rpcV2Promise = (async () => {
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
        return Array.isArray(parsed) ? parsed : [];
      }
      return [];
    } catch {
      return [];
    }
  })();

  const settles = await Promise.allSettled([edgePromise, rpcRagPromise, rpcV2Promise]);

  const edgeRes = settles[0].status === 'fulfilled' ? (settles[0].value as unknown[]) : [];
  if (edgeRes && edgeRes.length >= count) return edgeRes;

  const rpcRagRes = settles[1].status === 'fulfilled' ? (settles[1].value as unknown[]) : [];
  if (rpcRagRes && rpcRagRes.length > 0) return rpcRagRes;

  const rpcV2Res = settles[2].status === 'fulfilled' ? (settles[2].value as unknown[]) : [];
  if (rpcV2Res && rpcV2Res.length > 0) return rpcV2Res;

  const v1Questions = await getQuizQuestions(subject, grade, count, diffMap[difficultyMode] ?? null, chapterNumber);
  if (edgeRes && edgeRes.length > v1Questions.length) return edgeRes;
  return v1Questions;
}
