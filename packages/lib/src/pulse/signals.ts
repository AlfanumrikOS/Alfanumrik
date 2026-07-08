// src/lib/pulse/signals.ts
//
// Student Pulse — pure signal-derivation layer.
//
// This module derives the three "Pulse" monitoring signals (inactivity,
// mastery-cliff, at-risk concentration) from already-aggregated raw inputs.
// It is a PURE module: zero I/O, zero DB, zero fetch, zero clock reads other
// than the explicit `nowMs` the caller passes in. Every API route (self /
// child / class / school lens) imports `deriveSignals` and feeds it inputs it
// has already authorized + read. Keeping the math here makes it unit-testable
// in isolation and guarantees all four lenses agree on what a signal means.
//
// Style mirrors src/lib/irt/fisher-info.ts: documented constants, exported
// types for inputs + outputs, a single pure entry point.
//
// ─── Anchoring to existing platform conventions (do NOT invent new ones) ─────
//
// 1. AT-RISK MASTERY THRESHOLD = 0.4.
//    A chapter/concept is "at risk" when its mastery (BKT p_know, 0..1) is
//    BELOW 0.4. This is the SAME constant the platform already uses:
//      - supabase/migrations/20260614000003_phase3b_school_reporting.sql
//        (`AT_RISK_PKNOW_THRESHOLD = 0.4`; `get_school_mastery_rollup` and the
//        Wave A `get_classes_at_risk` RPC both count students whose avg
//        p_know < 0.4 as at-risk).
//      - src/lib/cognitive-engine.ts: mastery < 0.4 => 'building' /
//        'conceptual' error band; >= 0.4 && < 0.8 => 'developing';
//        >= 0.8 => 'mastered'.
//    Pulse reuses 0.4 verbatim — no conflicting definition.
//
// 2. STREAK-RESET WINDOW.
//    supabase/functions/daily-cron/index.ts `resetMissedStreaks()` resets a
//    streak (streak_days -> 0) when the student's last qualifying activity is
//    strictly BEFORE yesterday-00:00 UTC. Concretely:
//      - active TODAY (UTC)        => streak intact (OK).
//      - active YESTERDAY (UTC)    => streak still intact, but tonight's cron
//                                     will reset it unless they study today.
//                                     This is the documented GRACE day.
//      - active 2+ full UTC days   => last_session_at < yesterday-00:00 =>
//                                     streak is already (or about to be) reset.
//    Pulse's inactivity bands map directly onto these three cases. We do NOT
//    invent a separate window — we read the same UTC-calendar-day boundary the
//    cron uses. (A streak FREEZE can save a missed day, but freeze state is a
//    separate input the caller may pass to suppress the 'broken' verdict.)
//
// 3. MASTERY-CHANGE PAYLOAD SHAPE.
//    The `learner.mastery_changed` ADR-005 spine event (emitted by
//    src/lib/quiz/submit-side-effects.ts `computeMasteryDeltas`) carries
//    `fromMastery: number | null` and `toMastery: number`, both BKT p_know in
//    0..1, plus `subjectCode` and `chapterNumber`. Pulse's mastery-cliff input
//    mirrors that shape so the backend can map timeline rows 1:1 with no
//    re-derivation.
//
// P5: grades are strings; this module never touches grade, but any subject /
// chapter identifiers are passed through verbatim. P13: outputs are derived
// verdicts + counts + identifiers only — never raw PII.

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS — single source of truth. No magic numbers anywhere else in Pulse.
// ════════════════════════════════════════════════════════════════════════════

