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

// ── Billing domain (Phase 0g.1, B10) ──────────────────────────────────────────
//
// Read-only projections over subscription_plans, student_subscriptions,
// payments, razorpay_orders, razorpay_webhooks. Writes stay in the webhook
// route + activate_subscription / atomic_subscription_activation RPCs (P11).

export interface SubscriptionPlan {
  id: string;
  planCode: string;
  name: string | null;
  /** INR price for monthly billing cycle. */
  priceMonthly: number | null;
  /** INR price for yearly one-time billing cycle. */
  priceYearly: number | null;
  /** Razorpay plan id used for monthly recurring auto-charge. */
  razorpayPlanIdMonthly: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StudentSubscription {
  id: string;
  studentId: string;
  planId: string | null;
  planCode: string | null;
  status: string | null;
  billingCycle: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingAt: string | null;
  gracePeriodEnd: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  renewalAttempts: number;
  autoRenew: boolean;
  amountPaid: number | null;
  razorpaySubscriptionId: string | null;
  razorpayPaymentId: string | null;
  endedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Payment {
  id: string;
  studentId: string | null;
  razorpayPaymentId: string | null;
  razorpayOrderId: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  planCode: string | null;
  billingCycle: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RazorpayOrder {
  id: string;
  razorpayOrderId: string;
  studentId: string | null;
  planCode: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  receipt: string | null;
  notes: unknown;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RazorpayWebhook {
  id: string;
  eventId: string | null;
  eventType: string | null;
  payload: unknown;
  signatureVerified: boolean;
  processed: boolean;
  processingError: string | null;
  createdAt: string | null;
  processedAt: string | null;
}
