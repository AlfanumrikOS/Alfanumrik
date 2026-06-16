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
  | 'landing_breadcrumb_click'
  // /learn flow (Phase 2-B of the May 2026 upgrade). All client-side,
  // fired from src/app/learn/[subject]/[chapter]/page.tsx. Closes the
  // telemetry gap on the entire learning loop. PII-free by design — only
  // grade, subject_code, chapter_number, concept_idx, score_pct, is_correct.
  | 'learn_chapter_started'
  | 'learn_concept_advanced'
  | 'learn_quick_check_submitted'
  | 'learn_chapter_completed'
  | 'learn_foxy_doubt_clicked'
  | 'learn_take_quiz_clicked'
  | 'learn_read_mode_opened'
  | 'learn_read_mode_fallback'
  | 'learn_review_weak_concept_clicked'
  // School-admin self-service billing (Phase 2-C of the May 2026 upgrade).
  // All server-side, fired from src/app/api/school-admin/subscription/route.ts.
  // PII-free — only school_id (uuid), plan, billing_cycle, seats counts.
  | 'school_billing_plan_change_started'
  | 'school_billing_plan_change_completed'
  | 'school_billing_plan_change_failed'
  | 'school_subscription_cancelled'
  | 'school_seat_cap_hit'
  // Offline payment reconciliation (Phase 3-B of the May 2026 upgrade).
  // Server-side from /api/super-admin/reconciliation routes. PII-free —
  // only ids, payment method, amounts, optional rejection reason text.
  | 'reconciliation_submitted'
  | 'reconciliation_approved'
  | 'reconciliation_rejected'
  // School contracts + renewal automation (Phase 3-C of the May 2026 upgrade).
  // Server-side from /api/super-admin/contracts routes. PII-free —
  // only contract_id, school_id, t_minus checkpoint, and status transitions.
  | 'contract_drafted'
  | 'contract_signed'
  | 'contract_renewed'
  | 'contract_cancelled'
  | 'contract_reminder_sent'
  | 'contract_expired'
  | 'contract_grace_suspended'
  // Learner Loop (ADR-001 Phase 1). Server-side from /api/learner/next.
  // PII-free — only branch identifier, reason key, and resolver inputs counts.
  | 'learner_next_resolved'
  | 'learner_next_404'
  // Adaptive Tutor (ADR-004 Phase 0). Server-side from /api/tutor/* and
  // client-side from /tutor page. PII-free — concept_id is a uuid, no name.
  | 'tutor_next_resolved'
  | 'tutor_next_404'
  | 'tutor_answer_recorded'
  | 'tutor_concept_viewed'
  | 'tutor_answer_submitted'
  // Adaptive Tutor (ADR-004 Phase 2 / ADR-005 Path C v2). Fired server-side
  // from /api/tutor/answer whenever the atomic tutor_commit_attempt RPC
  // fails and the route falls back to the legacy inline concept_mastery
  // write. Zero in steady state — non-zero is operations-critical.
  | 'tutor_answer_path_c_fallback'
  // Spine observability (ADR-005, Phase-5 Iter. 2). Fired by
  // supabase/functions/projector-health-check when a subscriber's
  // lag exceeds the threshold in docs/architecture/SLO.md
  // ("Projector lag" row). distinct_id is 'projector-health-check'.
  // Payload (PII-free): { subscriber_name, kind_filter, events_behind,
  // events_in_retry, events_dead_lettered, age_behind_seconds, severity:
  // 'warn'|'critical', threshold_seconds }. Zero events in steady state
  // — non-zero is on-call paging signal per docs/runbooks/projector-failure.md.
  | 'projector_health_degraded'
  // Super-admin per-school health dashboard (Phase E.6). Fired client-side
  // on page mount from /super-admin/health. PII-free — only the number of
  // schools rendered + whether the synthetic-monitor table was present.
  // Lets us measure how often ops consults the dashboard, and detect
  // graceful-degradation paths in the wild.
  | 'super_admin_health_dashboard_viewed'
  // AlfaBot landing widget (PR 3 of the AlfaBot feature). All client-side,
  // fired from src/components/alfabot/*. PII-free — never includes message
  // content, only audience, language, audit counts, and routing context.
  | 'alfabot_opened'
  | 'alfabot_closed'
  | 'alfabot_message_sent'
  | 'alfabot_message_received'
  | 'alfabot_starter_chip_clicked'
  | 'alfabot_audience_switched'
  | 'alfabot_lang_nudge_shown'
  | 'alfabot_lang_nudge_accepted'
  | 'alfabot_escape_to_contact'
  | 'alfabot_rate_limited'
  | 'alfabot_error_shown'
  | 'alfabot_inquiry_opened'
  | 'alfabot_inquiry_submitted'
  | 'alfabot_inquiry_failed'
  // Student dashboard CTA tracking (mobile-first redesign, Phase 1.5).
  // Fired client-side from the seven section components under
  // src/components/dashboard/sections/. Closes the "we don't know which
  // dashboard section drives clicks" telemetry gap identified in the ops
  // inventory before the Foxy/Learn/Parent/Teacher AppShell migration.
  // PII-free by design — only the section identifier (closed enum), the
  // action key (closed enum per section), and the destination route name.
  // NEVER includes student name, email, phone, grade, raw IDs, or any
  // chapter / subject metadata that could fingerprint a learner.
  | 'dashboard_cta_clicked';

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