export const PULSE_THRESHOLDS = {
  // ── Inactivity ────────────────────────────────────────────────────────────
  // Number of whole UTC calendar days since last activity at which the streak
  // GRACE window ends. 0 = active today, 1 = active yesterday (grace), >=2 =
  // streak already eligible for reset. Anchored to daily-cron's
  // `last_session_at < yesterday-00:00 UTC` reset predicate.
  /** Days-since-active that still counts as fully active (today). */
  inactivity_ok_max_days: 0,
  /** Days-since-active that is the streak grace day (yesterday). At-risk. */
  inactivity_grace_days: 1,
  // >= inactivity_grace_days + 1 (i.e. >= 2) => broken.

  // ── Mastery-cliff ─────────────────────────────────────────────────────────
  // At-risk mastery line, reused from the platform-wide 0.4 convention. A
  // chapter at/above this is "not at risk"; below it is "at risk".
  at_risk_mastery: 0.4,
  // Single-event drop magnitude (fromMastery - toMastery, both 0..1) that, on
  // its own, flags a mastery cliff. 0.15 ≈ losing more than one full BKT band
  // step in one sitting — a meaningful, non-noise regression. Chosen so a drop
  // that lands a chapter below the 0.4 at-risk line, OR a steep absolute drop
  // even while still above the line, both register.
  mastery_cliff_drop: 0.15,
  // Consecutive declining quiz scores that flag a cliff via the score-trend
  // path (used when no mastery_changed delta is available). 3 strictly
  // declining scores in a row = a sustained downward trend, not a single bad
  // day. Mirrors the "3 consecutive errors -> ease off" adaptive convention.
  mastery_cliff_decline_streak: 3,

  // ── At-risk concentration ─────────────────────────────────────────────────
  // Per-subject count of chapters with mastery < at_risk_mastery, bucketed into
  // bands. 0 below the line = none; 1-2 = low; 3-4 = medium; 5+ = high. Bands
  // chosen so a single weak chapter is "low" (normal learning), a cluster of
  // 3+ is "medium" (a subject-level gap forming), and 5+ is "high" (systemic —
  // the subject itself is at risk, matching the at-risk-cluster intent).
  concentration_low_min: 1,
  concentration_medium_min: 3,
  concentration_high_min: 5,
} as const;

// ════════════════════════════════════════════════════════════════════════════
// VERDICT ENUMS
// ════════════════════════════════════════════════════════════════════════════

/** Inactivity / streak-break risk. */
export type InactivityVerdict =
  | 'ok'         // active today (within streak window, no risk)
  | 'at_risk'    // last active yesterday — grace day; studies today or resets tonight
  | 'broken'     // last active 2+ UTC days ago — streak already lost / eligible for reset
  | 'never'      // no recorded activity at all (never_active)
  | 'unknown';   // last_active missing/unparseable — degrade gracefully

/** Mastery-cliff (a meaningful regression in a previously-stronger area). */
export type MasteryCliffVerdict =
  | 'none'       // no qualifying drop / decline
  | 'flagged'    // a cliff was detected (drop magnitude and/or decline streak)
  | 'unknown';   // insufficient history to judge (no deltas, < 2 scores)

/** At-risk concentration severity for a single subject. */
export type ConcentrationBand = 'none' | 'low' | 'medium' | 'high';

// ════════════════════════════════════════════════════════════════════════════
// INPUT TYPES (raw, already-aggregated upstream by the API route)
// ════════════════════════════════════════════════════════════════════════════

/**
 * One `learner.mastery_changed` timeline entry, shaped exactly like the
 * ADR-005 spine payload (`computeMasteryDeltas` output). Both mastery values
 * are BKT p_know in 0..1. `fromMastery` is null on a first-ever attempt.
 */
export interface MasteryChangeEvent {
  subjectCode: string;
  chapterNumber: number;
  fromMastery: number | null;
  toMastery: number;
  /** Optional event time (ms epoch). Not required for the math; ordering of
   *  the array is assumed chronological. Kept for caller convenience. */
  occurredAtMs?: number;
}

/** Per-subject chapter-mastery snapshot for the concentration signal. */
export interface SubjectMasterySnapshot {
  subject: string;
  /** Mastery (0..1) for each chapter the student has a reading for. */
  chapterMasteries: number[];
}

/**
 * The complete raw input bundle for `deriveSignals`. The API route assembles
 * this from `buildStudentState()` + the `state_events` timeline (already
 * authorized + RLS-scoped). Every field is optional/defensive so the function
 * degrades to 'unknown'/'never'/empty rather than throwing.
 */
export interface PulseRawInput {
  /** Current wall-clock as ms epoch — passed in so the module stays pure. */
  nowMs: number;

  /** Last qualifying activity as ms epoch, or null/undefined if never active. */
  lastActiveMs?: number | null;

  /** Whether a streak freeze is available to absorb a missed day. When true,
   *  a 'broken' inactivity verdict is softened to 'at_risk' (the freeze will
   *  save the streak on the next cron run, mirroring daily-cron behavior). */
  hasStreakFreeze?: boolean;

  /** Chronological `learner.mastery_changed` events (oldest -> newest). */
  masteryEvents?: MasteryChangeEvent[];

  /** Recent quiz scores (0..100), chronological oldest -> newest. Used for the
   *  decline-streak fallback path when no mastery deltas are present. */
  recentQuizScores?: number[];

  /** Per-subject chapter-mastery snapshots for at-risk concentration. */
  subjectSnapshots?: SubjectMasterySnapshot[];
}

// ════════════════════════════════════════════════════════════════════════════
// OUTPUT TYPES
// ════════════════════════════════════════════════════════════════════════════

