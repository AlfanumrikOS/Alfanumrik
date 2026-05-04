/**
 * PostHog event taxonomy and PII allowlist for the Marking-Authenticity remediation.
 *
 * This module is the single source of truth for:
 *   1. The discriminated set of event names we ever emit server-side.
 *   2. The shape of properties allowed on each event.
 *   3. The allowlist of person properties (anything not on this list is redacted).
 *   4. The base properties auto-attached by `capture()` (request_id, environment, app_version).
 *
 * Why a typed taxonomy?
 *   - Prevents typo events (`quiz_grade` vs `quiz_graded`) silently splitting funnels.
 *   - Lets the redactor identify "expected" payment shapes vs free-form leak vectors.
 *   - Keeps PostHog dashboards stable while we evolve the implementation.
 *
 * Design note (P13): we never include raw email, phone, full_name, payment_card_*,
 * razorpay_signature, or ip_address in any event payload. These are stripped by
 * `redactPII()` even if a caller accidentally passes them. The allowlist below
 * documents the SHAPE of what we *want* to send; the redactor enforces what we
 * *actually* send.
 */

// ─── Event Names ────────────────────────────────────────────────────────────
// Add new events here. The string literal is the canonical PostHog event name.

export type PostHogEventName =
  // Quiz lifecycle
  | 'quiz_started'
  | 'quiz_graded'
  | 'quiz_anti_cheat_flagged'
  | 'quiz_server_submit_passthrough' // Phase 2.6 transition logging
  | 'quiz_question_served' // ai-engineer: per-question shipped by quiz-generator
  // XP economy
  | 'xp_awarded'
  | 'daily_xp_cap_hit'
  // Payments (Razorpay)
  | 'payment_initiated'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'subscription_activated'
  | 'subscription_renewed'
  | 'subscription_cancelled'
  // AI tutor (placeholder — owned by ai-engineer's wave)
  | 'foxy_chat_turn'
  | 'foxy_safety_block'
  // AI tutor (ai-engineer Phase 3 — marking-authenticity remediation,
  // emitted server-side from supabase/functions/foxy-tutor and
  // supabase/functions/quiz-generator via _shared/posthog.ts).
  | 'foxy_session_started'        // session bootstrap (server-side analogue of client foxy_session_started)
  | 'foxy_message_sent'           // per-turn volumetric (no message text — P13)
  | 'foxy_oracle_blocked'         // an MCQ candidate failed the quiz-oracle gate
  | 'foxy_practice_question_emitted' // an MCQ passed the gate and shipped to client
  // Landing-page measurement (Phase 5 of landing refresh).
  // All client-side. Fired from src/components/landing-v2/* and src/components/Breadcrumbs.tsx.
  | 'landing_nav_click'
  | 'landing_solutions_dropdown_opened'
  | 'landing_role_changed'
  | 'landing_faq_opened'
  | 'landing_cta_click'
  | 'landing_breadcrumb_click';

// ─── Base properties auto-attached by `capture()` ──────────────────────────

export interface BaseEventProperties {
  /** From `headers().get('x-request-id')` — correlates server logs ↔ PostHog. */
  request_id?: string;
  /** `process.env.VERCEL_ENV` ?? `process.env.NODE_ENV` ?? 'development'. */
  environment?: string;
  /** `process.env.npm_package_version` from package.json (release tracking). */
  app_version?: string;
}

// ─── Per-event payload shapes ──────────────────────────────────────────────

export interface QuizGradedPayload {
  session_id: string;
  score_percent: number;
  xp_earned: number;
  correct: number;
  total: number;
  marking_authenticity_path: 'oracle_v2' | 'legacy_v1' | 'fallback_atomic';
  anti_cheat_flagged: boolean;
  idempotent_replay: boolean;
}

export interface QuizStartedPayload {
  session_id: string;
  subject: string;
  grade: string;
  question_count: number;
}

export interface QuizAntiCheatFlaggedPayload {
  session_id: string;
  reason: string;
}

