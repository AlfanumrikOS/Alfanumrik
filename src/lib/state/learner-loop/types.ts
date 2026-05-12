/**
 * src/lib/state/learner-loop/types.ts — the Learner Loop's output contract.
 *
 * The Loop's resolver answers ONE question for every student-facing entry
 * point: "what should this student do right now?" It returns a typed
 * `LearnerAction` discriminated union the UI can dispatch unconditionally
 * — every "Begin Lesson" / "Continue" / "Start Today's Quiz" button calls
 * the same endpoint and routes to the returned `url`.
 *
 * See `docs/architecture/ADR-001-learner-loop-unification.md` for the
 * strategic context. This module is the contract; `resolve-next-action.ts`
 * is the implementation.
 *
 * Schema-versioned for forward compatibility — clients can branch on
 * `schemaVersion` when the Loop's branch set grows.
 */

// ── Action kinds ─────────────────────────────────────────────────────
//
// Each variant carries the route the UI should navigate to plus the
// minimum diagnostic data the page can use to deep-link or pre-fetch.
// `reason` is a short opaque string used by telemetry and surfaced as a
// caption / aria-label — NOT user-visible copy. Pages translate the
// reason key into bilingual UX strings on their side.

/** Cold-start diagnostic — emitted when the learner has no signal yet. */
export interface ColdStartDiagnosticAction {
  kind: 'cold_start_diagnostic';
  url: '/diagnostic';
  reason: 'no_signals_yet';
}

/** Today's flashcard reviews are stacking — surface them first. */
export interface ReviewDueCardsAction {
  kind: 'review_due_cards';
  url: '/review';
  dueCount: number;
  reason: 'reviews_stacking' | 'reviews_due_today';
}

/** Re-encounter source content for a topic that's decayed below threshold. */
export interface ReviseDecayedTopicAction {
  kind: 'revise_decayed_topic';
  url: string; // `/learn/${subjectCode}/${chapterNumber}?mode=read&from=revise`
  subjectCode: string;
  chapterNumber: number;
  daysSinceLastTouch: number;
  recommendedModality: 'read' | 'explainer' | 'worked-example';
  reason: 'decay_above_threshold';
}

/** Today's ZPD problem — practice in the productive-failure zone. */
export interface StartQuizAction {
  kind: 'start_quiz';
  url: string; // `/quiz?subject=${subjectCode}&chapter=${chapterNumber}`
  subjectCode: string;
  chapterNumber: number;
  zpdBin: 1 | 2 | 3;
  reason: 'todays_zpd' | 'weakest_topic_practice';
}

/** Continue an in-progress lesson at ≥50% complete. */
export interface ContinueLessonAction {
  kind: 'continue_lesson';
  url: string; // `/learn/${subjectCode}/${chapterNumber}`
  subjectCode: string;
  chapterNumber: number;
  progressPct: number; // 0..1
  reason: 'in_progress_lesson';
}

/** Sunday default — the weekly curiosity dive. */
export interface WeeklyDiveAction {
  kind: 'weekly_dive';
  url: '/dive';
  suggestedPrompt: string;
  reason: 'sunday_default';
}

/** Month-end day default — emit the monthly synthesis artifact. */
export interface MonthlySynthesisAction {
  kind: 'monthly_synthesis';
  url: '/progress?view=synthesis';
  reason: 'month_end_default';
}

/** The discriminated union returned by the resolver. */
export type LearnerAction =
  | ColdStartDiagnosticAction
  | ReviewDueCardsAction
  | ReviseDecayedTopicAction
  | StartQuizAction
  | ContinueLessonAction
  | WeeklyDiveAction
  | MonthlySynthesisAction;

/** Frozen list of all action kinds — used by tests + telemetry. */
export const ALL_ACTION_KINDS = [
  'cold_start_diagnostic',
  'review_due_cards',
  'revise_decayed_topic',
  'start_quiz',
  'continue_lesson',
  'weekly_dive',
  'monthly_synthesis',
] as const satisfies ReadonlyArray<LearnerAction['kind']>;

export type LearnerActionKind = LearnerAction['kind'];

// ── Resolver envelope ────────────────────────────────────────────────

/** The endpoint returns this envelope — schemaVersion + action + meta. */
export interface ResolveNextResponse {
  schemaVersion: 1;
  /** ISO-8601 timestamp the resolver ran at — UI can show "as of …". */
  resolvedAt: string;
  /** The action the UI should dispatch. */
  action: LearnerAction;
  /** Cheap diagnostic fields telemetry uses; clients should NOT depend on them. */
  meta: {
    /** Which branch fired. Same as `action.kind` today; reserved for future
     *  cases where the chosen action differs from the branch identifier. */
    branch: LearnerActionKind;
    /** Was the response served from the in-process resolver cache? */
    cached: boolean;
  };
}

// ── Tuning constants (deliberate, named, testable) ───────────────────
//
// Tightly grouped so the test suite can override them and the rule-engine
// stdlib can subscribe to changes if we ever flag-gate the Loop's
// sensitivity per-tenant.

export const LEARNER_LOOP_CONFIG = {
  /** Cold-start threshold — fewer attempts than this means we recommend
   *  the diagnostic first. Conservative — most learners cross this on day 1. */
  COLD_START_MAX_ATTEMPTS: 5,

  /** Surface flashcards as the next action when at least this many are
   *  due today. Tomorrow's reviews compound — keep the queue short. */
  REVIEW_STACKING_THRESHOLD: 5,

  /** A topic is "decayed" when mastery is above this and the last-touch
   *  age exceeds the retention window for that mastery (see below). */
  REVISE_MIN_MASTERY: 0.6,

  /** Per-mastery retention windows. Higher mastery → longer interval.
   *  Reads like a step function on top of Ebbinghaus — keep it cheap. */
  RETENTION_WINDOW_DAYS: (mastery: number): number => {
    if (mastery >= 0.9) return 21;
    if (mastery >= 0.8) return 14;
    if (mastery >= 0.7) return 10;
    return 7;
  },

  /** ZPD bin from mastery — 1 = easy (mastery low), 3 = hard (mastery high). */
  ZPD_BIN_FOR_MASTERY: (mastery: number): 1 | 2 | 3 => {
    if (mastery < 0.4) return 1;
    if (mastery < 0.75) return 2;
    return 3;
  },

  /** A lesson is "continue-worthy" when it's at least this fraction complete. */
  CONTINUE_LESSON_MIN_PROGRESS: 0.5,
} as const;