export interface InactivitySignal {
  verdict: InactivityVerdict;
  /** Whole UTC calendar days since last activity; null when never/unknown. */
  daysSinceActive: number | null;
}

export interface MasteryCliffSignal {
  verdict: MasteryCliffVerdict;
  /** Largest single-event drop (fromMastery - toMastery) observed, 0..1; null
   *  if no mastery deltas were available to measure. */
  largestDrop: number | null;
  /** Length of the longest run of strictly declining recent quiz scores; 0
   *  when fewer than 2 scores or no decline. */
  declineStreak: number;
  /** Subject + chapter of the worst drop, when the drop path fired. */
  worstSubject: string | null;
  worstChapter: number | null;
}

export interface SubjectConcentration {
  subject: string;
  /** Count of chapters with mastery < at_risk_mastery (0.4). */
  atRiskChapterCount: number;
  band: ConcentrationBand;
}

export interface AtRiskConcentrationSignal {
  /** One entry per input subject, ordered worst-first (highest count first). */
  bySubject: SubjectConcentration[];
  /** The single highest band across all subjects ('none' when no subjects). */
  worstBand: ConcentrationBand;
  /** Total at-risk chapters across all subjects. */
  totalAtRiskChapters: number;
}

export interface PulseSignals {
  inactivity: InactivitySignal;
  masteryCliff: MasteryCliffSignal;
  atRiskConcentration: AtRiskConcentrationSignal;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Whole UTC calendar days between two ms-epoch instants, measured on the
 * UTC-midnight boundary (NOT a rolling 24h window) — because daily-cron's
 * streak reset is calendar-day based (`last_session_at < yesterday-00:00 UTC`).
 *
 * Returns 0 when both fall on the same UTC date, 1 when `lastMs` is the
 * previous UTC date, etc. Never negative (future last-active clamps to 0).
 */
function utcCalendarDaysBetween(nowMs: number, lastMs: number): number {
  const MS_PER_DAY = 86_400_000;
  // Floor each instant to its UTC-midnight day index, then diff the indices.
  const nowDay = Math.floor(nowMs / MS_PER_DAY);
  const lastDay = Math.floor(lastMs / MS_PER_DAY);
  const diff = nowDay - lastDay;
  return diff < 0 ? 0 : diff;
}

function bandForAtRiskCount(count: number): ConcentrationBand {
  if (count >= PULSE_THRESHOLDS.concentration_high_min) return 'high';
  if (count >= PULSE_THRESHOLDS.concentration_medium_min) return 'medium';
  if (count >= PULSE_THRESHOLDS.concentration_low_min) return 'low';
  return 'none';
}

const BAND_RANK: Record<ConcentrationBand, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

// ════════════════════════════════════════════════════════════════════════════
// SIGNAL DERIVATIONS
// ════════════════════════════════════════════════════════════════════════════

export function deriveInactivity(raw: PulseRawInput): InactivitySignal {
  const last = raw.lastActiveMs;

  // Never active: null/undefined last-active.
  if (last == null) {
    return { verdict: 'never', daysSinceActive: null };
  }

  // Defensive: non-finite timestamp -> unknown (degrade, don't throw).
  if (!Number.isFinite(last) || !Number.isFinite(raw.nowMs)) {
    return { verdict: 'unknown', daysSinceActive: null };
  }

  const days = utcCalendarDaysBetween(raw.nowMs, last);

  if (days <= PULSE_THRESHOLDS.inactivity_ok_max_days) {
    return { verdict: 'ok', daysSinceActive: days };
  }
  if (days <= PULSE_THRESHOLDS.inactivity_grace_days) {
    // Grace day (yesterday). Streak intact today but resets tonight unless
    // they study. Always at_risk regardless of freeze.
    return { verdict: 'at_risk', daysSinceActive: days };
  }
  // 2+ UTC days: streak already lost / eligible for reset. A freeze softens
  // this to at_risk (cron would consume the freeze and continue the streak).
  if (raw.hasStreakFreeze === true) {
    return { verdict: 'at_risk', daysSinceActive: days };
  }
  return { verdict: 'broken', daysSinceActive: days };
}

export function deriveMasteryCliff(raw: PulseRawInput): MasteryCliffSignal {
  const events = raw.masteryEvents ?? [];
  const scores = raw.recentQuizScores ?? [];

  // ── Path 1: explicit mastery_changed drops ──────────────────────────────
  // Largest single-event drop where fromMastery is known (non-null) and
  // toMastery < fromMastery. A drop qualifies as a cliff if its magnitude
  // >= mastery_cliff_drop, OR if it crosses below the at-risk line (0.4) from
  // at/above it.
  let largestDrop: number | null = null;
  let worstSubject: string | null = null;
  let worstChapter: number | null = null;
  let dropFlagged = false;

  for (const e of events) {
    if (e.fromMastery == null || !Number.isFinite(e.fromMastery)) continue;
    if (!Number.isFinite(e.toMastery)) continue;
    const drop = e.fromMastery - e.toMastery;
    if (drop <= 0) continue; // not a decline

    // Track the largest drop magnitude for reporting.
    if (largestDrop == null || drop > largestDrop) {
      largestDrop = drop;
      worstSubject = e.subjectCode;
      worstChapter = e.chapterNumber;
    }

    const crossedBelowAtRisk =
      e.fromMastery >= PULSE_THRESHOLDS.at_risk_mastery &&
      e.toMastery < PULSE_THRESHOLDS.at_risk_mastery;

    if (drop >= PULSE_THRESHOLDS.mastery_cliff_drop || crossedBelowAtRisk) {
      dropFlagged = true;
    }
  }

  // ── Path 2: consecutive declining quiz scores ───────────────────────────
  // Longest run of strictly-declining adjacent scores. A run length >=
  // (mastery_cliff_decline_streak) of declines means that many DECLINE STEPS,
  // i.e. (decline_streak + 1) consecutive scores each lower than the last.
  let longestDeclineRun = 0;
  let currentRun = 0;
  for (let i = 1; i < scores.length; i++) {
    const prev = scores[i - 1];
    const cur = scores[i];
    if (!Number.isFinite(prev) || !Number.isFinite(cur)) {
      currentRun = 0;
      continue;
    }
    if (cur < prev) {
      currentRun += 1;
      if (currentRun > longestDeclineRun) longestDeclineRun = currentRun;
    } else {
      currentRun = 0;
    }
  }
  const declineFlagged =
    longestDeclineRun >= PULSE_THRESHOLDS.mastery_cliff_decline_streak;

  // ── Verdict ─────────────────────────────────────────────────────────────
  const haveDeltaHistory = events.some(
    (e) => e.fromMastery != null && Number.isFinite(e.fromMastery),
  );
  const haveScoreHistory = scores.length >= 2;

  if (dropFlagged || declineFlagged) {
    return {
      verdict: 'flagged',
      largestDrop,
      declineStreak: longestDeclineRun,
      worstSubject,
      worstChapter,
    };
  }

  // No flag fired. If we had NO usable history on either path, we can't judge.
  if (!haveDeltaHistory && !haveScoreHistory) {
    return {
      verdict: 'unknown',
      largestDrop,
      declineStreak: longestDeclineRun,
      worstSubject,
      worstChapter,
    };
  }

  return {
    verdict: 'none',
    largestDrop,
    declineStreak: longestDeclineRun,
    worstSubject,
    worstChapter,
  };
}

export function deriveAtRiskConcentration(
  raw: PulseRawInput,
): AtRiskConcentrationSignal {
  const snapshots = raw.subjectSnapshots ?? [];

  const bySubject: SubjectConcentration[] = snapshots.map((s) => {
    const atRiskChapterCount = s.chapterMasteries.reduce(
      (n, m) =>
        Number.isFinite(m) && m < PULSE_THRESHOLDS.at_risk_mastery ? n + 1 : n,
      0,
    );
    return {
      subject: s.subject,
      atRiskChapterCount,
      band: bandForAtRiskCount(atRiskChapterCount),
    };
  });

  // Worst-first ordering (highest at-risk count first; stable by subject name).
  bySubject.sort(
    (a, b) =>
      b.atRiskChapterCount - a.atRiskChapterCount ||
      a.subject.localeCompare(b.subject),
  );

  let worstBand: ConcentrationBand = 'none';
  let totalAtRiskChapters = 0;
  for (const s of bySubject) {
    totalAtRiskChapters += s.atRiskChapterCount;
    if (BAND_RANK[s.band] > BAND_RANK[worstBand]) worstBand = s.band;
  }

  return { bySubject, worstBand, totalAtRiskChapters };
}

// ════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Derive all three Pulse signals from one raw input bundle. Pure: same input
 * always yields the same output. Never throws on malformed/partial input — it
 * degrades to 'unknown' / 'never' / empty verdicts so a Pulse lens can always
 * render something safe.
 */
export function deriveSignals(raw: PulseRawInput): PulseSignals {
  return {
    inactivity: deriveInactivity(raw),
    masteryCliff: deriveMasteryCliff(raw),
    atRiskConcentration: deriveAtRiskConcentration(raw),
  };
}
