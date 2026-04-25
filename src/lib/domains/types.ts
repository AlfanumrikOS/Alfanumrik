/**
 * Shared domain types — service contracts across all Alfanumrik domains.
 *
 * Every domain function returns ServiceResult<T>. Callers must check ok
 * before accessing data. This eliminates silent failures and makes the
 * contract explicit at the call site.
 *
 * When a domain is later extracted as a microservice, these types become
 * the HTTP request/response schema. No rewrite needed — just wrap in a handler.
 */

// ── Result monad ───────────────────────────────────────────────────────────────

export type ServiceResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: string; code: ServiceErrorCode };

export type ServiceErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'EXTERNAL_FAILURE'   // downstream RPC/edge function failed
  | 'DB_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  error: string,
  code: ServiceErrorCode = 'INTERNAL'
): ServiceResult<T> {
  return { ok: false, error, code };
}

// ── Quiz domain ────────────────────────────────────────────────────────────────

export interface QuizQuestion {
  id: string;
  question_text: string;
  question_hi: string | null;
  question_type: string;
  options: string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  hint: string | null;
  hint_hi?: string | null;
  difficulty: number;
  bloom_level: string;
  chapter_number: number;
  subject?: string;
  grade?: string;
}

export interface QuizSessionResult {
  session_id: string;
  total: number;
  correct: number;
  score_percent: number;
  xp_earned: number;
}

export interface QuizSubmissionInput {
  studentId: string;
  subject: string;
  grade: string;
  topic: string;
  chapter: number;
  responses: QuizResponse[];
  timeTakenSeconds: number;
}

export interface QuizResponse {
  question_id: string;
  selected_index: number;
  is_correct: boolean;
  time_taken_seconds?: number;
}

// ── Learning Profile domain ────────────────────────────────────────────────────

export interface LearningProfile {
  student_id: string;
  subject: string;
  xp: number;
  level: number;
  streak_days: number;
  total_sessions: number;
  total_questions_asked: number;
  total_questions_answered_correctly: number;
  irt_theta: number | null;
  mastery_probability: number | null;
  last_session_at: string | null;
}

export interface XPUpdateInput {
  studentId: string;
  subject: string;
  xpDelta: number;
  totalQuestions: number;
  correctAnswers: number;
  timeTakenSeconds: number;
}

// ── Content domain ─────────────────────────────────────────────────────────────

export interface QuizQuestionFetchInput {
  subject: string;
  grade: string;
  count: number;
  difficultyMode: 'easy' | 'medium' | 'hard' | 'mixed' | 'progressive';
  chapterNumber: number | null;
  questionTypes: string[];
  studentId: string;
  irtTheta: number | null;
}

export interface QuizQuestionSource {
  source: 'edge_fn' | 'rpc_rag' | 'rpc_v2' | 'direct_query';
  questions: QuizQuestion[];
  count: number;
}

// ── Identity domain ────────────────────────────────────────────────────────────

export interface StudentIdentity {
  studentId: string;
  authUserId: string;
  grade: string;
  name: string;
}

/**
 * Student profile exposed by the identity domain. Intentionally a narrow
 * projection — callers that need more columns should add them explicitly
 * to avoid select('*') and over-fetching.
 *
 * Grade is always a string (product invariant P5).
 */
export interface Student {
  id: string;
  authUserId: string | null;
  name: string | null;
  email: string | null;
  grade: string | null;
  schoolId: string | null;
  isActive: boolean | null;
}

export interface Teacher {
  id: string;
  authUserId: string | null;
  name: string | null;
  email: string | null;
  schoolId: string | null;
  schoolName: string | null;
}

export interface Guardian {
  id: string;
  authUserId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
}

// ── Phase 0e: Practice / Review / Spaced-Repetition domain ─────────────────────
//
// Types live in this clearly-marked block to avoid merge collisions with the
// sibling 0b/0c branches that also extend this file. Keep additions to this
// section only — do not interleave with earlier domain types.
//
// B8 (practice) owns spaced_repetition_cards and has read-access to
// concept_mastery / topic_mastery. SM-2 algorithm logic stays in
// cognitive-engine.ts / feedback-engine.ts (Phase 0f territory).

/**
 * A spaced-repetition card. Mirrors the spaced_repetition_cards table shape
 * but in camelCase. Grade is always a string (product invariant P5).
 *
 * The algorithm fields (easeFactor, intervalDays, streak, repetitionCount,
 * nextReviewDate) are read-only from this domain's perspective — SM-2 update
 * logic is owned by the cognitive engine (Phase 0f).
 */
export interface ReviewCard {
  id: string;
  studentId: string;
  cardType: string | null;
  subject: string | null;
  grade: string | null;
  chapterNumber: number | null;
  chapterTitle: string | null;
  topic: string | null;
  frontText: string;
  backText: string;
  hint: string | null;
  source: string | null;
  sourceId: string | null;
  easeFactor: number;
  intervalDays: number;
  repetitionCount: number;
  nextReviewDate: string | null;
  lastReviewDate: string | null;
  lastQuality: number | null;
  totalReviews: number;
  correctReviews: number;
  streak: number;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Aggregate of cards due for a student.
 * `bySubject` keys are subject codes ("math", "science", etc — see CBSE rules).
 */
export interface ReviewDue {
  total: number;
  bySubject: Record<string, number>;
}

/**
 * Concept-mastery slice exposed to the practice domain — read-only.
 *
 * This is intentionally a NARROW projection of the concept_mastery table.
 * The full BKT/IRT algorithm fields (p_know, p_learn, p_guess, etc) stay
 * inside the cognitive engine; this domain exposes only what review/practice
 * UIs need: which topic, how mastered, when next review.
 */
export interface ConceptMasterySlice {
  topicId: string;
  masteryProbability: number | null;
  consecutiveCorrect: number | null;
  nextReviewAt: string | null;
  updatedAt: string | null;
}