// ─── /learn flow payloads (Phase 2-B) ───────────────────────────────
// All payloads are PII-free. The chapter page never carries names, emails,
// or phone numbers; concept titles are NOT included (they're free-form
// strings authored by content editors and could leak hints about a
// student's curriculum if cross-referenced).

interface LearnChapterContextBase {
  subject_code: string;     // 'math', 'science', etc. — closed set per SUBJECT_META.
  grade: string;            // '6'-'12' — closed set per CBSE.
  chapter_number: number;   // 1-N
  language: 'en' | 'hi';    // student's UI language at the moment of the event.
}

export interface LearnChapterStartedPayload extends LearnChapterContextBase {
  topic_count: number;
  question_count: number;
}

export interface LearnConceptAdvancedPayload extends LearnChapterContextBase {
  /** 0-indexed position the student JUST moved to. */
  concept_idx: number;
  /** Direction the student travelled. */
  direction: 'next' | 'previous';
}

export interface LearnQuickCheckSubmittedPayload extends LearnChapterContextBase {
  concept_idx: number;
  is_correct: boolean;
}

export interface LearnChapterCompletedPayload extends LearnChapterContextBase {
  /** 0-100. May be 0 when the student completes without answering anything. */
  score_pct: number;
  total_answered: number;
  correct_count: number;
  /** True when score_pct >= 60 and the chapter_progress write fires. */
  passed_threshold: boolean;
}

export interface LearnFoxyDoubtClickedPayload extends LearnChapterContextBase {
  /** Where the click came from: completion-screen weak-concepts callout vs in-flow askFoxy. */
  source: 'in_flow' | 'completion_weak_concepts';
}

export interface LearnTakeQuizClickedPayload extends LearnChapterContextBase {
  /** Score that earned the quiz CTA — only emitted when score_pct >= 60. */
  score_pct: number;
}

export interface LearnReadModeOpenedPayload extends LearnChapterContextBase {
  /** Where the toggle was triggered. 'header' = explicit user action; 'deep_link' = ?mode=read on entry. */
  trigger: 'header' | 'deep_link';
  /** Number of paragraphs the fetcher returned. 0 means we entered Read mode but had no content. */
  chunk_count: number;
}

/**
 * Emitted when Read mode is requested but the fetcher returns no content
 * (rag_content_chunks empty for this chapter). Tracks the content-coverage
 * gap so the team can see which chapters need ingestion.
 */
export interface LearnReadModeFallbackPayload extends LearnChapterContextBase {
  /** Why we fell back: 'empty' (rag_content_chunks returned 0 rows) or 'error' (query failed). */
  reason: 'empty' | 'error';
}

