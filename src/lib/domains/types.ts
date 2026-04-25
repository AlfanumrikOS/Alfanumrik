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

// ── Ops domain (B13) — Phase 0j ───────────────────────────────────────────────

/**
 * Maintenance banner shown across all portals (student/parent/teacher/admin).
 *
 * Backed by a row in the `feature_flags` table with flag_name='maintenance_banner'.
 * `messageEn` and `messageHi` come from the row's `metadata` JSONB. When no
 * banner row exists (or it is disabled), `getMaintenanceBanner` returns
 * `ok(null)`.
 *
 * Rendering today is owned by `src/components/MaintenanceBanner.tsx`, which
 * polls the table client-side. The domain helper exists so server routes
 * (e.g. middleware, super-admin status APIs) can read the same source of
 * truth without duplicating the column projection.
 */
export interface MaintenanceBanner {
  isEnabled: boolean;
  messageEn: string | null;
  messageHi: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Support ticket row exposed by the ops domain. Mirrors the columns
 * written by `/api/support/ticket` (POST) and updated by
 * `/api/internal/admin/support` (PATCH).
 */
export interface SupportTicket {
  id: string;
  studentId: string | null;
  email: string | null;
  category: string;
  subject: string | null;
  message: string;
  status: string;
  userRole: string | null;
  userName: string | null;
  deviceInfo: string | null;
  adminNotes: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * Admin user record from the `admin_users` table. The table is the source
 * of truth for super-admin / admin / moderator listings; `user_roles` holds
 * the granular RBAC role assignment, but `admin_users` is what is read by
 * RLS policies (see `20260418100800_feature_flags.sql`).
 */
export interface AdminUser {
  id: string;
  authUserId: string;
  name: string;
  email: string | null;
  adminLevel: string;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}
