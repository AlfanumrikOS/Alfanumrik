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

// ── Analytics domain (Phase 0i) ────────────────────────────────────────────────
//
// B12 Analytics is a read-only context: it does not own any write paths into
// the other domains. The four read tables it exposes are dual-written by
// daily-cron (server) and the quiz RPC (B5). The analytics module only reads
// them and projects camelCase shapes for the super-admin / school-admin
// surfaces.
//
// Three of the four reference tables in DATA_OWNERSHIP_MATRIX.md
// (`student_analytics`, `usage_metrics`, `performance_reports`) do not yet
// exist as physical tables — they are part of the planned analytics schema.
// The helpers in `domains/analytics.ts` are still defined now to lock the
// service contract; if the underlying table is missing at query time, the
// call returns a `DB_ERROR` ServiceResult and a one-line warn is logged so
// callers can degrade gracefully without crashing.

/**
 * One row from `daily_activity`, projected to camelCase. The legacy
 * core_schema shape is the source of truth: per (student_id, date, subject),
 * counts of questions/correct/sessions and minutes spent.
 *
 * `subject` is nullable in the underlying table — represents an aggregate
 * across all subjects on that day.
 */
export interface DailyActivity {
  id: string;
  studentId: string;
  activityDate: string; // YYYY-MM-DD
  subject: string | null;
  questionsAsked: number;
  questionsCorrect: number;
  xpEarned: number;
  timeMinutes: number;
  sessions: number;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Latest snapshot row from `student_analytics`. Shape is intentionally
 * narrow and stable — when the physical table lands, additional aggregates
 * should be added here, not selected via `.select('*')`.
 */
export interface StudentAnalytics {
  studentId: string;
  totalQuestionsAttempted: number | null;
  totalQuestionsCorrect: number | null;
  averageScorePercent: number | null;
  totalXp: number | null;
  totalSessions: number | null;
  totalStudyMinutes: number | null;
  lastActivityAt: string | null;
  computedAt: string | null;
}

/**
 * Bounded slice of `usage_metrics`. Used by super-admin dashboards and
 * school-level reporting. The metric is a free-form key (e.g.
 * `chats.daily.count`, `quizzes.daily.completed`).
 */
export interface UsageMetric {
  id: string;
  studentId: string | null;
  schoolId: string | null;
  metric: string;
  value: number;
  recordedAt: string;
  metadata: Record<string, unknown> | null;
}

/**
 * A pre-computed report row out of `performance_reports`. The actual
 * payload (charts, breakdowns) lives in `payload` JSONB so this type does
 * not need to evolve when new report kinds are added.
 */
export interface PerformanceReport {
  id: string;
  studentId: string | null;
  schoolId: string | null;
  reportType: string;
  periodStart: string | null;
  periodEnd: string | null;
  payload: Record<string, unknown>;
  generatedAt: string;
}