export interface LearnReviewWeakConceptClickedPayload extends LearnChapterContextBase {
  /** 0-indexed position of the weak concept the student was navigated to. */
  concept_idx: number;
}

// ─── School billing payloads (Phase 2-C) ────────────────────────────

interface SchoolBillingContextBase {
  school_id: string;        // uuid
  plan: string;             // 'starter' | 'pro' | 'unlimited' | 'trial'
  // 'quarterly' added with the self-service quarterly cadence (3-month cycle).
  billing_cycle: 'monthly' | 'quarterly' | 'yearly';
  seats: number;
}

export interface SchoolBillingPlanChangeStartedPayload extends SchoolBillingContextBase {
  /**
   * Where the flow started: 'self_service_post' (new sub) or 'self_service_patch'
   * (modify). The '*_comp' variants are the demo-school complimentary path
   * (P11 sanctioned exception — no Razorpay charge).
   */
  source: 'self_service_post' | 'self_service_patch' | 'self_service_post_comp' | 'self_service_patch_comp';
  /** Previous plan when this is a modification; null when it's a fresh subscription. */
  from_plan: string | null;
  /** Previous seats_purchased when this is a modification; null otherwise. */
  from_seats: number | null;
}

export interface SchoolBillingPlanChangeCompletedPayload extends SchoolBillingContextBase {
  source: 'self_service_post' | 'self_service_patch' | 'self_service_post_comp' | 'self_service_patch_comp';
  from_plan: string | null;
  from_seats: number | null;
  /** Razorpay subscription id created or updated. Empty string on the comp path. */
  razorpay_subscription_id: string;
}

export interface SchoolBillingPlanChangeFailedPayload extends SchoolBillingContextBase {
  source: 'self_service_post' | 'self_service_patch' | 'self_service_post_comp' | 'self_service_patch_comp';
  /** Closed-set reason; never includes free-form error text from Razorpay (PII risk). */
  reason: 'razorpay_error' | 'seat_cap_violation' | 'invalid_plan' | 'no_existing_subscription' | 'unknown';
}

export interface SchoolSubscriptionCancelledPayload extends SchoolBillingContextBase {
  /** Razorpay subscription id we cancelled. */
  razorpay_subscription_id: string;
  /** Cancellation timing — Razorpay supports immediate or end-of-cycle. */
  cancellation_timing: 'end_of_cycle' | 'immediate';
}

export interface SchoolSeatCapHitPayload {
  school_id: string;
  /** Where the cap was tripped. Closed set, expand carefully. */
  source: 'student_add' | 'invite_code_join' | 'bulk_upload';
  seats_purchased: number;
  seats_used: number;
  /** For bulk_upload: how many rows the upload would have added beyond the cap. */
  attempted_to_add?: number;
}

// ─── Phase 3-B — Offline payment reconciliation ────────────────────────────

export interface ReconciliationSubmittedPayload {
  reconciliation_id: string;
  invoice_id:        string;
  school_id:         string;
  payment_method:    'po' | 'bank_transfer' | 'cheque' | 'upi_offline';
  amount_inr:        number;
}

export interface ReconciliationApprovedPayload {
  reconciliation_id:   string;
  school_id:           string;
  invoice_id:          string;
  received_amount_inr: number;
  /** Output of the reconcile_payment() RPC — period_old / period_new etc. */
  rpc_result?:         unknown;
}

export interface ReconciliationRejectedPayload {
  reconciliation_id: string;
  school_id:         string;
  invoice_id:        string;
  /** Free-text reason; capped at 500 chars by the API. PII-free in practice. */
  reason:            string;
}

// ─── Phase 3-C — School contracts + renewal automation ─────────────────────

export interface ContractDraftedPayload {
  contract_id:    string;
  school_id:      string;
  contract_number: string;
  start_date:     string;  // ISO yyyy-mm-dd
  end_date:       string;
  billing_cycle:  'monthly' | 'quarterly' | 'annual' | 'custom';
  seats_purchased: number;
  value_inr:      number;
}

export interface ContractSignedPayload {
  contract_id:        string;
  school_id:          string;
  contract_number:    string;
  signed_pdf_attached: boolean;
}

