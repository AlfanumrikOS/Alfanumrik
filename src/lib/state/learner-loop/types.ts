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

/**
 * Teacher-assigned remediation (Phase 3A Wave A / A3). The HIGHEST-priority
 * action: when a teacher has flagged this student × concept for follow-up
 * (`teacher_remediation_assignments.status ∈ {assigned, in_progress}`), the
 * assigned remediation jumps ahead of every routine SRS/ZPD/reflection slot.
 *
 * `source: 'teacher'` is the queue marker the UI renders as "from your
 * teacher". `assignmentId` is the `teacher_remediation_assignments.id` the
 * Today completion flow uses to flip the assignment to `resolved` (see the
 * /api/rhythm/remediation/[id]/resolve seam).
 *
 * The action REUSES the existing student remediation / targeted-practice for
 * that chapter — no new quiz type is invented. `url` points at the SAME quiz
 * route the `start_quiz` branches use:
 *   - chapter-anchored : `/quiz?subject=…&chapter=…&remediationId=…&from=teacher`
 *   - general (chapter_id null) : falls back to the student's WEAKEST chapter
 *     (existing `weakestChapter` logic), still tagged source:'teacher'.
 *
 * NO scoring / XP / anti-cheat semantics live here (P1/P2/P3 untouched) — the
 * assigned task runs as a normal student quiz; this only changes WHICH item is
 * surfaced and carries the tracking id.
 */
export interface TeacherRemediationAction {
  kind: 'teacher_remediation';
  url: string;
  /** Always 'teacher' — the queue marker the UI renders as "from your teacher". */
  source: 'teacher';
  /** teacher_remediation_assignments.id — used to flip status on completion. */
  assignmentId: string;
  /** curriculum_topics.id the teacher assigned (null = general remediation). */
  chapterId: string | null;
  /** Present only when the assignment resolved to a concrete chapter (or the
   *  weakest-chapter fallback) — lets the UI label/deep-link without re-reading. */
  subjectCode?: string;
  chapterNumber?: number;
  reason: 'teacher_assigned';
}

/**
 * Resume an activity the learner is mid-way through RIGHT NOW
 * (`state.live.kind !== 'idle'`). Synthetic — it is NOT a resolver branch;
 * it is prepended by `resolveTodayQueue()` so a live session always wins
 * the CTA. The `url` reuses the live state's existing target derivation
 * (in_quiz → /quiz, in_foxy → /foxy, in_lesson → /learn/{subject}/{chapter}).
 * `liveKind` carries the source so the UI can label it without re-reading
 * `state.live`.
 */
export interface ResumeInProgressAction {
  kind: 'resume_in_progress';
  url: string;
  liveKind: 'in_quiz' | 'in_foxy' | 'in_lesson';
  /** Present only for in_quiz / in_lesson (chapter-anchored sessions). */
  subjectCode?: string;
  chapterNumber?: number;
  reason: 'live_session';
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
  | TeacherRemediationAction
  | ReviewDueCardsAction
  | ReviseDecayedTopicAction
  | StartQuizAction
  | ContinueLessonAction
  | WeeklyDiveAction
  | MonthlySynthesisAction
  | ResumeInProgressAction;

/** Frozen list of all action kinds — used by tests + telemetry. */
export const ALL_ACTION_KINDS = [
  'cold_start_diagnostic',
  'teacher_remediation',
  'review_due_cards',
  'revise_decayed_topic',
  'start_quiz',
  'continue_lesson',
  'weekly_dive',
  'monthly_synthesis',
  'resume_in_progress',
] as const satisfies ReadonlyArray<LearnerAction['kind']>;

export type LearnerActionKind = LearnerAction['kind'];

/**
 * The subset of actions `resolveNextLearnerAction()` can return — i.e. the
 * 8 ordered resolver branches, EXCLUDING the synthetic `resume_in_progress`
 * (which only `resolveTodayQueue()` ever emits, as the live-resume CTA).
 * Keeping the resolver's return narrowed preserves the closed-set
 * telemetry contract (`LearnerNextResolvedPayload.branch`) without a cast.
 */
export type ResolverAction = Exclude<LearnerAction, ResumeInProgressAction>;
export type ResolverActionKind = ResolverAction['kind'];

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

// ── Today queue (Wave A) ─────────────────────────────────────────────
//
// `resolveTodayQueue()` returns this. It is NOT a new decision tree — it
// runs the SAME ordered branch predicates as `resolveNextLearnerAction()`
// and collects EVERY eligible branch (truncated to MAX_TODAY_QUEUE_ITEMS)
// instead of stopping at the first. The single-source-of-truth invariant:
// `result.primary` equals `resolveNextLearnerAction(...)` in every case
// EXCEPT the live-resume exception (see ResumeInProgressAction), where a
// mid-session activity is prepended as the CTA.
//
// The queue element type is `LearnerAction` (the contract's discriminated
// union). The render-facing TodayQueueItem mapping is the backend's job —
// this module deliberately stays pure and presentation-free.

/** Hard cap on Today-queue length — the queue is a short, finite list of
 *  "what you could do today", not a backlog. The UI shows ≤ this many
 *  cards. NOT a tunable learner-state threshold; it's a presentation cap. */
export const MAX_TODAY_QUEUE_ITEMS = 6;

export interface TodayQueueResult {
  /** The single action the primary CTA should dispatch. Equals the raw
   *  first-match branch EXCEPT under the live-resume exception, where the
   *  synthetic resume action wins. */
  primary: LearnerAction;
  /** Ordered list of eligible actions, in branch order, ≤ MAX_TODAY_QUEUE_ITEMS.
   *  `queue[0]` === `primary`. */
  queue: LearnerAction[];
  /** Which branch the *raw resolver* chose (i.e. what `resolveNextLearnerAction`
   *  returns). Equals `primary.kind` unless live-resume overrode the CTA —
   *  telemetry uses this to see what the learner "would" have been routed to. */
  branch: LearnerActionKind;
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
