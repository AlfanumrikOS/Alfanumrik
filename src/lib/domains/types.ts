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

// ── Relationship domain (Phase 0c) ────────────────────────────────────────────
//
// Owns guardian_student_links. Types added below in a separate block to
// minimise merge friction with concurrent Phase 0b (tenant) extraction.
// Do not reorder these keys without updating relationship.ts mappers.

/**
 * Status values used by guardian_student_links.status.
 *
 * Multiple values mean "the link is live": legacy demo-account flows insert
 * with status='active', the human approval flow uses 'approved'. Callers
 * that need to enforce "linked right now" should accept both.
 */
export type GuardianLinkStatus =
  | 'pending'
  | 'approved'
  | 'active'
  | 'rejected'
  | 'revoked';

/** Subset of statuses that mean the link is currently active. */
export const ACTIVE_GUARDIAN_LINK_STATUSES: ReadonlyArray<GuardianLinkStatus> = [
  'approved',
  'active',
];

/**
 * Raw guardian_student_links row, projected to camelCase. Selected columns
 * only — we deliberately omit revoked_by / rejected_reason etc. until a
 * caller needs them, to keep the contract narrow.
 */
export interface GuardianStudentLink {
  id: string;
  guardianId: string;
  studentId: string;
  status: GuardianLinkStatus;
  permissionLevel: string | null;
  isVerified: boolean | null;
  linkedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Projection used by parent dashboards: each row carries enough about the
 * child to render a card (name, grade) plus the link metadata, so the
 * caller doesn't have to do an N+1 lookup back to `students`.
 */
export interface ChildSummary {
  studentId: string;
  name: string | null;
  // Invariant P5: grade is always a string.
  grade: string | null;
  schoolId: string | null;
  linkId: string;
  linkStatus: GuardianLinkStatus;
  linkedAt: string | null;
}

/**
 * Inverse projection: who are the guardians for a given student?
 * Used by support / admin tooling that starts from the student.
 */
export interface GuardianSummary {
  guardianId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  linkId: string;
  linkStatus: GuardianLinkStatus;
  linkedAt: string | null;
}