export interface ContractRenewedPayload {
  new_contract_id:      string;
  previous_contract_id: string;
  school_id:            string;
  new_contract_number:  string;
}

export interface ContractCancelledPayload {
  contract_id:    string;
  school_id:      string;
  prior_status:   string;  // 'draft' | 'active' | 'expiring' | 'expired'
  reason?:        string;
}

export interface ContractReminderSentPayload {
  contract_id:  string;
  school_id:    string;
  /** T-minus days at which this reminder fired. Closed set: 60, 30, 15, 7, 1. */
  t_minus:      number;
  /** Did the email send succeed? Useful for failure budgets in PostHog. */
  delivered:    boolean;
}

export interface ContractExpiredPayload {
  contract_id: string;
  school_id:   string;
}

export interface ContractGraceSuspendedPayload {
  contract_id:    string;
  school_id:      string;
  /** Days past end_date when grace expired and suspension flipped. */
  grace_days:     number;
}

// ─── Learner Loop payloads (ADR-001 Phase 1) ────────────────────────
//
// Emitted server-side from /api/learner/next. PII-free by design — only
// branch identifiers (closed enum), reason keys (closed enum), and
// counts of resolver inputs. No subject names, no chapter titles, no
// auth_user_id (distinct_id carries that out-of-band).

export interface LearnerNextResolvedPayload {
  /** Which branch fired. Closed set — see ALL_ACTION_KINDS. */
  branch:
    | 'cold_start_diagnostic'
    | 'teacher_remediation' // Phase 3A Wave A / A3 — highest-priority branch
    | 'review_due_cards'
    | 'revise_decayed_topic'
    | 'start_quiz'
    | 'continue_lesson'
    | 'weekly_dive'
    | 'monthly_synthesis';
  /** Closed-set reason key the branch emitted. Stable for facet analysis. */
  reason: string;
  /** Resolver inputs at decision time — small ints, useful for funnel slicing. */
  due_review_count: number;
  attempted_quiz_today: boolean;
  in_progress_lesson_count: number;
  /** Number of subjects in the StudentState mastery array — coarse signal volume. */
  mastery_subject_count: number;
}

export interface LearnerNext404Payload {
  /** Why we 404'd. Closed set; expand carefully. */
  reason: 'flag_off' | 'no_profile';
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
  learn_chapter_started: LearnChapterStartedPayload;
  learn_concept_advanced: LearnConceptAdvancedPayload;
  learn_quick_check_submitted: LearnQuickCheckSubmittedPayload;
  learn_chapter_completed: LearnChapterCompletedPayload;
  learn_foxy_doubt_clicked: LearnFoxyDoubtClickedPayload;
  learn_take_quiz_clicked: LearnTakeQuizClickedPayload;
  learn_read_mode_opened: LearnReadModeOpenedPayload;
  learn_read_mode_fallback: LearnReadModeFallbackPayload;
  learn_review_weak_concept_clicked: LearnReviewWeakConceptClickedPayload;
  school_billing_plan_change_started: SchoolBillingPlanChangeStartedPayload;
  school_billing_plan_change_completed: SchoolBillingPlanChangeCompletedPayload;
  school_billing_plan_change_failed: SchoolBillingPlanChangeFailedPayload;
  school_subscription_cancelled: SchoolSubscriptionCancelledPayload;
  school_seat_cap_hit: SchoolSeatCapHitPayload;
  reconciliation_submitted: ReconciliationSubmittedPayload;
  reconciliation_approved: ReconciliationApprovedPayload;
  reconciliation_rejected: ReconciliationRejectedPayload;
  contract_drafted: ContractDraftedPayload;
  contract_signed: ContractSignedPayload;
  contract_renewed: ContractRenewedPayload;
  contract_cancelled: ContractCancelledPayload;
  contract_reminder_sent: ContractReminderSentPayload;
  contract_expired: ContractExpiredPayload;
  contract_grace_suspended: ContractGraceSuspendedPayload;
  learner_next_resolved: LearnerNextResolvedPayload;
  learner_next_404: LearnerNext404Payload;
  tutor_next_resolved: TutorNextResolvedPayload;
  tutor_next_404: TutorNext404Payload;
  tutor_answer_recorded: TutorAnswerRecordedPayload;
  tutor_concept_viewed: TutorConceptViewedPayload;
  tutor_answer_submitted: TutorAnswerSubmittedPayload;
  tutor_answer_path_c_fallback: TutorAnswerPathCFallbackPayload;
  projector_health_degraded: ProjectorHealthDegradedPayload;
  super_admin_health_dashboard_viewed: SuperAdminHealthDashboardViewedPayload;
  alfabot_opened: AlfabotOpenedPayload;
  alfabot_closed: AlfabotClosedPayload;
  alfabot_message_sent: AlfabotMessageSentPayload;
  alfabot_message_received: AlfabotMessageReceivedPayload;
  alfabot_starter_chip_clicked: AlfabotStarterChipClickedPayload;
  alfabot_audience_switched: AlfabotAudienceSwitchedPayload;
  alfabot_lang_nudge_shown: AlfabotLangNudgeShownPayload;
  alfabot_lang_nudge_accepted: AlfabotLangNudgeAcceptedPayload;
  alfabot_escape_to_contact: AlfabotEscapeToContactPayload;
  alfabot_rate_limited: AlfabotRateLimitedPayload;
  alfabot_error_shown: AlfabotErrorShownPayload;
  alfabot_inquiry_opened: AlfabotInquiryOpenedPayload;
  alfabot_inquiry_submitted: AlfabotInquirySubmittedPayload;
  alfabot_inquiry_failed: AlfabotInquiryFailedPayload;
  dashboard_cta_clicked: DashboardCtaClickedPayload;
};

