/**
 * @deprecated Import from '@alfanumrik/lib/supabase-client' for the pure client.
 * Import from '@alfanumrik/lib/domains/*' for data access functions.
 * This file exists for backward compatibility while the migration proceeds.
 *
 * MIGRATION STATUS: 51 importers remain (tracked in Phase C notes)
 * Do not add new imports from this file.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { XP_RULES } from './xp-config';
import {
  ADAPTIVE_LIVE_SELECTION_FLAGS,
  IRT_SELECTION_FLAGS,
  isFeatureEnabled,
} from './feature-flags';
import {
  selectAdaptiveQuestions,
  type AdaptiveClient,
} from './adaptive/select-adaptive-questions';
import { humaneCardLabel } from './srs-card-label';
import type {
  MasteryOverviewRow,
  MasteryOverviewResponse,
} from './dashboard/mastery-buckets';
import { buildFallbackStudentSnapshot, normalizeStudentSnapshot } from './student-snapshot';
// ServiceResult is the canonical result shape for data reads in this codebase
// (see packages/lib/src/domains/types.ts — every `domains/*` module returns it).
// The read helpers below used to `console.error(...)` the PostgREST error and
// then `return data ?? []`, which made a FAILED read structurally
// indistinguishable from a genuinely-empty one: `supabase.rpc()` and the query
// builder RESOLVE with `{ data, error }`, they never reject, so a caller's
// `.catch()` was dead code and its `[]` was ambiguous. /progress showed a
// student "No knowledge gaps detected!" — a clean bill of academic health —
// after the request had 500'd. Reads that carry that ambiguity now return
// ServiceResult so the caller MUST decide (the union makes `.data`
// inaccessible until `ok` is checked). Only the helpers whose emptiness is
// user-visible have been converted so far; see the TODO(backend) below.
import { ok, fail, type ServiceResult } from './domains/types';
// NOTE (P10): the canonical P6 gate `./quiz/question-validation` is imported
// DYNAMICALLY inside validateQuestions() below, not statically here. This file
// is in the module graph of nearly every page; a static import puts the full
// strict-union validator (+ reason-string machinery) into every page's
// first-load bundle and breached the per-page ratchet on two routes (PR #1415).
// The delegation target is unchanged — do NOT re-inline a validator here (P6
// anti-fork canary enforces this).
import { shuffle } from './shuffle';

// Re-export from the canonical client module — new code uses supabase-client.ts
export { supabase, supabaseUrl, supabaseAnonKey } from './supabase-client';

// Internal: import client for use by the data functions below (the URL/key
// constants are no longer needed here since the cme-engine fetch-outs were
// deleted — tracker E1; they remain re-exported above for external consumers)
import { supabase } from './supabase-client';

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
    if (!error && data) return normalizeStudentSnapshot(data);
  } catch { /* RPC may not exist — fall back */ }

  const [profilesResult, masteredResult, inProgressResult, quizzesResult] = await Promise.all([
    supabase.from('student_learning_profiles').select('*').eq('student_id', studentId),
    supabase.from('concept_mastery').select('*', { count: 'exact', head: true }).eq('student_id', studentId).gte('mastery_probability', 0.95),
    supabase.from('concept_mastery').select('*', { count: 'exact', head: true }).eq('student_id', studentId).lt('mastery_probability', 0.95).gt('mastery_probability', 0),
    supabase.from('quiz_sessions').select('*', { count: 'exact', head: true }).eq('student_id', studentId),
  ]);
  return buildFallbackStudentSnapshot({ profilesResult, masteredResult, inProgressResult, quizzesResult });
}

/* ── Read helpers NOT yet converted to ServiceResult ──────────────────────────
 * Every helper named below still collapses a failed read into `[]` / `null` /
 * a zero-filled object, i.e. it still carries the ambiguity described above.
 * They are UNCONVERTED, not exonerated.
 *
 * The criterion that ordered the work is NOT "does this feed a reassuring
 * surface". An earlier revision of this comment asserted that none of the
 * remaining helpers did — that claim was FALSE when it was written:
 * getStudentNotifications fed /notifications' "No notifications yet" the whole
 * time it sat on the deferred list. The real criterion is:
 *
 *   Does any LIVE caller render this helper's empty result as an ASSERTION —
 *   a sentence that becomes false the moment the read fails — rather than by
 *   omitting a section?
 *
 * Converted because a live caller asserts (each carries its own note below):
 *   getLeaderboard, getCompetitions, getCompetitionLeaderboard, getHallOfFame,
 *   getStudentNotifications, getReviewCards, getChapterTopics,
 *   getChapterQuestions.
 *
 * Still unconverted, reason verified caller-by-caller (2026-08-09):
 *
 *   NO LIVE CALLER — exported but imported by nothing except `typeof` smoke
 *   tests, so no surface can assert anything from them yet. Convert when a
 *   caller appears; do NOT read "no caller" as "safe":
 *     getBoardPapers, getUserRole, getTeacherDashboard, getClassDetail,
 *     getAssignmentReport, getGuardianDashboard, getCurriculumBrowser,
 *     getUnreadNotifications, getNCERTCoverageReport, getQuestionHistoryStats.
 *
 *   OMITS A SECTION rather than asserting anything:
 *     getFeatureFlags     — a failed read leaves every flag false, so gated
 *                           features stay hidden; nothing is claimed about the
 *                           student. ~30 call sites all read `flags?.x === true`;
 *                           converting them is its own change.
 *     getTopicDiagrams    — deferred Phase-2 enrichment on the chapter page; an
 *                           empty list renders no diagram strip at all.
 *     getPendingParentLinks — an empty list renders no consent card. Its
 *                           fail-soft is deliberate and documented at the
 *                           helper (P15: a hiccup must never block the
 *                           dashboard).
 *
 * Already honest, hence absent from both lists: getMasteryOverview reports
 * `coverage: 'not_tracked'` on failure, and getStudentSnapshot's fallback
 * builder returns null (never 0) for each count whose query errored. */

/* ── Student learning profiles ──
 * Query shape is load-bearing: /progress derives XP, accuracy and session
 * counts from these rows, so table / select / eq / order must not change. */
export async function getStudentProfiles(studentId: string): Promise<ServiceResult<any[]>> {
  const { data, error } = await supabase.from('student_learning_profiles').select('*').eq('student_id', studentId).order('xp', { ascending: false });
  if (error) return fail(`getStudentProfiles: ${error.message}`, 'DB_ERROR');
  return ok(data ?? []);
}

