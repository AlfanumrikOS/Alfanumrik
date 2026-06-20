/**
 * src/lib/today/types.ts — the "Today" home render contract (Wave A).
 *
 * The Learner Loop's resolver (`resolveTodayQueue`) answers "what could this
 * student do today?" as an ordered list of `LearnerAction`s — a pure,
 * presentation-free discriminated union. This module is the RENDER-facing
 * projection of that contract: the shape `GET /api/v2/today` returns and the
 * "Today" home UI consumes.
 *
 * Single-source-of-truth discipline:
 *   - All "what next" logic stays in `resolveTodayQueue`. This module only
 *     PROJECTS a resolved `LearnerAction` into a render DTO.
 *   - `deepLink` is derived by PARSING `action.url` (the resolver's url is the
 *     navigation contract) — never hand-built here.
 *   - `labelKey` / `subtitleKey` are i18n keys (P7). Pages translate them into
 *     bilingual copy; no user-visible English/Hindi strings live here.
 *   - `estMinutes` are presentation badges only — NOT timing-model values and
 *     NOT derived from any scoring/XP formula (P1/P2 untouched).
 *
 * Schema-versioned (`schemaVersion: 1`) so clients can branch when the Today
 * item set grows.
 */

/**
 * The render-facing item type. This is the PROJECTION of `LearnerAction.kind`
 * (plus, for `start_quiz`, a split on `reason`). It is deliberately distinct
 * from the resolver's `LearnerActionKind` so the UI's taxonomy can evolve
 * without touching the loop contract:
 *
 *   resolver kind            reason                 → TodayItemType
 *   ─────────────────────────────────────────────────────────────────────
 *   resume_in_progress       live_session           → resume_in_progress
 *   cold_start_diagnostic    no_signals_yet         → cold_start_diagnostic
 *   review_due_cards         (any)                  → srs_due
 *   revise_decayed_topic     decay_above_threshold  → revise_decayed_topic
 *   start_quiz               todays_zpd             → weak_topic_zpd
 *   start_quiz               weakest_topic_practice → practice_weakest
 *   continue_lesson          in_progress_lesson     → continue_lesson
 *   introduce_new_topic      unstarted_chapter_available → new_topic
 *   weekly_dive              sunday_default         → weekly_dive_due
 *   monthly_synthesis        month_end_default      → monthly_synthesis_due
 */
export type TodayItemType =
  | 'resume_in_progress'
  | 'cold_start_diagnostic'
  | 'teacher_remediation'
  | 'srs_due'
  | 'revise_decayed_topic'
  | 'weak_topic_zpd'
  | 'continue_lesson'
  | 'new_topic'
  | 'weekly_dive_due'
  | 'monthly_synthesis_due'
  | 'practice_weakest';

/** A parsed, navigable deep link derived from a `LearnerAction.url`. */
export interface TodayDeepLink {
  /** The pathname, e.g. `/quiz`, `/learn/science/3`, `/review`. */
  route: string;
  /** Parsed querystring params (string values, numeric where unambiguous).
   *  Omitted entirely when the url carried no querystring. */
  params?: Record<string, string | number>;
}

/**
 * One render-ready card on the Today home. A projection of a single
 * `LearnerAction` — never invented, always derived.
 */
export interface TodayQueueItem {
  /** Render-facing type (see `TodayItemType`). */
  type: TodayItemType;
  /** 1-based position in the Today queue. `rank === 1` is the primary CTA. */
  rank: number;
  /** i18n key for the card title — `today.item.<type>.label`. */
  labelKey: string;
  /** i18n key for the card subtitle — `today.item.<type>.subtitle`. */
  subtitleKey: string;
  /** Presentation-only estimated minutes badge. NOT a timing-model value. */
  estMinutes: number;
  /** Navigation target, parsed from `action.url`. */
  deepLink: TodayDeepLink;
  /** Opaque icon identifier the UI maps to a glyph. */
  iconHint: string;
  /** The resolver's opaque `reason` string — telemetry + aria, not copy. */
  reason: string;
  /** Per-type diagnostic fields lifted verbatim from the source action.
   *  Only fields already present on the action are surfaced; absent fields
   *  are omitted (never fabricated). */
  meta?: Record<string, unknown>;
}

/** The envelope `GET /api/v2/today` returns. */
export interface TodayResponse {
  schemaVersion: 1;
  /** ISO-8601 timestamp the queue was resolved at — UI can show "as of …". */
  resolvedAt: string;
  /** The single primary CTA (equals `queue[0]`). */
  primary: TodayQueueItem;
  /** The ordered Today queue, primary first. */
  queue: TodayQueueItem[];
  /** Cheap diagnostics for telemetry; clients should not depend on them. */
  meta: {
    /** Which raw resolver branch fired (may differ from `primary.type`
     *  under the live-resume exception). */
    branch: string;
    /** Number of subjects with a mastery rollup — coverage signal. */
    masterySubjectCount: number;
    /** Number of flashcards due as of resolution. */
    dueReviewCount: number;
    /** Whether the student has completed at least one quiz session today (IST). */
    practicedToday: boolean;
  };
}