// ── Adaptive Tutor payloads (ADR-004) ──────────────────────────────────
export interface TutorNextResolvedPayload {
  status: 'next_concept' | 'grade_complete' | 'no_content';
  reason: string | null;
  concept_id: string | null;
  subject: string | null;
  chapter_number: number | null;
  mastered: number | null;
  total: number | null;
}
export interface TutorNext404Payload {
  reason: 'flag_off' | 'no_student_profile';
}
export interface TutorAnswerRecordedPayload {
  concept_id: string;
  correct: boolean;
  new_mastery_mean: number;
  difficulty: number | null;
  /** ADR-004 Phase 2 (PR 2) — 'c' when the atomic RPC succeeded
   *  (optimistic value), 'legacy' when the Phase 0 inline write ran.
   *  Lets dashboards stack the two paths during rollout. */
  path?: 'c' | 'legacy';
}
export interface TutorAnswerPathCFallbackPayload {
  concept_id: string;
  attempt_id: string;
  /** Why the route fell back. Closed set; expand carefully. */
  reason: 'rpc_error';
  /** Short error message (truncate before emit if long). */
  error: string;
}
export interface TutorConceptViewedPayload {
  concept_id: string | null;
  subject: string | null;
  chapter_number: number | null;
  status: 'next_concept' | 'grade_complete' | 'no_content';
}
export interface TutorAnswerSubmittedPayload {
  concept_id: string;
  correct: boolean;
  chosen_index: number;
  response_time_ms: number;
}

// ── Spine observability payloads (ADR-005, Phase-5 Iter. 2) ─────────────
export interface ProjectorHealthDegradedPayload {
  /** Name of the lagging subscriber per STANDARD_SUBSCRIBERS. */
  subscriber_name: string;
  /** Event kind the subscriber filters on (e.g., 'learner.concept_check_answered'). */
  kind_filter: string;
  /** Count of unprocessed events of `kind_filter` ahead of the cursor. */
  events_behind: number;
  /** Count of events currently in subscriber_retry_state. */
  events_in_retry: number;
  /** Cumulative count of events that have ever dead-lettered for this subscriber. */
  events_dead_lettered: number;
  /** Wall-clock seconds since the subscriber last advanced. */
  age_behind_seconds: number;
  /** Severity bucket per docs/architecture/SLO.md "Projector lag" row. */
  severity: 'warn' | 'critical';
  /** The threshold (in seconds) that this row crossed. */
  threshold_seconds: number;
}