export interface QuizServerSubmitPassthroughPayload {
  session_id: string;
  /** When the flag flips to true, the legacy client path should stop firing. */
  flag_state: 'off' | 'on';
}

export interface XpAwardedPayload {
  xp_delta: number;
  source: 'quiz' | 'foxy' | 'streak' | 'review' | 'milestone';
  daily_total_after: number;
  capped: boolean;
}

export interface DailyXpCapHitPayload {
  source: 'quiz' | 'foxy' | 'streak' | 'review' | 'milestone';
  cap: number;
  attempted_xp: number;
}

// Razorpay events. Keep these tight — never include card details, never include
// the razorpay_signature (PII per redactor).
export interface PaymentInitiatedPayload {
  amount: number; // paise
  currency: 'INR';
  plan: string;
  billing_cycle: 'monthly' | 'yearly';
  order_id: string;
}

export interface PaymentSucceededPayload {
  amount: number;
  currency: 'INR';
  plan: string;
  billing_cycle: 'monthly' | 'yearly';
  razorpay_payment_id: string;
  razorpay_order_id: string;
}

export interface PaymentFailedPayload {
  amount: number;
  currency: 'INR';
  plan: string;
  billing_cycle: 'monthly' | 'yearly';
  /** Razorpay error_code (e.g. BAD_REQUEST_ERROR). NOT error message — may leak. */
  error_code: string | null;
}

export interface SubscriptionActivatedPayload {
  plan: string;
  billing_cycle: 'monthly' | 'yearly';
  razorpay_subscription_id: string;
}

export interface SubscriptionRenewedPayload {
  plan: string;
  billing_cycle: 'monthly' | 'yearly';
  razorpay_subscription_id: string;
}

export interface SubscriptionCancelledPayload {
  plan: string;
  razorpay_subscription_id: string;
  reason?: 'user' | 'halted' | 'expired' | 'completed';
}

// AI tutor — placeholders for ai-engineer's wave (kept here for taxonomy parity).
export interface FoxyChatTurnPayload {
  session_id: string;
  turn_index: number;
  latency_ms: number;
  rag_chunks_used: number;
}

export interface FoxySafetyBlockPayload {
  session_id: string;
  reason: 'pii' | 'off_curriculum' | 'age_inappropriate' | 'rate_limit';
}

// AI tutor — Phase 3 marking-authenticity remediation. Emitted server-side
// from Edge Functions via supabase/functions/_shared/posthog.ts. NEVER
// include message text, question text, options, or explanations (P13). Only
// IDs, counts, and routing context.

export interface FoxySessionStartedPayload {
  session_id: string | null; // null when a new session is being created this turn
  mode: string;              // 'learn' | 'quiz' | 'practice' | 'revision' | 'doubt' | 'homework'
  subject?: string;
  grade?: string;
  topic?: string;
}

export interface FoxyMessageSentPayload {
  session_id: string | null;
  mode: string;
  subject?: string;
  grade?: string;
  /** Total structured blocks emitted this turn (paragraphs + steps + math + mcq + ...). */
  blocks_emitted: number;
  /** MCQ candidates that the oracle blocked this turn (subset of attempts). */
  oracle_blocks: number;
  /** Source attribution: 'foxy-tutor' (legacy Edge Function) | 'foxy-route' (new /api/foxy). */
  source: 'foxy-tutor' | 'foxy-route';
  /** Wall-clock latency from request entry to response emit, ms. */
  latency_ms?: number;
}

/**
 * Emitted whenever the quiz-oracle rejects a candidate question.
 * Two surfaces use this event:
 *   1. supabase/functions/foxy-tutor — when an inline MCQ candidate fails
 *      the gate before reaching the student. Includes `mode`.
 *   2. supabase/functions/quiz-generator — when the deterministic validator
 *      drops questions before send. `category` is then either an
 *      OracleRejectionCategory or 'insufficient_validated_questions' when
 *      the count drop forced a 422.
 */