/* ── Subjects list ── */
export async function getSubjects(): Promise<ServiceResult<any[]>> {
  const { data, error } = await supabase.from('subjects').select('*').eq('is_active', true).order('display_order');
  if (error) return fail(`getSubjects: ${error.message}`, 'DB_ERROR');
  return ok(data ?? []);
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

/**
 * States of `question_bank.verification_state` that mean the automated NCERT
 * verifier DISPROVED the row (or is mid-repair on a disproved row). A
 * disproved question must never reach a student — there is no fallback rung
 * that relaxes this (migration 20260802100000, spec §3.4).
 *
 * NOTE (assessment, 2026-08-11): the Tier-0 predicate inside
 * `select_quiz_questions_rag` excludes only the literal `'failed'`. The
 * constraint was widened to six states by migration 20260510064952
 * (`failed_fix_in_flight`, `failed_unfixable`), so those two disproved states
 * still pass that RPC's gate. This list is the complete one; the RPC-side gap
 * is reported separately and is an architect/DB fix.
 */
const DISPROVED_VERIFICATION_STATES = [
  'failed',
  'failed_fix_in_flight',
  'failed_unfixable',
] as const;

export async function getQuizQuestions(subject: string, grade: string, count = 10, difficulty?: number | null, chapterNumber?: number | null) {
  // Try RPC first, fall back to direct query
  const params: Record<string, unknown> = { p_subject: subject, p_grade: grade, p_count: count };
  if (difficulty != null) params.p_difficulty = difficulty;
  if (chapterNumber != null) params.p_chapter_number = chapterNumber;
  try {
    const { data, error } = await supabase.rpc('get_quiz_questions', params);
    // An EMPTY ARRAY IS TRUTHY in JavaScript. `get_quiz_questions` returns
    // `COALESCE(jsonb_agg(q), '[]'::JSONB)` and filters `is_verified = true`
    // (migration 20260505155525), so a chapter whose questions are all
    // unverified came back as `[]` — which satisfied the old `data` guard and
    // RETURNED ZERO QUESTIONS to the student, never reaching the
    // direct-`question_bank` fallback below. The RPC applies a strictly
    // NARROWER filter than the fallback, so "RPC found none" does not imply
    // "the bank has none": only a NON-EMPTY result may short-circuit the
    // ladder. (Contrast getLeaderboard/getReviewCards below, where the RPC and
    // its fallback query the same population and empty IS the final answer.)
    if (!error && Array.isArray(data) && data.length > 0) {
      const validated = await validateQuestions(data);
      if (validated.length > 0) return validated;
      // Every row the RPC returned failed the P6 gate. Serving `[]` here would
      // be the same silent-zero. Fall through and re-run the SAME gate over the
      // wider pool — the gate is not relaxed anywhere on this path.
      console.warn(
        `get_quiz_questions returned ${data.length} row(s), all rejected by the P6 gate — falling through to question_bank`,
      );
    } else if (!error) {
      console.warn('get_quiz_questions returned no verified rows — falling through to question_bank');
    }
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

  // Direct table query fallback — fetch more to ensure enough unseen questions.
  //
  // TIER-0 FLOOR (added 2026-08-11 with the truthy-`[]` fix above): this rung
  // is now genuinely reachable, so it must enforce the same never-serve floor
  // the rung above it enforces (`select_quiz_questions_rag`, migration
  // 20260802100000 §2.1): not soft-deleted, not draft/review/archived, not
  // verifier-disproved. Previously this query filtered `is_active` only, so a
  // soft-deleted or verifier-DISPROVED row was servable here.
  //
  // These predicates only ever REMOVE rows — this is a narrowing, not a
  // relaxation. `is_verified` (the human SME flag) is deliberately NOT filtered
  // here: neither this rung nor either RPC rung above it has ever gated serving
  // on it (20260802100000 records it as "ranking/administrative metadata only"),
  // and adding it would simply re-create the empty quiz this fix removes.
  // Whether SME sign-off should gate serving at all is a CEO decision
  // (Decision A, 2026-08-11 content brief), not something to settle here.
  //
  // `content_status` is nullable with DEFAULT 'published', so it is matched by
  // "NULL or published" rather than strict equality: a strict `eq` would drop
  // every legacy row that carries an explicit NULL and could silently re-empty
  // the very quizzes this fix restores. Census before tightening:
  //   SELECT content_status, count(*) FROM question_bank
  //    WHERE is_active AND deleted_at IS NULL GROUP BY 1;
  // `verification_state` is NOT NULL, so plain `neq` is safe there.
  const fetchLimit = Math.min(count * 4, 120);
  let query = supabase.from('question_bank')
    .select('id, question_text, question_hi, question_type, options, correct_answer_index, explanation, explanation_hi, hint, difficulty, bloom_level, chapter_number')
    .eq('subject', subject)
    .eq('grade', grade)
    .eq('is_active', true)
    .is('deleted_at', null)
    .or('content_status.is.null,content_status.eq.published')
    .limit(fetchLimit);
  for (const state of DISPROVED_VERIFICATION_STATES) {
    query = query.neq('verification_state', state);
  }
  if (difficulty != null) query = query.eq('difficulty', difficulty);
  if (chapterNumber != null) query = query.eq('chapter_number', chapterNumber);
  const { data, error } = await query;
  if (error) throw error;

  // Validate, deduplicate, prefer unseen questions, shuffle, and trim to count
  const validated = await validateQuestions(data ?? []);
  const unseen = validated.filter(q => !seenIds.has(q.id));
  const seen = validated.filter(q => seenIds.has(q.id));
  // Prioritize unseen, then backfill with seen if pool is too small.
  // Fisher-Yates via the canonical shuffle — the previous
  // `.sort(() => Math.random() - 0.5)` was a non-transitive comparator that
  // barely permuted the rows, so the `.slice(0, count)` below kept serving
  // whichever questions the query returned first.
  const pool = [...shuffle(unseen), ...shuffle(seen)];
  return pool.slice(0, count);
}

/**
 * Filter out broken, duplicate, or template questions before they reach
 * students.
 *
 * The implementation that used to live here has been DELETED and replaced by
 * the single canonical P6 gate at
 * `packages/lib/src/quiz/question-validation.ts`, which is the strict union of
 * the three copies that had drifted apart (this one, `quiz-assembler.ts`, and
 * `domains/quiz.ts`). This copy contributed the full garbage-text pattern set,
 * the "exactly 4 DISTINCT options" rule and the explanation word-count floor.
 *
 * `allowNonMcq` stays at its default (false), preserving this path's existing
 * posture: MCQ shape is required for every row regardless of question_type.
 *
 * `enforceBloomLevel` stays at its default (false) too, so this path's posture
 * is likewise unchanged: it never validated `bloom_level` and still does not.
 * The direct `question_bank` query in `getQuizQuestions()` does not filter the
 * column either, and the column is nullable with no CHECK — rejecting on it
 * here would silently shrink live quizzes. See the option's TODO(assessment).
 */
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

async function validateQuestions(questions: QuestionRecord[]): Promise<QuestionRecord[]> {
  // Dynamic import (P10): keeps the canonical gate out of the shared first-load
  // bundle; only the question-fetch path loads it, at call time. Same canonical
  // module, same defaults (allowNonMcq: false, enforceBloomLevel: false).
  const { validateQuestions: validateQuestionsP6 } = await import('./quiz/question-validation');
  return validateQuestionsP6(questions);
}

/**
 * ARCHITECTURAL CONTRACT -- DO NOT MODIFY WITHOUT REVIEW
 *
 * Quiz submission MUST update adaptive learning state. This happens
 * SERVER-SIDE, in the RPC:
 *   submit_quiz_results RPC -> update_learner_state_post_quiz()
 *   Updates: concept_mastery (BKT), bloom_progression, spaced_repetition,
 *            error classification, retention half-life, streak, CME action
 *   Requires: question_bank.topic_id IS NOT NULL (currently 99.9% populated)
 *   Guarded by: IF v_q_topic_id IS NOT NULL THEN ... END IF
 *
 * HISTORY (Foxy North-Star Phase 2 wave 2b, tracker E1, 2026-08-05):
 *   The former client-side "Layer 2 backup" — processAdaptiveLearning()
 *   fanning out to the cme-engine Edge Function's record_response, writing
 *   the parallel retired cme store — was DELETED. It had zero live
 *   callers (the quiz page stopped calling it when CME mastery moved
 *   server-side; see adaptive-pipeline.test.ts) and its target table is
 *   COMMENT-tombstoned as RETIRED (migration 20260808000100).
 *   getCmeNextAction() (cme-engine get_next_action) was deleted in the same
 *   pass — its replacement is the pure deriveNextAction ladder in
 *   @alfanumrik/lib/learner-model. Do NOT re-add client-side mastery writes.
 *
 * INVARIANT: Every quiz submission MUST flow through submitQuizResults() so
 * the server-side RPC chain updates learner state.
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
 * Screen "07 Practice" immediate per-question feedback (migration
 * 20260802130000). Calls check_quiz_answer, which reveals is_correct /
 * correct_displayed_index / explanation for EXACTLY ONE question from the
 * server-owned quiz_session_shuffles snapshot — never from live
 * question_bank, never leaking any other question's answer in the same
 * response. Matches the direct-RPC calling convention already used by
 * startQuizSession/submitQuizResults in this file (no API-route wrapper —
 * the web /quiz page calls Supabase RPCs directly).
 *
 * PERSIST-IMMEDIATELY: the RPC also writes the student's selected index +
 * time spent onto the same quiz_session_shuffles row so progress survives a
 * crash before final submit. This function does NOT touch XP/profile state
 * — that remains submitQuizResults()'s job at final submit, unchanged.
 *
 * Idempotent/replay-locked server-side: a second call for an
 * already-answered question replays the FIRST verdict rather than grading a
 * new guess (defense-in-depth only). The CALLER (the quiz page's state
 * machine) is still responsible for never allowing a second confirm click
 * on an already-revealed question — this function does not enforce that,
 * it only cannot be gamed if the caller's guard is ever bypassed.
 *
 * Returns null on any failure (RPC error, malformed response) so the caller
 * can fall back to the existing "Submitted — check results at end" neutral
 * state rather than blocking the quiz flow.
 */
export interface QuizAnswerCheck {
  question_id: string;
  is_correct: boolean;
  correct_displayed_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  already_answered: boolean;
}
export async function checkQuizAnswer(
  sessionId: string,
  questionId: string,
  selectedDisplayedIndex: number,
  timeSpentSeconds?: number,
): Promise<QuizAnswerCheck | null> {
  try {
    const { data, error } = await supabase.rpc('check_quiz_answer', {
      p_session_id: sessionId,
      p_question_id: questionId,
      p_selected_displayed_index: selectedDisplayedIndex,
      p_time_spent_seconds: timeSpentSeconds ?? null,
    });
    if (error) {
      console.warn('check_quiz_answer RPC failed:', error.message);
      return null;
    }
    if (!data || typeof data !== 'object') return null;
    const parsed = (typeof data === 'string' ? JSON.parse(data) : data) as Partial<QuizAnswerCheck>;
    if (typeof parsed?.is_correct !== 'boolean' || typeof parsed?.correct_displayed_index !== 'number') {
      return null;
    }
    return parsed as QuizAnswerCheck;
  } catch (e) {
    console.warn('check_quiz_answer error:', e);
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
  /**
   * Foxy North-Star F8 (2026-08-05): highest hint tier used on this question
   * (0 = none, 1-3). Optional — undefined → SQL NULL. Persisted to
   * quiz_responses.hint_level by submit_quiz_results_v2 (telemetry only).
   */
  hint_level?: number;
  /**
   * Foxy North-Star Phase 2 wave 2b (tracker E, 2026-08-05): additive
   * evidence-capture companions (migration 20260807000200). Optional —
   * undefined → SQL NULL. Telemetry only: no scoring/XP/anti-cheat input.
   */
  confidence?: number;
  answer_method?: string;
}

// Dedup guard: prevents double-click / SWR retry from re-submitting a quiz (5 min window).
const _quizDedup = new Set<string>();

// v2 response mapper -- strips is_correct + shuffle_map; server re-derives both from snapshot.
type _RX = import('./types').QuizResponse & { error_type?: string; student_answer_text?: string; marks_awarded?: number; marks_possible?: number; rubric_feedback?: string };
function _mapV2(responses: import('./types').QuizResponse[]) {
  // hint_level (F8, 2026-08-05): additive optional pass-through — undefined is
  // dropped by JSON serialization and lands as SQL NULL in the RPC.
  // confidence + answer_method (wave 2b, 2026-08-05): same additive pattern —
  // per-response evidence capture; undefined → dropped → SQL NULL.
  return responses.map(r => { const rx = r as _RX; return { question_id: r.question_id, selected_displayed_index: typeof r.selected_option === 'number' ? r.selected_option : Number(r.selected_option), time_spent: r.time_spent, error_type: rx.error_type, student_answer_text: rx.student_answer_text, marks_awarded: rx.marks_awarded, marks_possible: rx.marks_possible, rubric_feedback: rx.rubric_feedback, hint_level: r.hint_level, confidence: r.confidence, answer_method: r.answer_method }; });
}

/**
 * ARCHITECTURAL CONTRACT (post-audit-2026-08-06) -- DO NOT MODIFY WITHOUT REVIEW
 *
 * submitQuizResults uses the single canonical v2 RPC path.
 * P0-1/P0-2 remediation: v1 L2 fallback and L3 client-side scoring removed.
 * The v1 RPC submit_quiz_results returns a deprecation error when
 * ff_v1_quiz_rpc_blocked is ON. Server routes are the canonical entry points.
 */
export async function submitQuizResults(studentId: string, subject: string, grade: string, topic: string, chapter: number, responses: import('./types').QuizResponse[], time: number, sessionId?: string | null) {
  const _k = `${studentId}:${subject}:${topic}:${responses.length}:${time}`;
  if (_quizDedup.has(_k)) return { duplicate: true };
  _quizDedup.add(_k); setTimeout(() => _quizDedup.delete(_k), 300_000);
  try {
    const v2 = await supabase.rpc('submit_quiz_results_v2', {
      p_session_id: sessionId,
      p_student_id: studentId,
      p_subject: subject,
      p_grade: grade,
      p_topic: topic,
      p_chapter: chapter,
      p_responses: _mapV2(responses),
      p_time: time,
    });
    if (!v2.error && v2.data) return v2.data;
    throw new Error(v2.error?.message || 'Quiz submission failed.');
  } catch (err) {
    _quizDedup.delete(_k);
    throw err;
  }
}

// processAdaptiveLearning() was DELETED here (tracker E1, 2026-08-05) — see
// the ARCHITECTURAL CONTRACT HISTORY note above submitQuizResults. Adaptive
// learner state is updated exclusively server-side inside the submit RPC
// chain (update_learner_state_post_quiz).

/**
 * /leaderboard's rankings tab renders an empty result as "No rankings yet" —
 * an assertion about the cohort that is false after a failed read. Same defect
 * class as /progress's all-clear, so a failure is now reported.
 *
 * The RPC → direct-query ladder is a DEGRADATION path, not a failure path
 * (identical to getStudyPlan): an RPC error still falls through to the direct
 * query exactly as before, and only a failure of the FALLBACK is reported.
 *
 * P2: the row mapping below is untouched — same columns, same order, same
 * rank/total_xp derivation.
 */
export async function getLeaderboard(period = 'weekly', limit = 20): Promise<ServiceResult<any[]>> {
  try {
    const { data, error } = await supabase.rpc('get_leaderboard', { p_period: period, p_limit: limit });
    if (!error && data) return ok(data);
  } catch { /* RPC may not exist */ }

  // Fallback: direct query
  const since = new Date();
  since.setDate(since.getDate() - (period === 'monthly' ? 30 : 7));
  const { data, error } = await supabase.from('students')
    .select('id, name, xp_total, streak_days, avatar_url, grade, school_name, city, board')
    .eq('is_active', true)
    .gte('last_active', since.toISOString())
    .order('xp_total', { ascending: false })
    .limit(limit);
  if (error) return fail(`getLeaderboard: ${error.message}`, 'DB_ERROR');
  return ok((data ?? []).map((s, i) => ({
    rank: i + 1, student_id: s.id, name: s.name,
    total_xp: s.xp_total ?? 0, streak: s.streak_days ?? 0,
    avatar_url: s.avatar_url, grade: s.grade,
    school: s.school_name, city: s.city, board: s.board,
  })));
}

/**
 * `has_plan: false` drives /exam-prep's "Generate your AI Study Plan" screen,
 * so it must only ever mean "this student genuinely has no active plan" —
 * telling a student who HAS a plan that they have none is the same defect
 * class as /progress's false all-clear. A failed read is now reported instead.
 *
 * The RPC → direct-query ladder is a DEGRADATION path, not a failure path: an
 * RPC error still falls through to the direct query exactly as before, and
 * only a failure of the fallback is reported to the caller.
 */
export async function getStudyPlan(studentId: string): Promise<ServiceResult<any>> {
  try {
    const { data, error } = await supabase.rpc('get_study_plan', { p_student_id: studentId });
    if (!error && data) return ok(data);
  } catch { /* RPC may not exist */ }

  // Fallback: direct query
  const { data: plan, error: planError } = await supabase.from('study_plans')
    .select('*')
    .eq('student_id', studentId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  // PGRST116 = ".single() matched no rows" — the legitimate "no active plan
  // yet" case, NOT a failure. Every other PostgREST error IS one.
  if (planError && planError.code !== 'PGRST116') {
    return fail(`getStudyPlan: ${planError.message}`, 'DB_ERROR');
  }
  if (!plan) return ok({ has_plan: false });

  const { data: tasks, error: tasksError } = await supabase.from('study_plan_tasks')
    .select('*')
    .eq('plan_id', plan.id)
    .order('day_number')
    .order('task_order');
  if (tasksError) return fail(`getStudyPlan: ${tasksError.message}`, 'DB_ERROR');

  return ok({ has_plan: true, plan, tasks: tasks ?? [] });
}

/**
 * RevisionRail (the Alfa-OS dashboard rail) renders an empty result as
 * "Nothing due right now — nice work." — a claim about the student's revision
 * debt that is false after a failed read. It already HAS an error branch; that
 * branch was unreachable while this helper resolved failures to `[]`, because
 * SWR only sets `error` when the fetcher rejects. Reporting the failure here is
 * what makes it reachable (see useReviewCards in swr.tsx).
 *
 * The RPC → spaced_repetition_cards → concept_mastery ladder is a DEGRADATION
 * path: an RPC error still falls through exactly as before. Only a failure of
 * a fallback query is reported.
 */
export async function getReviewCards(studentId: string, limit = 10): Promise<ServiceResult<any[]>> {
  try {
    const { data, error } = await supabase.rpc('get_review_cards', { p_student_id: studentId, p_limit: limit });
    if (!error && data) return ok(data);
  } catch { /* RPC may not exist */ }

  // Fallback: use spaced_repetition_cards if available, else concept_mastery
  const today = new Date().toISOString().split('T')[0]; // next_review_date is DATE type
  const { data: cards, error: cardsError } = await supabase.from('spaced_repetition_cards')
    .select('id, student_id, subject, topic, chapter_title, front_text, back_text, hint, source, ease_factor, interval_days, streak, repetition_count, total_reviews, correct_reviews, next_review_date, last_review_date, created_at')
    .eq('student_id', studentId)
    .lte('next_review_date', today)
    .order('next_review_date')
    .limit(limit);
  if (cardsError) return fail(`getReviewCards: ${cardsError.message}`, 'DB_ERROR');
  if (cards && cards.length > 0) {
    // Display hardening: quiz-review cards write `topic` as the machine
    // composite dedupe key (subject:chapter:question_id). When chapter_title
    // is missing (legacy rows), humaneCardLabel converts the composite key to
    // `subject · Chapter N` and passes human-readable topics (Foxy cards)
    // through untouched — a student must never see the raw key/uuid.
    return ok(cards.map(c => ({
      ...c,
      topic: c.topic,
      chapter_title: c.chapter_title || humaneCardLabel(c.topic),
    })));
  }
  // Final fallback: concept_mastery (limited columns)
  const { data, error: masteryError } = await supabase.from('concept_mastery')
    .select('id, topic_id, ease_factor, mastery_probability, consecutive_correct, next_review_at')
    .eq('student_id', studentId)
    .lte('next_review_at', new Date().toISOString())
    .order('next_review_at')
    .limit(limit);
  if (masteryError) return fail(`getReviewCards: ${masteryError.message}`, 'DB_ERROR');
  return ok((data ?? []).map(cm => ({ ...cm, topic: cm.topic_id, front_text: '', back_text: '' })));
}

export const sendToFoxy = chatWithFoxy;

// getCmeNextAction() was DELETED here (tracker E1, 2026-08-05) — zero callers.
// Its replacement is the pure deriveNextAction ladder in
// @alfanumrik/lib/learner-model (no network call, no cme-engine).

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

// Pending guardian↔child link requests for the signed-in student. Powers the
// PendingLinkApproval card on the dashboard (consent gate — student approves a
// parent_login request before any data is shared). Fail-soft: returns [] on
// error so a hiccup never blocks the dashboard (P15). Maps the RPC's row shape
// to the PendingLink shape the card consumes.
export interface PendingParentLink {
  id: string;
  parentName: string;
  requestedAt: string;
}

export async function getPendingParentLinks(studentAuthId: string): Promise<PendingParentLink[]> {
  const { data, error } = await supabase.rpc('get_pending_link_requests', { p_student_auth_id: studentAuthId });
  if (error) {
    console.error('getPendingParentLinks:', error.message);
    return [];
  }
  const requests =
    (data as { requests?: Array<{ link_id: string; guardian_name: string | null; requested_at: string }> } | null)
      ?.requests ?? [];
  return requests.map((r) => ({
    id: r.link_id,
    parentName: r.guardian_name || 'Parent',
    requestedAt: r.requested_at,
  }));
}

export async function getCurriculumBrowser(grade: string, subject?: string) {
  const { data, error } = await supabase.rpc('get_curriculum_browser', { p_grade: grade, p_subject: subject ?? null });
  if (error) console.error('getCurriculumBrowser:', error.message);
  return data;
}

export async function getMasteryOverview(studentId: string, subject?: string): Promise<MasteryOverviewResponse> {
  const { data, error } = await supabase.rpc('get_mastery_overview', { p_student_id: studentId, p_subject: subject ?? null });
  if (error) {
    console.error('getMasteryOverview:', error.message);
    // RPC failure — nothing can be distinguished, so never attribute any
    // emptiness to the student (D3/A `not_tracked`).
    return { rows: [], coverage: 'not_tracked' };
  }
  // Post-migration shape (D3/A backend signal):
  //   { rows: [...], coverage: 'ok' | 'no_activity' | 'no_curriculum' }
  if (data && typeof data === 'object' && !Array.isArray(data) && 'rows' in data) {
    return data as MasteryOverviewResponse;
  }
  // Legacy pre-migration shape: a bare array of topic rows. An empty array can
  // only mean "no activity" here — the old RPC could not distinguish a
  // curriculum-coverage gap from a student with zero attempts.
  const rows = (data as MasteryOverviewRow[] | null) ?? [];
  return { rows, coverage: rows.length === 0 ? 'no_activity' : 'ok' };
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

/* ── Competitions & Olympiads ──
 * All three reads below feed /leaderboard tabs whose empty state is an
 * assertion, not an omission: "No competitions right now", "No scores yet.
 * Take a quiz to compete!", and the Hall of Fame's "Finish in the Top 3 …".
 * Each of those is false when the read failed, so failure is reported. */
export async function getCompetitions(studentId: string, status?: string): Promise<ServiceResult<any[]>> {
  const { data, error } = await supabase.rpc('get_competitions', { p_student_id: studentId, p_status: status || null });
  if (error) return fail(`getCompetitions: ${error.message}`, 'DB_ERROR');
  return ok(data ?? []);
}

export async function joinCompetition(studentId: string, competitionId: string) {
  const { data, error } = await supabase.rpc('join_competition', { p_student_id: studentId, p_competition_id: competitionId });
  if (error) throw error;
  return data;
}

export async function getCompetitionLeaderboard(competitionId: string, limit = 50): Promise<ServiceResult<any[]>> {
  const { data, error } = await supabase.rpc('get_competition_leaderboard', { p_competition_id: competitionId, p_limit: limit });
  if (error) return fail(`getCompetitionLeaderboard: ${error.message}`, 'DB_ERROR');
  return ok(data ?? []);
}

export async function getHallOfFame(limit = 30): Promise<ServiceResult<any[]>> {
  const { data, error } = await supabase.rpc('get_hall_of_fame', { p_limit: limit });
  if (error) return fail(`getHallOfFame: ${error.message}`, 'DB_ERROR');
  return ok(data ?? []);
}

/* ── Notifications (Duolingo-style) ──
 * Confirmed instance of the /progress defect, found by quality review after the
 * first half of this sweep shipped: /notifications rendered "No notifications
 * yet" / "अभी तक कोई सूचना नहीं" whenever this RPC failed, and the page's own
 * `catch` was dead code because supabase.rpc() resolves rather than rejects.
 * Both failure modes — a resolved `{ error }` and a thrown exception — are now
 * reported. Query shape is unchanged: same RPC, same params. */
export interface StudentNotificationsPayload {
  unread_count: number;
  notifications: any[];
}

export async function getStudentNotifications(
  studentId: string,
  limit = 30,
): Promise<ServiceResult<StudentNotificationsPayload>> {
  try {
    const { data, error } = await supabase.rpc('get_student_notifications', { p_student_id: studentId, p_limit: limit });
    if (error) return fail(`getStudentNotifications: ${error.message}`, 'DB_ERROR');
    // A JSONB RPC answering NULL has nothing to report — that is a genuine
    // "no notifications", not a failure, so the empty path stays reachable and
    // stays DISTINCT from the failure above.
    return ok((data as StudentNotificationsPayload | null) ?? { unread_count: 0, notifications: [] });
  } catch (e) {
    return fail(
      `getStudentNotifications: ${e instanceof Error ? e.message : String(e)}`,
      'EXTERNAL_FAILURE',
    );
  }
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
export async function getBloomProgression(studentId: string, subject?: string): Promise<ServiceResult<any[]>> {
  const params: Record<string, unknown> = { p_student_id: studentId };
  if (subject) params.p_subject = subject;
  const { data, error } = await supabase.rpc('get_bloom_progression', params);
  if (error) return fail(`getBloomProgression: ${error.message}`, 'DB_ERROR');
  return ok(data ?? []);
}

/* ── Knowledge Gaps ──
 * The highest-stakes read in this file: its empty result renders as the
 * reassuring "No knowledge gaps detected!". An empty array here must therefore
 * only ever mean "the RPC succeeded and found none". */
export async function getKnowledgeGaps(studentId: string, subject?: string, limit = 10): Promise<ServiceResult<any[]>> {
  const params: Record<string, unknown> = { p_student_id: studentId, p_limit: limit };
  if (subject) params.p_subject = subject;
  const { data, error } = await supabase.rpc('get_knowledge_gaps', params);
  if (error) return fail(`getKnowledgeGaps: ${error.message}`, 'DB_ERROR');
  return ok(data ?? []);
}

/* ── Learning Velocity ── */
export async function getLearningVelocity(studentId: string, subject?: string): Promise<ServiceResult<any[]>> {
  let query = supabase.from('learning_velocity').select('*').eq('student_id', studentId);
  if (subject) query = query.eq('subject', subject);
  const { data, error } = await query.order('updated_at', { ascending: false }).limit(20);
  if (error) return fail(`getLearningVelocity: ${error.message}`, 'DB_ERROR');
  return ok(data ?? []);
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
/**
 * /learn/[subject]/[chapter] renders an empty result as "No concepts found for
 * this chapter yet" + "Ask Foxy to teach you this chapter" — an assertion about
 * what NCERT content exists, which is false when the RAG read failed. The page
 * already has a retryable "Couldn't load this chapter" branch; reporting the
 * failure here is what routes a failed read to it instead of to the empty copy.
 *
 * The RAG read is the source of truth and IS reported. The curriculum_topics
 * read below stays a soft degradation: it only supplies a legacy topic id to
 * match against, so losing it changes no rendered sentence.
 */
export async function getChapterTopics(
  subject: string,
  grade: string,
  chapterNumber: number,
): Promise<ServiceResult<any[]>> {
  // Voyage RAG source of truth. curriculum_topics is legacy and will be removed
  // after chapter_concepts + rag_content_chunks fully supersede it.
  const ragGrade = grade.startsWith('Grade') ? grade : `Grade ${grade}`;
  const { data: ragSubjectRow } = await supabase.rpc('subject_code_to_rag_name', { p_code: subject });
  const ragSubject = typeof ragSubjectRow === 'string' && ragSubjectRow ? ragSubjectRow : subject;

  const [ragResult, subjectRow] = await Promise.all([
    supabase.rpc('get_chapter_rag_content', {
      p_grade: ragGrade,
      p_subject: ragSubject,
      p_chapter_number: chapterNumber,
      p_content_type: null,
    }),
    supabase
      .from('subjects')
      .select('id')
      .eq('code', subject)
      .maybeSingle()
  ]);

  if (ragResult.error) return fail(`getChapterTopics: ${ragResult.error.message}`, 'DB_ERROR');
  const data = ragResult.data;

  const normalisedGrade = grade.replace(/^Grade\s*/i, '').trim();

  // Find curriculum topics matching subject, grade, and chapter number
  let curriculumTopics: Array<{ id: string; title: string }> = [];
  if (subjectRow?.data) {
    const { data: ctData, error: ctErr } = await supabase
      .from('curriculum_topics')
      .select('id, title')
      .eq('subject_id', subjectRow.data.id)
      .eq('grade', normalisedGrade)
      .eq('chapter_number', chapterNumber);
    if (ctErr) {
      // Soft degradation on purpose: curriculum_topics only contributes a
      // legacy id for RAG concepts to match against. Losing it cannot turn a
      // populated chapter into an empty one, so it is not escalated to fail().
      console.error('getChapterTopics (curriculum_topics):', ctErr.message);
    } else if (ctData) {
      curriculumTopics = ctData;
    }
  }

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

  const cleanString = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Group RAG chunks by concept (or topic) so the Learn page sees one card per
  // concept instead of 10+ raw chunks. Preserves ordering via min chunk_index.
  const byKey = new Map<string, {
    id: string; subject_id: string; title: string; title_hi: string | null;
    description: string | null; grade: string; board: string | null;
    chapter_number: number | null; difficulty_level: number;
    estimated_minutes: number | null; tags: string[] | null;
    is_active: boolean; display_order: number;
    learning_objectives: string[] | null; bloom_focus: string | null;
    ncert_page_range: string | null;
    topic_type: string;
    page_numbers: number[];
  }>();

  for (const c of chunks) {
    const key = (c.concept ?? c.topic ?? `chunk-${c.chunk_index ?? c.chunk_id}`).trim() || c.chunk_id;
    const existing = byKey.get(key);
    const pageNum = typeof c.page_number === 'number' && c.page_number > 0 ? c.page_number : null;

    if (!existing) {
      const cleanKey = cleanString(key);
      const matchedCt = curriculumTopics.find((ct) => {
        const cleanCt = cleanString(ct.title);
        return cleanCt === cleanKey || cleanCt.includes(cleanKey) || cleanKey.includes(cleanCt);
      });

      byKey.set(key, {
        id: matchedCt ? matchedCt.id : c.chunk_id,
        subject_id: subjectRow?.data?.id ?? '',
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
        ncert_page_range: null,
        topic_type: 'rag_topic',
        page_numbers: pageNum ? [pageNum] : [],
      });
    } else {
      if (c.chunk_text) {
        existing.description = (existing.description ?? '') + '\n\n' + c.chunk_text;
      }
      if (pageNum && !existing.page_numbers.includes(pageNum)) {
        existing.page_numbers.push(pageNum);
      }
    }
  }

  // Finalize page ranges
  const result = Array.from(byKey.values()).map(({ page_numbers, ...rest }) => {
    let range: string | null = null;
    if (page_numbers.length > 0) {
      const sorted = [...page_numbers].sort((a, b) => a - b);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      range = min === max ? `${min}` : `${min}-${max}`;
    }
    return {
      ...rest,
      ncert_page_range: range,
    };
  });

  return ok(result.sort((a, b) => a.display_order - b.display_order));
}

/* ── Questions filtered by chapter (for chapter quiz + quick-check) ──
 * Empty renders as "No quiz questions found for this chapter." on
 * /learn/[subject]/[chapter] — an assertion about the question bank, false when
 * the read failed. P1/P6: the select list, filters and shuffle are unchanged. */
export async function getChapterQuestions(subject: string, grade: string, chapterNumber: number, count = 20, difficulty?: number | null): Promise<ServiceResult<any[]>> {
  let query = supabase.from('question_bank')
    .select('id, question_text, question_hi, question_type, options, correct_answer_index, explanation, explanation_hi, hint, difficulty, bloom_level, chapter_number')
    .eq('subject', subject)
    .eq('grade', grade)
    .eq('is_active', true)
    .eq('chapter_number', chapterNumber)
    .limit(Math.min(count, 50));
  if (difficulty != null) query = query.eq('difficulty', difficulty);
  const { data, error } = await query;
  if (error) return fail(`getChapterQuestions: ${error.message}`, 'DB_ERROR');
  // Fisher-Yates via the canonical shuffle (was a biased, non-transitive
  // `.sort(() => Math.random() - 0.5)` that also mutated `data` in place).
  return ok(shuffle(data ?? []));
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
 * '@alfanumrik/lib/useAllowedChapters' instead.
 *
 * 422 (subject not in this student's allowed set) is the ONLY non-2xx that is
 * a genuine "no chapters" answer. 401 and 5xx are failures and are reported as
 * such — collapsing them into `[]` is what made the picker say "No chapters
 * available for this subject yet" after an auth hiccup.
 *
 * @deprecated Use `useAllowedChapters` from '@alfanumrik/lib/useAllowedChapters'.
 */
export interface AllowedChapterOption {
  chapter_number: number;
  title: string;
  title_hi?: string | null;
  verified_question_count?: number;
}
export async function getChaptersForSubject(subject: string, _grade: string): Promise<ServiceResult<AllowedChapterOption[]>> {
  void _grade;
  try {
    // Auth tokens live in localStorage (no middleware to sync to cookies).
    // Send the access token as Bearer header so /api/student/chapters can
    // authenticate the request. Matches useAllowedSubjects() behavior.
    const headers: Record<string, string> = {};
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
    } catch {
      // Proceed without — the server answers 401, reported as a failure below.
    }

    const r = await fetch(
      `/api/student/chapters?subject=${encodeURIComponent(subject)}`,
      { headers },
    );
    if (!r.ok) {
      if (r.status === 422) return ok([]);
      return fail(
        `getChaptersForSubject: HTTP ${r.status}`,
        r.status === 401 ? 'UNAUTHORIZED' : 'EXTERNAL_FAILURE',
      );
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
        verified_question_count?: number;
      }>;
    };
    return ok((body.chapters ?? []).map((c) => ({
      chapter_number: c.chapter_number,
      title: c.chapter_title ?? c.title ?? `Chapter ${c.chapter_number}`,
      title_hi: c.chapter_title_hi ?? null,
      verified_question_count: c.verified_question_count ?? 0,
    })));
  } catch (e) {
    return fail(
      `getChaptersForSubject: ${e instanceof Error ? e.message : String(e)}`,
      'EXTERNAL_FAILURE',
    );
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
    // student_learning_profiles is keyed (student_id, subject) — without the
    // subject filter a student with profiles in 2+ subjects makes
    // maybeSingle() error and theta silently stays null. Filter by THIS
    // quiz's subject; if no per-subject row exists yet, theta stays null
    // (same fail-soft behavior as before).
    const { data: profileData } = await supabase
      .from('student_learning_profiles')
      .select('irt_theta')
      .eq('student_id', studentId)
      .eq('subject', subject)
      .maybeSingle();
    if (profileData?.irt_theta != null) {
      irtTheta = profileData.irt_theta as number;
    }
  } catch {
    // Non-fatal: quiz-generator will use default difficulty band
  }

  // ── PHASE 2: LIVE adaptive candidate provider (flag-gated, fail-safe) ──
  // When ff_adaptive_live_selection_v1 is ON AND the student has concept_mastery
  // rows AND no specific chapter was requested, run the shared weak-topic
  // selector FIRST to surface IRT-proxy-ranked candidates on the student's
  // weakest + due-for-review topics. These are layered IN FRONT of the existing
  // fallback ladder below — they NEVER replace it and NEVER act as a hard
  // filter, so the count + P6 guarantees still hold (assembleQuiz tops up to
  // the exact requested count from the ladder and re-validates every row).
  //
  // Restricted to chapter-less requests: a chapter-scoped quiz has its own
  // integrity contract (assembleQuiz hard-drops cross-chapter rows), so
  // weak-topic candidates from other chapters would just be discarded — running
  // the provider there would be wasted work, not wrong.
  //
  // Fail-safe: any error in the provider returns [] and we fall straight
  // through to the unchanged ladder — this can never regress the live quiz.
  let adaptiveCandidates: unknown[] = [];
  if (chapterNumber == null) {
    try {
      const flags = await getFeatureFlags();
      if (flags[ADAPTIVE_LIVE_SELECTION_FLAGS.V1]) {
        // ── fisher_info ACTIVATION gate (ff_irt_question_selection, OEF ramp) ──
        // The nightly IRT calibrator stamps irt_a/irt_b/irt_calibration_n onto
        // live items. Without this gate, items crossing n >= 30 would silently
        // flip from proxy_distance to fisher_info ranking for this (live,
        // 10%-ramped) cohort with NO flag flip. IRT-scored serving must instead
        // be a deliberate, evidence-backed ramp of ff_irt_question_selection.
        //
        // Evaluated per-student via isFeatureEnabled — NOT getFeatureFlags(),
        // which ignores rollout_percentage — with userId = students.id so
        // percentage ramps hash deterministically per student, and role =
        // 'student' for role scoping. FAIL-CLOSED: flag missing / read error /
        // evaluation false → allowFisherInfo stays false → calibrated items
        // rank via the irt_difficulty proxy exactly like uncalibrated ones
        // (byte-identical to today's ranking). A flag-read failure must never
        // skip the adaptive provider itself — only close this gate.
        let allowFisherInfo = false;
        try {
          allowFisherInfo = await isFeatureEnabled(
            IRT_SELECTION_FLAGS.QUESTION_SELECTION,
            { userId: studentId, role: 'student' },
          );
        } catch {
          allowFisherInfo = false; // fail-closed: proxy_distance ranking
        }
        // ── IRT SHADOW gate (ff_irt_shadow_v1 — Phase 3 E2) ──────────────────
        // When ON, the selector scores every candidate BOTH ways (live serving
        // path + fisher_info-forced shadow path) on rows it already fetched —
        // zero extra I/O — and returns a divergence sample we ship to
        // /api/telemetry/irt-shadow fire-and-forget. Serving is UNAFFECTED.
        // FAIL-CLOSED: flag missing / read error / false → no shadow scoring.
        // Flag seeded OFF by migration 20260809000000; evaluated per-student
        // for deterministic percentage ramps (same convention as
        // ff_irt_question_selection above). The telemetry route re-checks the
        // flag server-side — this client gate is a cost gate, not a security
        // boundary.
        let computeShadow = false;
        try {
          computeShadow = await isFeatureEnabled(
            'ff_irt_shadow_v1',
            { userId: studentId, role: 'student' },
          );
        } catch {
          computeShadow = false; // fail-closed: no shadow scoring
        }
        const { questions: adaptiveRows, weakTopicsTargeted, shadow } = await selectAdaptiveQuestions(
          supabase as unknown as AdaptiveClient,
          {
            studentId,
            subject,
            grade,
            count,
            irtTheta,
            excludeIds: [],
            allowFisherInfo,
            computeShadow,
          },
        );
        if (Array.isArray(adaptiveRows) && adaptiveRows.length > 0 && weakTopicsTargeted > 0) {
          // weakTopicsTargeted is computed for observability/tests; the
          // candidates themselves are what matter for selection.
          adaptiveCandidates = adaptiveRows;
        }
        // ── Shadow telemetry (fire-and-forget; NEVER touches the quiz path) ──
        // Contract (backend E2, apps/host/src/app/api/telemetry/irt-shadow):
        //   POST { theta, nCandidates, nCalibrated, spearmanRho, top5Overlap,
        //          top10Overlap, subject, grade } → 204.
        // The route's zod schema requires all three divergence metrics as
        // finite numbers, so null-metric samples (degenerate candidate sets:
        // < 2 candidates or zero score variance) are not sent — they carry no
        // divergence signal anyway. No studentId in the payload (the server
        // derives it from auth; P13 — no identifiers beyond the session).
        // keepalive so a navigation right after quiz start does not drop the
        // beacon. Guarded for non-browser contexts; any telemetry failure is
        // swallowed — the quiz path must be unaware.
        if (
          shadow &&
          typeof fetch === 'function' &&
          shadow.spearmanRho !== null &&
          shadow.top5Overlap !== null &&
          shadow.top10Overlap !== null
        ) {
          try {
            void fetch('/api/telemetry/irt-shadow', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              keepalive: true,
              body: JSON.stringify({
                theta: shadow.theta,
                nCandidates: shadow.nCandidates,
                nCalibrated: shadow.nCalibrated,
                spearmanRho: shadow.spearmanRho,
                top5Overlap: shadow.top5Overlap,
                top10Overlap: shadow.top10Overlap,
                subject,
                grade,
              }),
            }).catch(() => { /* telemetry is best-effort */ });
          } catch {
            /* telemetry failure never touches the quiz path */
          }
        }
      }
    } catch (e) {
      // Fail-safe: never let the adaptive provider break the quiz path.
      console.warn('adaptive-live-selection provider failed, using ladder only:', e);
      adaptiveCandidates = [];
    }
  }

  // Merge adaptive candidates IN FRONT of a ladder result, deduped by id (then
  // by question text). Adaptive weak-topic candidates lead; the ladder fills the
  // rest. Never trims below the ladder's output — assembleQuiz does the final
  // exact-count trim + P6 validation. When there are no adaptive candidates this
  // returns the ladder result unchanged (byte-identical OFF-path behaviour).
  const mergeAdaptiveFront = (ladder: any[]): any[] => {
    if (adaptiveCandidates.length === 0) return ladder;
    const seen = new Set<string>();
    const keyOf = (q: unknown): string => {
      const r = q as { id?: unknown; question_text?: unknown };
      if (typeof r?.id === 'string' && r.id) return r.id;
      if (typeof r?.question_text === 'string')
        return r.question_text.trim().toLowerCase().slice(0, 80);
      return '';
    };
    const out: any[] = [];
    for (const q of [...adaptiveCandidates, ...ladder]) {
      const k = keyOf(q);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(q);
    }
    return out;
  };

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
        // Edge function returned the full requested count — use it directly,
        // with adaptive weak-topic candidates layered in front (deduped). When
        // adaptive is empty this is byte-identical to returning `questions`.
        return mergeAdaptiveFront(questions);
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
      if (questions.length > 0) return mergeAdaptiveFront(questions);
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
      if (questions.length > 0) return mergeAdaptiveFront(questions);
    }
  } catch {
    // v2 RPC failed
  }

  // ── FALLBACK 3: direct question_bank query (v1) ──
  const v1Questions = await getQuizQuestions(subject, grade, count, diffMap[difficultyMode] ?? null, chapterNumber);
  // If edge function had partial results and v1 returned fewer, use the edge function's results
  // (they have dedup/history tracking already applied)
  if (edgeFunctionQuestions && edgeFunctionQuestions.length > v1Questions.length) {
    return mergeAdaptiveFront(edgeFunctionQuestions);
  }
  return mergeAdaptiveFront(v1Questions);
}

/* ── Update Chapter Progress (fire-and-forget after quiz) ──
   ADR-001 Phase 2c: routes through POST /api/learner/lesson/progress so
   the server can detect the false→true is_completed transition and
   publish learner.lesson_completed on the state_events bus. Behaviour
   for the chapter_progress projection is byte-identical — the route
   calls the same update_chapter_progress RPC server-side. Stays
   fire-and-forget on the client side. */
export async function updateChapterProgress(
  subject: string,
  grade: string,
  chapterNumber: number,
  startedAt?: string,
) {
  try {
    const res = await fetch('/api/learner/lesson/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ subject, grade, chapterNumber, startedAt }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn('update_chapter_progress route failed:', body);
    }
  } catch (e) {
    console.warn('update_chapter_progress route error:', e);
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
    // Live signature is get_ncert_coverage_report(p_grade text, p_subject text).
    // The earlier call passed p_student_id, which made PostgREST 202 (no matching
    // overload) and the report silently returned null. Coverage is grade/subject
    // scoped, not per-student, so no student_id is needed. (RPC re-sweep 2026-06-16)
    const { data, error } = await supabase.rpc('get_ncert_coverage_report', {
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