// ── AlfaBot landing widget payloads (PR 3) ─────────────────────────────
//
// All payloads are PII-free. Never include message content, assistant text,
// email, phone, name, or IP. The widget enforces this by passing ONLY the
// fields below into `track()` — message strings stay in component state.

export type AlfabotAudienceTag = 'parent' | 'student' | 'teacher' | 'school';
export type AlfabotLangTag = 'en' | 'hi';

interface AlfabotEventContextBase {
  audience: AlfabotAudienceTag;
  language: AlfabotLangTag;
}

export interface AlfabotOpenedPayload extends AlfabotEventContextBase {
  /** Where the open came from. */
  source: 'bubble' | 'speech_tail' | 'faq_link' | 'prefill';
  /** Seconds since the page loaded — bucketed by widget caller. */
  seconds_since_pageload: number;
}

export interface AlfabotClosedPayload extends AlfabotEventContextBase {
  /** How the panel closed. */
  via: 'close_button' | 'escape_key' | 'outside_click' | 'mobile_menu';
  /** Total messages exchanged in the open session (user + assistant). */
  message_count: number;
}

export interface AlfabotMessageSentPayload extends AlfabotEventContextBase {
  /** Closed-set provenance — never the message text. */
  via: 'typed' | 'starter_chip' | 'prefill' | 'faq_link';
  /** Length bucket — keeps it PII-safe but lets us spot abusively long inputs. */
  length_bucket: 'short' | 'medium' | 'long';
  /** Index of the message in the session (0 = first). */
  message_index: number;
}

export interface AlfabotMessageReceivedPayload extends AlfabotEventContextBase {
  /** Did the bot abstain? Closed set mirrors AlfabotResponse['abstainReason']. */
  abstain_reason?:
    | 'prompt_injection'
    | 'url_in_message'
    | 'message_too_long'
    | 'denylisted'
    | 'upstream_failed'
    | 'budget_exhausted'
    | 'kb_no_match';
  /** Number of KB sources the route reported. */
  sources_used: number;
  /** True iff the route returned `degradedMode: true`. */
  degraded_mode: boolean;
  /** Wall-clock streaming duration in ms. */
  latency_ms: number;
}

export interface AlfabotStarterChipClickedPayload extends AlfabotEventContextBase {
  /** 0-3 position of the chip in the rendered list. */
  chip_index: number;
  /** English chip text — analytics-friendly grouping even on Hi UI. */
  chip_text_en: string;
}

export interface AlfabotAudienceSwitchedPayload {
  from_audience: AlfabotAudienceTag;
  to_audience: AlfabotAudienceTag;
  /** Where the switch happened — header link or inline starter row. */
  source: 'header' | 'starter';
}

export interface AlfabotLangNudgeShownPayload extends AlfabotEventContextBase {
  /** Approx % Devanagari characters in the triggering user message. */
  devanagari_ratio: number;
}

export interface AlfabotLangNudgeAcceptedPayload extends AlfabotEventContextBase {
  /** 'accepted' = clicked switch; 'dismissed' = closed the nudge. */
  action: 'accepted' | 'dismissed';
}

export interface AlfabotEscapeToContactPayload extends AlfabotEventContextBase {
  /** Destination clicked. */
  destination: 'contact_page' | 'whatsapp';
}

export interface AlfabotRateLimitedPayload extends AlfabotEventContextBase {
  /** Which bucket tripped (mirrors AlfabotErrorResponse['scope']). */
  scope: 'burst' | 'day' | 'ip' | 'session_max' | 'lead';
  /** Seconds until the bucket resets (best-effort; null when unknown). */
  reset_in_seconds: number | null;
}

export interface AlfabotErrorShownPayload extends AlfabotEventContextBase {
  /** Closed-set error key — mirrors the AlfabotErrorResponse envelope. */
  error: 'network_error' | 'upstream_failed' | 'invalid_input' | 'denied' | 'not_found';
}

