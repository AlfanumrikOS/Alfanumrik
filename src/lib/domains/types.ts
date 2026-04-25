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

// ── Content domain (B6) — Phase 0d ───────────────────────────────────────────
//
// Read-only projections of question_bank, cbse_syllabus, ncert_content
// (planned), and chapter_concepts. Grade is always a string (P5).
// Question rows include all fields needed for P6 validation by callers.

/**
 * Question row projected from `question_bank`. The shape is intentionally
 * stable across the verification lifecycle — verification metadata is
 * surfaced separately so callers can decide whether to enforce
 * `verifiedAgainstNcert === true` at serve time.
 *
 * Options are normalised to a string[]. Callers must enforce P6 (exactly
 * 4 distinct non-empty options, correctAnswerIndex in [0,3], non-empty
 * text/explanation, valid difficulty + bloom_level) at serve time — this
 * type does not guarantee P6 by itself.
 */
export interface Question {
  id: string;
  subject: string | null;
  grade: string | null;          // P5: always string
  chapterId: string | null;       // FK to chapters(id), may be null on legacy rows
  chapterNumber: number | null;
  chapterTitle: string | null;
  topic: string | null;
  questionText: string;
  questionHi: string | null;
  questionType: string | null;
  options: string[];              // normalised from JSONB
  correctAnswerIndex: number;
  explanation: string | null;
  explanationHi: string | null;
  hint: string | null;
  hintHi: string | null;
  difficulty: number;
  bloomLevel: string | null;
  isActive: boolean | null;
  source: string | null;
  isNcert: boolean | null;
  verifiedAgainstNcert: boolean | null;
  verificationState: string | null;  // legacy_unverified | pending | verified | failed
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Chapter row projected from `cbse_syllabus`. One row per
 * (board, grade, subject_code, chapter_number). The `ragStatus` field
 * indicates whether retrieval-grounded answers can be served for this
 * chapter (`ready`) or not (`missing` | `partial`).
 */
export interface Chapter {
  id: string;
  board: string | null;
  grade: string | null;            // P5: always string
  subjectCode: string | null;
  subjectDisplay: string | null;
  subjectDisplayHi: string | null;
  chapterNumber: number | null;
  chapterTitle: string | null;
  chapterTitleHi: string | null;
  chunkCount: number;
  verifiedQuestionCount: number;
  ragStatus: string | null;        // missing | partial | ready
  lastVerifiedAt: string | null;
  isInScope: boolean | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * NCERT content row. Backed by the planned `ncert_content` table (see
 * DATA_OWNERSHIP_MATRIX.md). Until the migration lands, helpers return
 * a soft-failure DB_ERROR when the table is missing.
 */
export interface NcertContent {
  id: string;
  grade: string | null;            // P5: always string
  subject: string | null;
  chapter: string | null;
  chapterNumber: number | null;
  section: string | null;
  contentType: string | null;
  contentText: string | null;
  contentHi: string | null;
  pageNumber: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Chapter concept row — the structured "explainer" units per chapter.
 * Drives Foxy's concept-walkthrough UI and CME-engine concept selection.
 */
export interface ChapterConcept {
  id: string;
  chapterId: string | null;
  grade: string | null;            // P5: always string
  subject: string | null;
  chapterNumber: number | null;
  chapterTitle: string | null;
  conceptNumber: number;
  title: string | null;
  titleHi: string | null;
  slug: string | null;
  learningObjective: string | null;
  learningObjectiveHi: string | null;
  explanation: string | null;
  explanationHi: string | null;
  keyFormula: string | null;
  exampleTitle: string | null;
  exampleContent: string | null;
  exampleContentHi: string | null;
  commonMistakes: string[];
  examTips: string[];
  diagramRefs: string[];
  diagramDescription: string | null;
  practiceQuestion: string | null;
  practiceOptions: string[];
  practiceCorrectIndex: number | null;
  practiceExplanation: string | null;
  difficulty: number;
  bloomLevel: string | null;
  estimatedMinutes: number;
  isActive: boolean | null;
  source: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