export interface FoxyOracleBlockedPayload {
  source: 'foxy-tutor' | 'quiz-generator';
  /** Foxy mode (quiz|practice|...); absent for quiz-generator. */
  mode?: string;
  subject?: string;
  grade?: string;
  topic?: string;
  /** OracleRejectionCategory or routing category. Closed set; safe to facet. */
  category: string;
  /** Short human-readable reason. Truncate to 200 chars before emit. */
  reason?: string;
  /** Number of Claude calls attributed to this rejection (cost tracking). */
  llm_calls?: number;
  /** quiz-generator only: how many questions were dropped this request. */
  dropped_count?: number;
  /** quiz-generator only: how many were ultimately served. */
  served_count?: number;
  /** quiz-generator only: how many were originally requested. */
  requested_count?: number;
}

/**
 * Emitted when an MCQ generated inline by Foxy passes the oracle and is
 * inserted into question_bank with source='foxy_inline'. The new
 * question_id makes the inline-generated MCQ joinable to future submissions.
 */
export interface FoxyPracticeQuestionEmittedPayload {
  question_id: string;
  bloom_level?: string;
  difficulty?: string;
  subject?: string;
  grade?: string;
  topic?: string;
  session_id?: string | null;
}

/**
 * Emitted once per question served by quiz-generator on the wire. Lets
 * cohort analysis compare engagement across question provenance.
 */
export interface QuizQuestionServedPayload {
  question_id: string;
  subject: string;
  grade: string;
  topic?: string;
  /**
   * Provenance:
   *   'question_bank' — pre-existing curated row.
   *   'generated'     — bulk-question-gen output.
   *   'foxy_inline'   — emitted by foxy-tutor and inserted at chat time.
   */
  source: 'question_bank' | 'generated' | 'foxy_inline';
  bloom_level?: string;
  difficulty?: string;
  /** Strategy used for selection (review|adaptive|random). */
  strategy?: 'review' | 'adaptive' | 'random';
}

// ─── Landing-page measurement payloads (Phase 5) ───────────────────────────
//
// All landing events are fired client-side. They carry the active role, the
// destination href / label, and (for CTA) the UI language at click time.
// PII-free by design — no email, phone, full_name, raw user IDs. The
// EVENT_PROPERTY_PII_KEYS redactor in `src/lib/analytics.ts` provides defence
// in depth.

export interface LandingNavClickPayload {
  /** Where in the nav: 'primary' = desktop top bar; 'mobile_pages' = burger Pages group; 'mobile_sections' = burger Sections group. */
  source: 'primary' | 'mobile_pages' | 'mobile_sections';
  /** The href clicked (e.g. '/pricing', '/about', '#faq'). */
  destination: string;
  /** The visible label of the link (e.g. 'Pricing', 'About', 'Common questions'). */
  label: string;
  /** Active role at click time. */
  active_role: 'parent' | 'student' | 'teacher' | 'school';
}

export interface LandingSolutionsDropdownOpenedPayload {
  active_role: 'parent' | 'student' | 'teacher' | 'school';
}

export interface LandingRoleChangedPayload {
  /** Role they switched FROM. */
  from_role: 'parent' | 'student' | 'teacher' | 'school';
  /** Role they switched TO. */
  to_role: 'parent' | 'student' | 'teacher' | 'school';
  /** Which control they used: desktop strip or mobile burger. */
  source: 'desktop_strip' | 'mobile_burger';
}

export interface LandingFaqOpenedPayload {
  /** 1-indexed position of the FAQ in the visible list. */
  faq_index: number;
  /** The English question text — used for analytics-friendly grouping even when user is on Hi. */
  question_en: string;
  /** Active role at click time. */
  active_role: 'parent' | 'student' | 'teacher' | 'school';
}

export interface LandingCtaClickPayload {
  /** Where the CTA lives: 'nav' (top-bar Start free), 'hero' (per-role CTA), 'pricing_teaser', 'final_cta'. */
  location: 'nav' | 'hero' | 'pricing_teaser' | 'final_cta';
  /** The CTA destination href. */
  destination: string;
  /** Active role at click time. */
  active_role: 'parent' | 'student' | 'teacher' | 'school';
  /** UI language at click time. */
  language: 'en' | 'hi';
}