// AlfaBot inquiry (Submit your query) — three lifecycle events.
//
// PII-free: never includes name / email / question content. We only ship
// the audience + language + a coarse reason key on failures.

export interface AlfabotInquiryOpenedPayload extends AlfabotEventContextBase {
  /** Where the inquiry view was opened from. */
  source: 'escape_hatch' | 'starter_chip' | 'rate_limit_banner';
}

export interface AlfabotInquirySubmittedPayload extends AlfabotEventContextBase {
  /** Whether the visitor provided an optional name (no name CONTENT). */
  has_name: boolean;
  /** Question length bucket — PII-safe but spots abusively long inputs. */
  length_bucket: 'short' | 'medium' | 'long';
}

export interface AlfabotInquiryFailedPayload extends AlfabotEventContextBase {
  /** Closed-set reason mirroring AlfabotErrorResponse. */
  reason:
    | 'invalid_input'
    | 'rate_limited'
    | 'denied'
    | 'mail_send_failed'
    | 'upstream_failed'
    | 'network_error';
}

// ── Student dashboard CTA payload (mobile-first redesign Phase 1.5) ────
//
// Fired from the seven section components under
// src/components/dashboard/sections/. Carries:
//   - `section` (closed enum) — WHICH section the click happened in.
//   - `action`  (closed enum) — WHAT the user activated within that section.
//   - `destination` (string)  — WHERE the click routes the user.
//
// P13 (Data Privacy) — no PII fields ever attached:
//   no name, no email, no phone, no raw user_id, no grade, no chapter/topic
//   titles, no streak/XP numbers (those flow via existing `xp_awarded`
//   events). The redactor in src/lib/analytics.ts is a defence-in-depth
//   backstop, but the call sites themselves are the primary guarantee.
//
// `destination` is intentionally a string (not a closed enum) because the
// dashboard CTAs already deep-link with query strings (e.g. /quiz?qid=...,
// /learn/math/3). To keep PII-risk low we DO NOT facet on it in dashboards
// — we facet on `section` + `action` and use `destination` only for
// debugging the path the user took.

export interface DashboardCtaClickedPayload {
  /**
   * Which dashboard section the CTA lives in. Closed set — adding a new
   * section means adding the literal here so funnels never silently split.
   *
   * Section keys map 1:1 to component files under
   * src/components/dashboard/sections/.
   */
  section:
    | 'above_fold_hero'
    | 'quick_actions'
    | 'todays_focus'
    | 'compete'
    | 'progress'
    | 'upcoming'
    | 'daily_rhythm_queue';
  /**
   * The action key the user pressed within that section. Closed set so
   * PostHog funnels stay stable across UI tweaks. Keep these short and
   * kebab/snake-cased — they're analytics primary keys.
   */
  action: string;
  /**
   * The route the click is sending the user to. Free-form because some
   * CTAs include query strings (e.g. `/quiz?mode=srs`, `/learn/math/3`).
   * Capped at 256 chars on emit — see DASHBOARD_CTA_DESTINATION_MAX.
   */
  destination: string;
}

// ── Super-admin Health Dashboard payload (Phase E.6) ──────────────────
//
// Fired client-side once on /super-admin/health mount. We don't fire on
// re-fetch — only the first successful render — so the event count is
// "operator viewed the dashboard", not "the page hit /api/.../health".
//
// PII-free by design: only counts + the synthetic-monitor degradation
// flag. No school names, no school ids, no operator email. The redactor
// in src/lib/analytics.ts is a defense-in-depth backstop.
export interface SuperAdminHealthDashboardViewedPayload {
  /** Total schools returned by the BFF (pre-sort, post-filter). */
  total_schools: number;
  /** Schools with >0 distinct active users in the last 7 days. */
  active_in_last_7d: number;
  /**
   * Whether the BFF degraded the synthetic-monitor column. True when
   * the `synthetic_monitor_results` table is missing (E.5 not yet
   * merged). Lets us alert if this ever flips back to true post-E.5.
   */
  synthetic_monitor_degraded: boolean;
}

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