export interface LandingBreadcrumbClickPayload {
  /** The page the user is currently on (e.g. '/about', '/for-parents'). */
  current_page: string;
  /** The breadcrumb label clicked (e.g. 'Home', 'Solutions'). */
  label: string;
  /** The destination href. */
  destination: string;
  /** 0-indexed position of the clicked crumb (Home = 0, deepest = items.length - 1). */
  crumb_position: number;
}

// Discriminated union of all event payloads, keyed by event name.
export type EventPayloadByName = {
  quiz_started: QuizStartedPayload;
  quiz_graded: QuizGradedPayload;
  quiz_anti_cheat_flagged: QuizAntiCheatFlaggedPayload;
  quiz_server_submit_passthrough: QuizServerSubmitPassthroughPayload;
  quiz_question_served: QuizQuestionServedPayload;
  xp_awarded: XpAwardedPayload;
  daily_xp_cap_hit: DailyXpCapHitPayload;
  payment_initiated: PaymentInitiatedPayload;
  payment_succeeded: PaymentSucceededPayload;
  payment_failed: PaymentFailedPayload;
  subscription_activated: SubscriptionActivatedPayload;
  subscription_renewed: SubscriptionRenewedPayload;
  subscription_cancelled: SubscriptionCancelledPayload;
  foxy_chat_turn: FoxyChatTurnPayload;
  foxy_safety_block: FoxySafetyBlockPayload;
  foxy_session_started: FoxySessionStartedPayload;
  foxy_message_sent: FoxyMessageSentPayload;
  foxy_oracle_blocked: FoxyOracleBlockedPayload;
  foxy_practice_question_emitted: FoxyPracticeQuestionEmittedPayload;
  landing_nav_click: LandingNavClickPayload;
  landing_solutions_dropdown_opened: LandingSolutionsDropdownOpenedPayload;
  landing_role_changed: LandingRoleChangedPayload;
  landing_faq_opened: LandingFaqOpenedPayload;
  landing_cta_click: LandingCtaClickPayload;
  landing_breadcrumb_click: LandingBreadcrumbClickPayload;
};

/** Generic helper: lookup payload type by event name. */
export type EventPayload<E extends PostHogEventName> = EventPayloadByName[E];

// ─── Person Properties Allowlist (P13) ──────────────────────────────────────
//
// `identify()` may set ONLY these keys on the person profile. Every other key
// is dropped by the redactor. This is a hard wall against accidentally writing
// email/phone/full_name to PostHog person properties (which are GDPR-relevant).

export interface PersonPropertiesAllowlist {
  // Coarse cohorting only.
  grade?: string;        // "6"-"12" (P5)
  board?: string;        // CBSE | ICSE | …
  plan?: string;         // free | starter | pro | unlimited
  preferred_language?: string; // 'en' | 'hi'
  signup_date?: string;  // ISO date (no time)
  /** Hashed UUID prefix — see hashUserIdForAnalytics(). NEVER raw auth_user_id. */
  distinct_id_hash?: string;
}

/** Set of allowed person property keys, used by the redactor. */
export const PERSON_PROPERTY_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  'grade',
  'board',
  'plan',
  'preferred_language',
  'signup_date',
  'distinct_id_hash',
]);

// ─── Extra PII keys to redact on event properties ──────────────────────────
// Extends the base sensitive set in src/lib/logger.ts / supabase/functions/_shared/redact-pii.ts.
// Anything in this set is redacted from event properties even if the type system says it's fine.

export const EVENT_PROPERTY_PII_KEYS: ReadonlySet<string> = new Set<string>([
  // Identity
  'email',
  'phone',
  'parent_phone',
  'full_name',
  'name',
  'school_name',
  'school_address',
  'address',
  // Payment surface
  'razorpay_signature',
  'card_number',
  'card_cvv',
  'card_expiry',
  'card_holder',
  'upi_id',
  'vpa',
  // Network
  'ip_address',
  'ip',
  'user_agent', // can fingerprint; coarse cohorting uses environment instead
]);
