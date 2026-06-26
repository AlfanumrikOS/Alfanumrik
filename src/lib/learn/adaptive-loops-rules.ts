/**
 * Alfanumrik — Adaptive Closed Loops / Phase A Loops B & C
 * Loop B (inactivity re-engagement) + Loop C (at-risk-concentration escalation)
 * — the single source of truth for B & C constants, the pure planners, and the
 * cross-loop arbiter (the anti-storm core).
 *
 * PURE module: zero I/O, zero DB, zero fetch, zero clock reads other than the
 * explicit `nowMs` the caller passes in. Backend routes/cron assemble the
 * already-authorized inputs (Pulse inactivity / at-risk-concentration signals,
 * the student's intervention ledger, the student's onboarding age, today's
 * already-opened set) and these functions decide — deterministically — whether
 * and which intervention to open today.
 *
 * Style mirrors src/lib/learn/remediation-queue-adapter.ts and
 * src/lib/pulse/signals.ts: documented constants, exported input/output types,
 * pure entry points, never-throws degradation.
 *
 * ─── How this composes with existing machinery (no duplication) ─────────────
 *
 * 1. SIGNALS are NOT re-derived here. The triggers are the verdicts produced by
 *    `deriveInactivity` (verdict 'broken') and `deriveAtRiskConcentration`
 *    (band 'high') in src/lib/pulse/signals.ts. The band boundary
 *    (`concentration_high_min`) is IMPORTED from `PULSE_THRESHOLDS`, never
 *    redefined (guardrail B/C-6, the Loop A "no duplicate thresholds" rule).
 *
 * 2. LOOP A constants stay in `ADAPTIVE_REMEDIATION_RULES`
 *    (remediation-queue-adapter.ts) and are mastery-cliff-specific. B/C
 *    constants live HERE so neither object is bloated with the other's numbers
 *    and no number is scattered. The cross-loop arbiter (§5) is the only place
 *    that reasons across A + B + C, and it takes A's presence as input data
 *    (active/terminal refs), not as imported A constants.
 *
 * 3. WINDOW BOUNDARY SEMANTICS mirror recovery-evaluation.ts EXACTLY: the
 *    verification window is a ROLLING-MILLISECOND interval (every student gets
 *    windowDays × 24h regardless of time-of-day the row opened), observations
 *    count INCLUSIVE at both ends, and expiry fires only STRICTLY AFTER the
 *    boundary (so a return/resolution at the exact boundary instant beats a
 *    same-instant expiry sweep — same-instant races resolve in the student's
 *    favor). Loop A reads UTC calendar days ONLY for streak math in signals.ts;
 *    the intervention windows are rolling-ms in both A and B/C.
 *
 * ═══ RATIFIED LOOP CONSTANTS (academic justification) ═══════════════════════
 *
 * All B/C constants live in ADAPTIVE_LOOPS_BC_RULES — the single source of
 * truth for Loops B & C. The evaluators + arbiter below import from here; the
 * worker and tests import from here. No B/C number is defined twice, and the
 * band boundary is re-exported from PULSE_THRESHOLDS rather than re-typed.
 *
 * ── Loop B (inactivity) ─────────────────────────────────────────────────────
 *
 * • inactivity_return_window_days = 3 — RATIFIED (Decision B5). The verify
 *   window: a nudged student has 3 rolling days to come back before the parent
 *   is pulled in. Anchored to the streak-reset cadence: daily-cron's
 *   `resetMissedStreaks` treats 2+ missed UTC days as broken (the very state
 *   that opens this loop — `deriveInactivity` returns 'broken' at >= 2 days).
 *   3 days gives a just-drifted student a full weekend-spanning chance to
 *   return on the nudge ALONE before escalating, yet is short enough that a
 *   genuinely-gone student reaches the parent within the school week. (Loop A's
 *   7-day window is for re-LEARNING a chapter; Loop B's is just "did they open
 *   the app again", a far quicker signal — hence the shorter window.)
 *
 * • nudge_cooldown_days = 7 — RATIFIED (guardrail B-G3). After a TERMINAL
 *   inactivity row (recovered or escalated), wait 7 days before opening a new
 *   one. A nudge + parent alert is a motivational touch, not a learning event;
 *   re-nudging the same disengaged student every few days reads as nagging and
 *   trains the parent to ignore the alert. One school-week between nudges keeps
 *   the touch meaningful. (7 days strictly exceeds the 3-day return window, so
 *   a row that just expired cannot immediately re-open while the same drift
 *   persists.)
 *
 * • onboarding_grace_days = 7 — RATIFIED (guardrail B-G6). Never nudge a
 *   student whose account is younger than 7 days. A brand-new student has no
 *   established study habit to "break"; a "you've stopped studying" nudge on
 *   day 2 is both inaccurate and a terrible first impression. 7 days lets a
 *   first full school-week of onboarding usage establish a baseline before the
 *   loop can fire. Boundary is grace-EXCLUSIVE: a student created exactly
 *   `onboarding_grace_days` ago is OUT of grace and may be nudged (symmetric
 *   with the rolling-window exclusive-end convention).
 *
 * ── Loop C (at-risk concentration) ──────────────────────────────────────────
 *
 * • concentration_return_window_days = 14 — RATIFIED (Decision C5). The verify
 *   window: after the immediate escalation, the subject has 14 rolling days to
 *   drop out of the 'high' band before the human is re-notified. Longer than
 *   Loop A's 7 because moving a SUBJECT (5+ at-risk chapters) out of 'high' is
 *   a multi-week, multi-chapter effort, not a single-chapter recovery. SM-2
 *   schedules the first two reviews of each chapter at 1 and 6 days; clearing
 *   five chapters means several of those 6-day reviews must land AND succeed,
 *   which a realistic CBSE study cadence (one school cycle ≈ 7 days) needs ~2
 *   weeks to deliver. 14 days = two full study cycles — the minimum to
 *   distinguish a real subject-wide turnaround from a lucky week.
 *
 * • concentration_cooldown_days = 7 — RATIFIED (guardrail C-G2). After a
 *   TERMINAL concentration row for a (student, subject), wait 7 days before
 *   opening a new one for that same subject. Re-escalating a teacher/parent on
 *   the same subject every few days is noise; one school-week between subject
 *   escalations keeps each one credible.
 *
 * ── Cross-loop (anti-storm) ─────────────────────────────────────────────────
 *
 * • per_student_daily_intervention_ceiling = 1 — RATIFIED (Decision X3). At
 *   most ONE new intervention may be OPENED per student per day, across all of
 *   A / B / C. This is the primary anti-storm guardrail: a struggling,
 *   disengaged student could trip all three signals the same night; the ceiling
 *   guarantees at most one fresh automated touch. Precedence A > C > B
 *   (severity order: a fresh regression (A) is most acute and most actionable;
 *   a systemic subject gap (C) next; disengagement (B) is real but lowest-
 *   urgency for one day's slot and is partially covered by the streak system).
 *   The ceiling caps NEW interventions only — verify-phase transitions
 *   (recovered / escalated / re-notify on already-open rows) are NOT capped, so
 *   in-flight loops always drain.
 *
 * • concentration_high_min — REUSED from PULSE_THRESHOLDS, NOT redefined. The
 *   trigger band ('high') and the verify predicate (band dropped below 'high')
 *   both read this single boundary. Re-exported here as a convenience for the
 *   evaluators/worker so they import one rules object, but it is structurally
 *   the same number as the signal that opened the loop.
 *
 * P5: grades are strings; this module never touches grade. The `chapter_number`
 * sentinel (0 for Loop B) is an integer, not a grade. P13: inputs and outputs
 * carry internal identifiers (subject codes, chapter numbers, intervention
 * UUIDs, student ids) + derived integers only — never PII.
 */

import { PULSE_THRESHOLDS } from '../pulse/signals';
import { predictRetention } from '../cognitive-engine';

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS — single source of truth for Loops B & C + the cross-loop ceiling.
// ════════════════════════════════════════════════════════════════════════════

export const ADAPTIVE_LOOPS_BC_RULES = {
  // ── Loop B (inactivity) ─────────────────────────────────────────────────
  /** B5 — Loop B verify window (rolling-ms). Days to return before escalating. */
  inactivity_return_window_days: 3,
  /** B-G3 — don't open a new inactivity row within 7 days of a terminal one. */
  nudge_cooldown_days: 7,
  /** B-G6 — never nudge a student whose account is younger than 7 days. */
  onboarding_grace_days: 7,

  // ── Loop C (at-risk concentration) ──────────────────────────────────────
  /** C5 — Loop C verify window (rolling-ms). Days to drop below 'high'. */
  concentration_return_window_days: 14,
  /** C-G2 — per-(student,subject) cooldown after a terminal concentration row. */
  concentration_cooldown_days: 7,

  // ── shared / cross-loop ──────────────────────────────────────────────────
  /** X3 — at most 1 NEW intervention opened per student per day, across A/B/C. */
  per_student_daily_intervention_ceiling: 1,

  /**
   * Band boundary is REUSED, not redefined: the verify predicate for Loop C
   * ("band dropped below 'high'") reads the SAME `concentration_high_min` the
   * `deriveAtRiskConcentration` signal used to open the loop. Re-exported here
   * only so consumers import one rules object — guardrail B/C-6.
   */
  concentration_high_min: PULSE_THRESHOLDS.concentration_high_min,
} as const;

// ════════════════════════════════════════════════════════════════════════════
// LOOP D — blocked-prerequisite (Digital Twin + Knowledge Graph, Slice 1)
// ════════════════════════════════════════════════════════════════════════════
//
// ── THE RULE (plain terms) ──────────────────────────────────────────────────
//
// A student is BLOCKED on an advanced (dependent) topic when a PREREQUISITE
// topic — an upstream node in the knowledge graph that the advanced topic builds
// on — is NOT solid enough to support it, WHILE the dependent topic is actively
// being attempted or scheduled. "Not solid enough" means the prerequisite is
// either:
//   (a) BELOW the mastery floor   — current BKT p_know < mastery_floor (the
//       student never built durable mastery of the prerequisite), OR
//   (b) DECAYED below the retention floor — predictRetention(daysSinceStudy,
//       strength) < decay_floor (the student once knew it but the Ebbinghaus
//       forgetting curve has dragged predicted recall under the retest line).
// Either condition alone blocks; failing BOTH is the most severe block. The
// signal NEVER fires for a dependent topic the student is not currently touching
// (no nagging about prerequisites for topics they have not reached) and is a
// pure no-op when the caller's `ff_digital_twin_v1` flag is OFF (the caller gates
// the flag; these functions are flag-agnostic + side-effect-free).
//
// ── THRESHOLDS (both REUSED from existing platform conventions) ──────────────
//
// • mastery_floor = PULSE_THRESHOLDS.at_risk_mastery (0.4) — REUSED, not
//   redefined. 0.4 is the platform-wide "at-risk mastery" line already used by
//   the mastery-cliff and at-risk-concentration signals. A prerequisite below
//   0.4 p_know is, by the platform's own definition, an at-risk chapter — it
//   cannot be trusted to carry an advanced topic. Keeping "blocked-by-mastery"
//   identical to "at-risk chapter" means a prerequisite that trips Loop C's
//   per-chapter count is exactly one that can block here — no second, conflicting
//   mastery line.
//
// • decay_floor = 0.5 — the canonical `shouldRetest` threshold from
//   cognitive-engine.ts (`shouldRetest(...)` fires when predictRetention < 0.5).
//   It is the platform's existing "predicted recall has dropped low enough that
//   a retest is warranted" line, rooted in the same Ebbinghaus model. Reusing it
//   means "blocked-by-decay" is definitionally "shouldRetest says retest this
//   prerequisite": a prerequisite the student would more-likely-than-not fail to
//   recall on demand is not a safe foundation. Surfaced here as a named constant
//   (cognitive-engine exposes 0.5 only as a default parameter, not an exported
//   symbol) so the SQL RPC `detect_blocked_dependents` and this TS module read
//   ONE number; if cognitive-engine's retest convention ever moves, update both.
//
// • cooldown_days = 7 — mirror of Loop B/C's 7-day per-subject cooldown. After a
//   terminal blocked-prerequisite row for a subject, wait one school week before
//   re-flagging that subject so the student/teacher is not re-messaged about the
//   same structural gap every night.
//
// • return_window_days = 7 — mirror of Loop A's 7-day window. Clearing a single
//   prerequisite chapter is a single-chapter recovery (like Loop A), not a
//   subject-wide multi-week effort (Loop C's 14). Exported for the cron/RPC
//   wiring parity; the verify evaluator itself is a later slice.
//
// ── LOOP & PRECEDENCE DECISION ───────────────────────────────────────────────
//
// blocked_prerequisite is a NEW loop, "D", NOT a reuse of an existing slot: its
// trigger (a knowledge-graph dependency block), its keying (per dependent
// chapter), and its remediation (study the PREREQUISITE, not the attempted
// topic) are all distinct from A/B/C. Folding it into an existing signal would
// blur three different remediations onto one DB trigger_signal.
//
// Precedence: A > D > C > B (the existing A > C > B order is preserved; D is
// inserted between A and C). Rationale:
//   • A (fresh mastery-cliff) stays highest — a known-good chapter slipping is
//     time-sensitive; catch it while fresh before it compounds.
//   • D sits ABOVE C because a blocked prerequisite is a PRECISE, CAUSAL,
//     immediately-actionable block: the student is hitting the wall on the
//     dependent topic TODAY and there is one clear fix (the named prerequisite).
//     A subject-wide concentration gap (C) is real but diffuse, multi-chapter,
//     and slower-moving. Unblocking the prerequisite often dissolves part of the
//     C cluster too, so D-before-C is also the more efficient ordering.
//   • C then B, unchanged.
// The arbiter keeps choosing AT MOST ONE candidate per student per night via the
// unchanged per_student_daily_intervention_ceiling (1); D simply joins the same
// precedence sort. The anti-storm guarantee is untouched.
export const BLOCKED_PREREQUISITE_RULES = {
  /**
   * Prerequisite mastery floor (BKT p_know, 0..1). REUSED from
   * PULSE_THRESHOLDS.at_risk_mastery (0.4) — a prerequisite below the platform
   * at-risk line cannot support a dependent topic. Passed to the SQL RPC
   * `detect_blocked_dependents(p_student_id, p_decay_floor, p_mastery_floor)` as
   * p_mastery_floor so SQL + TS share one number.
   */
  mastery_floor: PULSE_THRESHOLDS.at_risk_mastery,
  /**
   * Prerequisite retention floor (predicted recall, 0..1). The canonical
   * `shouldRetest` threshold (0.5) from cognitive-engine.ts. A prerequisite with
   * predictRetention(daysSinceStudy, strength) < this is "retest warranted" and
   * therefore not a safe foundation. Passed to the SQL RPC as p_decay_floor.
   */
  decay_floor: 0.5,
  /** Per-(student,subject) cooldown after a terminal blocked-prerequisite row. */
  cooldown_days: 7,
  /** Verify window (rolling-ms) for a later slice; single-chapter recovery → 7. */
  return_window_days: 7,
} as const;

const MS_PER_DAY = 86_400_000;

// ════════════════════════════════════════════════════════════════════════════
// SHARED TYPES (refs the worker hands the planners/arbiter)
// ════════════════════════════════════════════════════════════════════════════

/** Which closed loop a candidate / existing row belongs to. */
export type LoopId = 'A' | 'B' | 'C' | 'D';

/**
 * The DB `trigger_signal` value for each loop. Mirrors the
 * `adaptive_interventions_trigger_signal_chk` CHECK (after the B/C extension and
 * the Slice-1 Loop D extension — the architect owns that migration).
 */
export type TriggerSignal =
  | 'mastery_cliff' // Loop A
  | 'inactivity' // Loop B
  | 'at_risk_concentration' // Loop C
  | 'blocked_prerequisite'; // Loop D (Digital Twin + Knowledge Graph, Slice 1)

/** The reserved lowercase pseudo-subject for Loop B's sentinel triple. */
export const INACTIVITY_SENTINEL_SUBJECT = '_inactivity' as const;
/** The reserved chapter number for Loop B's sentinel triple (CHECK >= 0). */
export const INACTIVITY_SENTINEL_CHAPTER = 0 as const;

/**
 * One non-terminal (`status='active'`) intervention for this student, across
 * any loop. The arbiter and the per-loop planners read this to enforce
 * one-active-max and the A↔C coexistence rule.
 */
export interface ActiveInterventionRef {
  triggerSignal: TriggerSignal;
  subjectCode: string;
  chapterNumber: number;
}

/**
 * One TERMINAL intervention (recovered / escalated / dismissed) for this
 * student, used for the per-loop cooldown checks.
 */
export interface TerminalInterventionRef {
  triggerSignal: TriggerSignal;
  subjectCode: string;
  chapterNumber: number;
  /** When it became terminal, ms epoch. */
  terminalAtMs: number;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/** Loop -> its DB trigger_signal. */
export function triggerSignalForLoop(loop: LoopId): TriggerSignal {
  switch (loop) {
    case 'A':
      return 'mastery_cliff';
    case 'B':
      return 'inactivity';
    case 'C':
      return 'at_risk_concentration';
    case 'D':
      return 'blocked_prerequisite';
  }
}

/** DB trigger_signal -> Loop. */
export function loopForTriggerSignal(signal: TriggerSignal): LoopId {
  switch (signal) {
    case 'mastery_cliff':
      return 'A';
    case 'inactivity':
      return 'B';
    case 'at_risk_concentration':
      return 'C';
    case 'blocked_prerequisite':
      return 'D';
  }
}

/**
 * Whether a (student, subject) is still inside a per-loop cooldown given the
 * student's recent terminal rows for that loop. Interval is
 * [terminalAt, terminalAt + cooldownDays) — EXCLUSIVE end (at exactly +N days
 * the cooldown is over and a new row may open), mirroring Loop A's
 * `chapter_cooldown_days` boundary.
 *
 * Subject match is by `subjectCode` (Loop C is per-subject; Loop B uses the
 * `_inactivity` sentinel subject, so its cooldown is naturally per-student).
 */
function inCooldownForSubject(
  signal: TriggerSignal,
  subjectCode: string,
  terminals: TerminalInterventionRef[],
  cooldownDays: number,
  nowMs: number,
): boolean {
  const cooldownMs = cooldownDays * MS_PER_DAY;
  return (terminals ?? []).some(
    (t) =>
      t.triggerSignal === signal &&
      t.subjectCode === subjectCode &&
      Number.isFinite(t.terminalAtMs) &&
      nowMs < t.terminalAtMs + cooldownMs,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LOOP B — inactivity intervention planner (open?)
// ════════════════════════════════════════════════════════════════════════════

export type LoopBPlanDecision =
  | 'open' // all guardrails satisfied; open the nudge intervention
  | 'not_broken' // inactivity verdict !== 'broken' (grace day / ok / never / unknown)
  | 'onboarding_grace' // student account younger than onboarding_grace_days
  | 'active_exists' // a Loop B inactivity row is already active for this student
  | 'cooldown' // a terminal inactivity row is within nudge_cooldown_days
  | 'ceiling_spent'; // the per-student daily ceiling was already spent by A/C tonight

export interface PlanInactivityInput {
  /** Inactivity verdict from `deriveInactivity` — Loop B opens only on 'broken'. */
  inactivityVerdict: 'ok' | 'at_risk' | 'broken' | 'never' | 'unknown';
  /** Whole UTC days since last activity (for the snapshot); not a gate input. */
  daysSinceActive: number | null;
  /** When the student's account was created, ms epoch (onboarding grace gate). */
  studentCreatedAtMs: number;
  /** This student's non-terminal interventions, across all loops. */
  activeInterventions: ActiveInterventionRef[];
  /** This student's recent terminal interventions, across all loops. */
  recentTerminalInterventions: TerminalInterventionRef[];
  /**
   * Whether the per-student daily intervention ceiling was ALREADY spent by a
   * higher-precedence loop (A or C) earlier in tonight's run. Loop B is the
   * LOWEST precedence (A > C > B), so this is true whenever A or C opened a row
   * for this student tonight. When true, Loop B defers to the next night.
   */
  ceilingAlreadySpent: boolean;
  /** Current wall clock, ms epoch — passed in so the module stays pure. */
  nowMs: number;
}

export interface PlanInactivityResult {
  decision: LoopBPlanDecision;
  /** True only when decision === 'open'. */
  open: boolean;
}

/**
 * Decide whether to OPEN a Loop B inactivity intervention for this student
 * tonight. Pure and deterministic; never throws — malformed inputs degrade to
 * the safest decision (do not open).
 *
 * Guardrail precedence (documented; tests pin every boundary):
 *   1. not_broken       — verdict !== 'broken' (Decision B3). Grace day is the
 *                          streak system's job; opening on it would storm.
 *   2. onboarding_grace — account younger than 7 days (B-G6).
 *   3. active_exists    — a Loop B row is already active (B-G1, one-active-max).
 *   4. cooldown         — a terminal inactivity row within 7 days (B-G3).
 *   5. ceiling_spent    — A or C already used the student's daily slot (X3).
 *   6. open             — all gates pass.
 *
 * Order rationale: the cheapest/most-fundamental gates first (verdict, then
 * onboarding age), then the per-loop ledger gates, then the cross-loop ceiling
 * LAST — the ceiling is a tie-break among loops that WOULD otherwise open, so
 * it only matters once a loop is otherwise eligible.
 */
export function planInactivityIntervention(
  input: PlanInactivityInput,
): PlanInactivityResult {
  const deny = (decision: LoopBPlanDecision): PlanInactivityResult => ({
    decision,
    open: false,
  });

  // 1. Trigger gate — only 'broken' opens an intervention (Decision B3).
  if (input?.inactivityVerdict !== 'broken') {
    return deny('not_broken');
  }

  // 2. Onboarding grace — never nudge an account younger than the grace window.
  //    Boundary is grace-EXCLUSIVE: created exactly `onboarding_grace_days` ago
  //    is OUT of grace (eligible). Defensive: unparseable created-at is treated
  //    as in-grace (do not nudge off corrupt data).
  if (!Number.isFinite(input.studentCreatedAtMs) || !Number.isFinite(input.nowMs)) {
    return deny('onboarding_grace');
  }
  const graceEndMs =
    input.studentCreatedAtMs +
    ADAPTIVE_LOOPS_BC_RULES.onboarding_grace_days * MS_PER_DAY;
  if (input.nowMs < graceEndMs) {
    return deny('onboarding_grace');
  }

  // 3. One active inactivity row per student (B-G1, sentinel triple).
  const hasActiveInactivity = (input.activeInterventions ?? []).some(
    (a) => a.triggerSignal === 'inactivity',
  );
  if (hasActiveInactivity) {
    return deny('active_exists');
  }

  // 4. Nudge cooldown — no new inactivity row within 7 days of a terminal one
  //    (B-G3). Subject is the sentinel for Loop B, matched naturally.
  if (
    inCooldownForSubject(
      'inactivity',
      INACTIVITY_SENTINEL_SUBJECT,
      input.recentTerminalInterventions ?? [],
      ADAPTIVE_LOOPS_BC_RULES.nudge_cooldown_days,
      input.nowMs,
    )
  ) {
    return deny('cooldown');
  }

  // 5. Cross-loop daily ceiling — A/C outrank B (X3). If the slot is spent, B
  //    defers to a subsequent night (the signal persists).
  if (input.ceilingAlreadySpent === true) {
    return deny('ceiling_spent');
  }

  return { decision: 'open', open: true };
}

// ════════════════════════════════════════════════════════════════════════════
// LOOP B — return evaluation (did the student come back?)
// ════════════════════════════════════════════════════════════════════════════

/** One adaptive inactivity intervention awaiting return verification. */
export interface InactivityInterventionRecord {
  /** When the intervention was opened, ms epoch. */
  createdAtMs: number;
  /**
   * Return window in days. Canonical:
   * ADAPTIVE_LOOPS_BC_RULES.inactivity_return_window_days (3). Non-finite or
   * <= 0 falls back to the canonical default (degrade, don't throw).
   */
  windowDays: number;
}

/**
 * One qualifying-activity observation for the inactivity verify. "Qualifying"
 * means a GENUINE session/quiz event (a real return), NOT the streak-freeze
 * bump `resetMissedStreaks` writes — the backend filters freeze-bumps out
 * before passing observations here (Decision §10 / Open item §12-B). This
 * module trusts that each observation it receives represents a real return.
 */
export interface ActivityObservation {
  /** When the qualifying activity occurred, ms epoch. */
  observedAtMs: number;
}

export type ReturnVerdict = 'returned' | 'pending' | 'expired';

export interface ReturnEvaluation {
  verdict: ReturnVerdict;
  /** ms-epoch of the earliest qualifying in-window return; null if none. */
  returnedAtMs: number | null;
  /**
   * Whole rolling days from createdAt to the qualifying return (floored), for
   * the `system.engagement_returned.daysToReturn` payload; null if no return.
   */
  daysToReturn: number | null;
}

function effectiveWindowDays(windowDays: number, fallback: number): number {
  if (!Number.isFinite(windowDays) || windowDays <= 0) return fallback;
  return windowDays;
}

/**
 * End of the inactivity return window (ms epoch). Exported so the cron sweep
 * can query "rows whose window has ended" with the EXACT boundary math the
 * verdict uses (mirrors `verificationWindowEndMs` in recovery-evaluation.ts).
 */
export function inactivityReturnWindowEndMs(
  record: InactivityInterventionRecord,
): number {
  return (
    record.createdAtMs +
    effectiveWindowDays(
      record.windowDays,
      ADAPTIVE_LOOPS_BC_RULES.inactivity_return_window_days,
    ) *
      MS_PER_DAY
  );
}

/**
 * Evaluate whether a nudged student returned inside the window. Pure and
 * deterministic; never throws — malformed input degrades to 'pending' (never
 * falsely escalates to a parent off corrupt data).
 *
 * Observation filtering: a qualifying-activity observation counts when it
 * (a) falls inside [createdAtMs, windowEndMs] INCLUSIVE, (b) is not in the
 * future (observedAtMs <= nowMs), and (c) carries a finite timestamp. The
 * EARLIEST such observation is the return instant (returning sooner is
 * strictly better; the first genuine return ends the loop).
 *
 * Boundary semantics (identical to recovery-evaluation.ts):
 *   - INCLUSIVE both ends for a qualifying return.
 *   - 'expired' fires only STRICTLY AFTER windowEnd (nowMs > windowEnd); at
 *     exactly windowEnd a still-absent student is still 'pending'.
 *   - 'returned' is checked BEFORE expiry: a return at the exact boundary
 *     instant beats a same-instant expiry sweep (resolves in the student's
 *     favor); a late evaluation of an in-window return still reads 'returned'.
 */
export function evaluateReturn(
  record: InactivityInterventionRecord,
  activityObservations: ActivityObservation[],
  nowMs: number,
): ReturnEvaluation {
  // Defensive: an unevaluable record stays pending (degrade, don't escalate).
  if (!Number.isFinite(record?.createdAtMs) || !Number.isFinite(nowMs)) {
    return { verdict: 'pending', returnedAtMs: null, daysToReturn: null };
  }

  const windowEnd = inactivityReturnWindowEndMs(record);

  // Earliest qualifying in-window return.
  let earliest: number | null = null;
  for (const o of activityObservations ?? []) {
    const at = o?.observedAtMs;
    if (!Number.isFinite(at)) continue;
    if (at < record.createdAtMs) continue; // before the nudge — not a return to it
    if (at > windowEnd) continue; // outside window (inclusive end)
    if (at > nowMs) continue; // future reading — ignore
    if (earliest === null || at < earliest) earliest = at;
  }

  // Return check runs BEFORE expiry (boundary semantics above).
  if (earliest !== null) {
    const daysToReturn = Math.floor((earliest - record.createdAtMs) / MS_PER_DAY);
    return { verdict: 'returned', returnedAtMs: earliest, daysToReturn };
  }

  // Expiry: strictly after the window boundary.
  if (nowMs > windowEnd) {
    return { verdict: 'expired', returnedAtMs: null, daysToReturn: null };
  }

  return { verdict: 'pending', returnedAtMs: null, daysToReturn: null };
}

// ════════════════════════════════════════════════════════════════════════════
// LOOP C — concentration intervention planner (open?)
// ════════════════════════════════════════════════════════════════════════════

export type LoopCPlanDecision =
  | 'open' // all guardrails satisfied; open the escalation intervention
  | 'not_high' // band !== 'high' (Loop C triggers only on 'high')
  | 'active_exists' // a Loop C row is already active for this (student, subject)
  | 'coexists_with_a' // an active Loop A row exists in this subject (A↔C rule)
  | 'cooldown' // a terminal concentration row within concentration_cooldown_days
  | 'ceiling_spent'; // the per-student daily ceiling was already spent (A only)

export interface PlanConcentrationInput {
  /** Subject code under evaluation (the worst 'high' subject the worker picked). */
  subjectCode: string;
  /** Concentration band for this subject from `deriveAtRiskConcentration`. */
  band: 'none' | 'low' | 'medium' | 'high';
  /** This student's non-terminal interventions, across all loops. */
  activeInterventions: ActiveInterventionRef[];
  /** This student's recent terminal interventions, across all loops. */
  recentTerminalInterventions: TerminalInterventionRef[];
  /**
   * Whether the per-student daily ceiling was ALREADY spent by a
   * higher-precedence loop earlier tonight. Loop C is OUTRANKED only by A
   * (A > C > B), so this is true whenever Loop A opened a row for this student
   * tonight. When true, Loop C defers.
   */
  ceilingAlreadySpent: boolean;
  /** Current wall clock, ms epoch — passed in so the module stays pure. */
  nowMs: number;
}

export interface PlanConcentrationResult {
  decision: LoopCPlanDecision;
  /** True only when decision === 'open'. */
  open: boolean;
}

/**
 * Decide whether to OPEN a Loop C concentration escalation for a (student,
 * subject) tonight. Pure and deterministic; never throws — malformed inputs
 * degrade to the safest decision (do not open).
 *
 * Guardrail precedence (documented; tests pin every boundary):
 *   1. not_high         — band !== 'high' (Loop C escalates only on 'high').
 *   2. active_exists    — a Loop C row is already active for this subject (C-G1).
 *   3. coexists_with_a  — an ACTIVE Loop A row exists on ANY chapter in this
 *                          subject (C-G3 A↔C coexistence — Loop A is already
 *                          working the subject chapter-by-chapter; a subject-
 *                          wide escalation on top double-messages).
 *   4. cooldown         — a terminal concentration row for this subject within
 *                          7 days (C-G2).
 *   5. ceiling_spent    — Loop A already used the student's daily slot (X3).
 *   6. open             — all gates pass.
 */
export function planConcentrationIntervention(
  input: PlanConcentrationInput,
): PlanConcentrationResult {
  const deny = (decision: LoopCPlanDecision): PlanConcentrationResult => ({
    decision,
    open: false,
  });

  // 1. Trigger gate — only band 'high' escalates (Decision C1).
  if (input?.band !== 'high') {
    return deny('not_high');
  }

  const subject = input.subjectCode;
  const active = input.activeInterventions ?? [];

  // 2. One active concentration row per (student, subject) (C-G1).
  const hasActiveConcentration = active.some(
    (a) => a.triggerSignal === 'at_risk_concentration' && a.subjectCode === subject,
  );
  if (hasActiveConcentration) {
    return deny('active_exists');
  }

  // 3. A↔C coexistence (C-G3) — skip the subject if Loop A is already active on
  //    ANY chapter in it. (The reverse — A injecting into a subject C escalated
  //    — is ALLOWED and is NOT this module's concern; it does not notify the
  //    same human.)
  const aCovers = active.some(
    (a) => a.triggerSignal === 'mastery_cliff' && a.subjectCode === subject,
  );
  if (aCovers) {
    return deny('coexists_with_a');
  }

  // 4. Subject cooldown — no new concentration row for this subject within 7
  //    days of a terminal one (C-G2).
  if (
    inCooldownForSubject(
      'at_risk_concentration',
      subject,
      input.recentTerminalInterventions ?? [],
      ADAPTIVE_LOOPS_BC_RULES.concentration_cooldown_days,
      input.nowMs,
    )
  ) {
    return deny('cooldown');
  }

  // 5. Cross-loop daily ceiling — A outranks C (X3). If A spent the slot, C
  //    defers to a subsequent night (the signal persists).
  if (input.ceilingAlreadySpent === true) {
    return deny('ceiling_spent');
  }

  return { decision: 'open', open: true };
}

// ════════════════════════════════════════════════════════════════════════════
// LOOP C — concentration resolution evaluation (band dropped below 'high'?)
// ════════════════════════════════════════════════════════════════════════════

/** One adaptive concentration intervention awaiting band-drop verification. */
export interface ConcentrationInterventionRecord {
  subjectCode: string;
  /** When the intervention was opened, ms epoch. */
  createdAtMs: number;
  /**
   * Return window in days. Canonical:
   * ADAPTIVE_LOOPS_BC_RULES.concentration_return_window_days (14). Non-finite
   * or <= 0 falls back to the canonical default (degrade, don't throw).
   */
  windowDays: number;
}

/**
 * One per-subject at-risk-chapter-count snapshot during the verify window. The
 * worker derives `atRiskChapterCount` from `deriveAtRiskConcentration` for the
 * intervention's subject at the time of observation. `band` is recomputed here
 * from the count against `concentration_high_min` (never trusted blindly), so
 * a snapshot need only carry the count + a timestamp.
 */
export interface SubjectSnapshotObservation {
  subjectCode: string;
  /** Count of chapters with mastery < at_risk_mastery for this subject. */
  atRiskChapterCount: number;
  /** When observed, ms epoch. */
  observedAtMs: number;
}

export type ConcentrationResolutionVerdict = 'resolved' | 'pending' | 'expired';

export interface ConcentrationResolutionEvaluation {
  verdict: ConcentrationResolutionVerdict;
  /** at-risk-chapter count at the latest in-window snapshot; null if none. */
  atRiskChapterCountNow: number | null;
  /** Recomputed band at the latest in-window snapshot; null if none. */
  bandNow: 'none' | 'low' | 'medium' | 'high' | null;
  /**
   * Whole rolling days from createdAt to the resolving snapshot (floored), for
   * the `system.concentration_resolved.daysToResolve` payload; null if not
   * resolved.
   */
  daysToResolve: number | null;
}

/** Recompute the concentration band from a count (no duplicate boundary). */
function bandForCount(count: number): 'none' | 'low' | 'medium' | 'high' {
  if (count >= PULSE_THRESHOLDS.concentration_high_min) return 'high';
  if (count >= PULSE_THRESHOLDS.concentration_medium_min) return 'medium';
  if (count >= PULSE_THRESHOLDS.concentration_low_min) return 'low';
  return 'none';
}

/**
 * End of the concentration return window (ms epoch). Exported so the cron sweep
 * can query "rows whose window has ended" with the EXACT boundary math the
 * verdict uses.
 */
export function concentrationReturnWindowEndMs(
  record: ConcentrationInterventionRecord,
): number {
  return (
    record.createdAtMs +
    effectiveWindowDays(
      record.windowDays,
      ADAPTIVE_LOOPS_BC_RULES.concentration_return_window_days,
    ) *
      MS_PER_DAY
  );
}

/**
 * Evaluate whether a concentration intervention's subject has dropped below the
 * 'high' band. Pure and deterministic; never throws — malformed input degrades
 * to 'pending' (never falsely resolves or re-notifies off corrupt data).
 *
 * Resolution definition (Decision C4): the subject's at-risk-chapter count is
 * BELOW `concentration_high_min` at the LATEST in-window snapshot (back to
 * medium / low / none). Symmetric with the trigger (band 'high' opened it). The
 * LATEST snapshot (not best-in-window) decides — a transient mid-window dip
 * that climbs back to 'high' is NOT a resolution, mirroring the latest-reading
 * robustness of recovery-evaluation.ts.
 *
 * Snapshot filtering: a snapshot counts when it (a) matches the record's
 * subjectCode, (b) falls inside [createdAtMs, windowEndMs] INCLUSIVE, (c) is
 * not in the future, and (d) carries a finite count + timestamp. The LATEST
 * such snapshot (max observedAtMs; later array element wins on ties) supplies
 * the current count/band.
 *
 * Boundary semantics (identical to recovery-evaluation.ts): inclusive ends,
 * 'expired' only STRICTLY after windowEnd, 'resolved' checked BEFORE expiry so
 * a same-instant resolution beats a same-instant expiry.
 */
export function evaluateConcentrationResolution(
  record: ConcentrationInterventionRecord,
  subjectSnapshots: SubjectSnapshotObservation[],
  nowMs: number,
): ConcentrationResolutionEvaluation {
  // Defensive: an unevaluable record stays pending (degrade, don't re-notify).
  if (!Number.isFinite(record?.createdAtMs) || !Number.isFinite(nowMs)) {
    return {
      verdict: 'pending',
      atRiskChapterCountNow: null,
      bandNow: null,
      daysToResolve: null,
    };
  }

  const windowEnd = concentrationReturnWindowEndMs(record);

  // Latest in-window snapshot for the record's subject.
  let latest: SubjectSnapshotObservation | null = null;
  for (const s of subjectSnapshots ?? []) {
    if (s?.subjectCode !== record.subjectCode) continue;
    if (!Number.isFinite(s.observedAtMs)) continue;
    if (!Number.isFinite(s.atRiskChapterCount)) continue;
    if (s.observedAtMs < record.createdAtMs) continue; // pre-intervention
    if (s.observedAtMs > windowEnd) continue; // outside window (inclusive end)
    if (s.observedAtMs > nowMs) continue; // future reading — ignore
    // `>=` so equal timestamps resolve to the later array element.
    if (latest === null || s.observedAtMs >= latest.observedAtMs) {
      latest = s;
    }
  }

  const atRiskChapterCountNow = latest ? latest.atRiskChapterCount : null;
  const bandNow =
    atRiskChapterCountNow != null ? bandForCount(atRiskChapterCountNow) : null;

  // Resolution check runs BEFORE expiry (boundary semantics above).
  if (latest != null && bandNow !== 'high') {
    const daysToResolve = Math.floor(
      (latest.observedAtMs - record.createdAtMs) / MS_PER_DAY,
    );
    return {
      verdict: 'resolved',
      atRiskChapterCountNow,
      bandNow,
      daysToResolve,
    };
  }

  // Expiry: strictly after the window boundary (still 'high' / no snapshot).
  if (nowMs > windowEnd) {
    return {
      verdict: 'expired',
      atRiskChapterCountNow,
      bandNow,
      daysToResolve: null,
    };
  }

  return {
    verdict: 'pending',
    atRiskChapterCountNow,
    bandNow,
    daysToResolve: null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// LOOP D — blocked-prerequisite block classifier + intervention planner (open?)
// ════════════════════════════════════════════════════════════════════════════

/**
 * One prerequisite→dependent edge under evaluation for a student. The SQL RPC
 * `detect_blocked_dependents(p_student_id, p_decay_floor, p_mastery_floor)`
 * (architect-owned) resolves the knowledge-graph edges and BKT/decay readings;
 * the worker hands each candidate edge here as a plain, PII-free record. All
 * masteries are BKT p_know in 0..1 (concept_mastery.p_know / student_skill_state
 * .p_know). `prereqStrength` is the SM-2 memory-strength multiplier; absent/
 * non-finite falls back to 1.0 (the predictRetention default).
 */
export interface PrerequisiteState {
  /** Subject the dependent (advanced) chapter belongs to. */
  subjectCode: string;
  /** The upstream prerequisite chapter being tested for solidity. */
  prereqChapterNumber: number;
  /** The advanced chapter the student is attempting/scheduled on (remediated). */
  dependentChapterNumber: number;
  /** Current BKT p_know for the PREREQUISITE chapter (0..1); null if no reading. */
  prereqPKnow: number | null;
  /** Whole days since the prerequisite was last studied (for Ebbinghaus decay). */
  prereqDaysSinceStudy: number | null;
  /** SM-2 memory-strength for the prerequisite; null/non-finite => 1.0. */
  prereqStrength?: number | null;
}

/** Why a prerequisite is (or is not) blocking the dependent topic. */
export type BlockReason =
  | 'mastery' // p_know below mastery_floor only
  | 'decay' // predicted retention below decay_floor only
  | 'both' // below BOTH floors — most severe
  | 'none'; // solid on both axes (or unevaluable) — not a block

export interface BlockClassification {
  blocked: boolean;
  reason: BlockReason;
  /** predictRetention reading for the prerequisite (0..1); null if undatable. */
  retention: number | null;
  /**
   * Worst normalized deficit below either floor (0..1; higher = more blocked),
   * used as the within-loop severity tie-break in the arbiter. 0 when not
   * blocked.
   */
  deficit: number;
}

/**
 * Pure predicate: is this prerequisite NOT solid enough to support its dependent
 * topic? Applies the two canonical floors from BLOCKED_PREREQUISITE_RULES — the
 * SAME numbers the SQL RPC is parameterized with — so detection is identical in
 * SQL and TS. Never throws; an unevaluable prerequisite (no p_know AND no
 * study-recency reading) degrades to NOT blocked (do not fire off missing data).
 *
 * Rule: blocked when p_know < mastery_floor (mastery axis) OR
 * predictRetention(daysSinceStudy, strength) < decay_floor (decay axis). Both
 * axes failing is the most severe ('both').
 */
export function classifyPrerequisiteBlock(
  state: PrerequisiteState,
): BlockClassification {
  const notBlocked: BlockClassification = {
    blocked: false,
    reason: 'none',
    retention: null,
    deficit: 0,
  };

  if (state == null) return notBlocked;

  const { mastery_floor, decay_floor } = BLOCKED_PREREQUISITE_RULES;

  // ── Mastery axis ──────────────────────────────────────────────────────────
  const pKnow = state.prereqPKnow;
  const masteryReadable = typeof pKnow === 'number' && Number.isFinite(pKnow);
  const masteryLow = masteryReadable && (pKnow as number) < mastery_floor;
  const masteryDeficit = masteryLow
    ? (mastery_floor - (pKnow as number)) / mastery_floor
    : 0;

  // ── Decay axis ────────────────────────────────────────────────────────────
  const days = state.prereqDaysSinceStudy;
  const daysReadable = typeof days === 'number' && Number.isFinite(days) && days >= 0;
  let retention: number | null = null;
  if (daysReadable) {
    const strength =
      typeof state.prereqStrength === 'number' &&
      Number.isFinite(state.prereqStrength)
        ? (state.prereqStrength as number)
        : 1.0;
    retention = predictRetention(days as number, strength);
  }
  const decayLow = retention !== null && retention < decay_floor;
  const decayDeficit = decayLow ? (decay_floor - (retention as number)) / decay_floor : 0;

  // Unevaluable on both axes => not blocked (degrade, don't fire off no data).
  if (!masteryReadable && !daysReadable) return notBlocked;

  const blocked = masteryLow || decayLow;
  if (!blocked) {
    return { blocked: false, reason: 'none', retention, deficit: 0 };
  }

  const reason: BlockReason =
    masteryLow && decayLow ? 'both' : masteryLow ? 'mastery' : 'decay';
  const deficit = Math.max(masteryDeficit, decayDeficit);

  return { blocked: true, reason, retention, deficit };
}

export type LoopDPlanDecision =
  | 'open' // all guardrails satisfied; open the blocked-prerequisite intervention
  | 'dependent_inactive' // the dependent topic is not being attempted/scheduled
  | 'not_blocked' // prerequisite is solid on both axes (or unevaluable)
  | 'active_exists' // a Loop D row already active for this (subject, dependent ch)
  | 'cooldown' // a terminal Loop D row for this subject within cooldown_days
  | 'ceiling_spent'; // the per-student daily ceiling was already spent (A only)

export interface PlanBlockedPrerequisiteInput {
  /** The prerequisite→dependent edge under evaluation. */
  prerequisite: PrerequisiteState;
  /**
   * Whether the dependent (advanced) topic is currently being ATTEMPTED or
   * SCHEDULED. The block only matters when the student is actually hitting it;
   * we never nag about prerequisites for topics not yet reached.
   */
  dependentIsActive: boolean;
  /** This student's non-terminal interventions, across all loops. */
  activeInterventions: ActiveInterventionRef[];
  /** This student's recent terminal interventions, across all loops. */
  recentTerminalInterventions: TerminalInterventionRef[];
  /**
   * Whether the per-student daily ceiling was ALREADY spent by a
   * higher-precedence loop earlier tonight. Loop D is OUTRANKED only by A
   * (A > D > C > B), so this is true whenever Loop A opened a row for this
   * student tonight. When true, Loop D defers; the block signal persists.
   */
  ceilingAlreadySpent: boolean;
  /** Current wall clock, ms epoch — passed in so the module stays pure. */
  nowMs: number;
}

export interface PlanBlockedPrerequisiteResult {
  decision: LoopDPlanDecision;
  /** True only when decision === 'open'. */
  open: boolean;
  /** Why the prerequisite blocked (for the snapshot/payload); 'none' unless blocked. */
  reason: BlockReason;
  /**
   * The candidate to hand UNCHANGED to `arbitrateInterventions()` when
   * decision === 'open'; null otherwise. `chapterNumber` is the DEPENDENT
   * chapter (the topic remediated/flagged); `severity` is the block deficit so
   * the worst block wins the within-loop tie-break.
   */
  candidate: InterventionCandidate | null;
}

/**
 * Decide whether to OPEN a Loop D blocked-prerequisite intervention for a
 * (student, dependent chapter) tonight, and emit the arbiter candidate. Mirrors
 * the Loop B/C planners' shape; pure, deterministic, never throws — malformed
 * inputs degrade to the safest decision (do not open). Flag-agnostic: the caller
 * is responsible for the `ff_digital_twin_v1` gate; this function has no I/O and
 * no side effects, so it is a structural no-op when the caller skips it.
 *
 * Guardrail precedence (documented; tests pin every boundary):
 *   1. dependent_inactive — the advanced topic is not being attempted/scheduled.
 *   2. not_blocked        — the prerequisite is solid on both axes (classify).
 *   3. active_exists      — a Loop D row is already active for this (subject,
 *                            dependent chapter).
 *   4. cooldown           — a terminal Loop D row for this subject within
 *                            cooldown_days (per-subject, mirrors Loop C cadence).
 *   5. ceiling_spent      — Loop A already used the student's daily slot (X3).
 *   6. open               — all gates pass.
 */
export function planBlockedPrerequisiteIntervention(
  input: PlanBlockedPrerequisiteInput,
): PlanBlockedPrerequisiteResult {
  const deny = (
    decision: LoopDPlanDecision,
    reason: BlockReason = 'none',
  ): PlanBlockedPrerequisiteResult => ({
    decision,
    open: false,
    reason,
    candidate: null,
  });

  if (input == null || input.prerequisite == null) {
    return deny('not_blocked');
  }

  // 1. Dependent-topic gate — no block matters if the student is not on it.
  if (input.dependentIsActive !== true) {
    return deny('dependent_inactive');
  }

  // 2. Block classification (the two canonical floors).
  const classification = classifyPrerequisiteBlock(input.prerequisite);
  if (!classification.blocked) {
    return deny('not_blocked');
  }

  const subject = input.prerequisite.subjectCode;
  const dependentChapter = input.prerequisite.dependentChapterNumber;
  const active = input.activeInterventions ?? [];

  // 3. One active blocked-prerequisite row per (student, subject, dependent ch).
  const hasActive = active.some(
    (a) =>
      a.triggerSignal === 'blocked_prerequisite' &&
      a.subjectCode === subject &&
      a.chapterNumber === dependentChapter,
  );
  if (hasActive) {
    return deny('active_exists', classification.reason);
  }

  // 4. Subject cooldown — no new Loop D row for this subject within cooldown_days
  //    of a terminal one (per-subject, conservative; mirrors Loop C cadence).
  if (
    inCooldownForSubject(
      'blocked_prerequisite',
      subject,
      input.recentTerminalInterventions ?? [],
      BLOCKED_PREREQUISITE_RULES.cooldown_days,
      input.nowMs,
    )
  ) {
    return deny('cooldown', classification.reason);
  }

  // 5. Cross-loop daily ceiling — A outranks D (A > D > C > B). If A spent the
  //    slot, D defers to a subsequent night (the block signal persists).
  if (input.ceilingAlreadySpent === true) {
    return deny('ceiling_spent', classification.reason);
  }

  return {
    decision: 'open',
    open: true,
    reason: classification.reason,
    candidate: {
      loop: 'D',
      subjectCode: subject,
      chapterNumber: dependentChapter,
      severity: classification.deficit,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// CROSS-LOOP ARBITER — the anti-storm core (spec §5 / Decision X3)
// ════════════════════════════════════════════════════════════════════════════

/**
 * One candidate intervention a per-loop planner says is OTHERWISE eligible to
 * open tonight (i.e. that loop's `planXxx` returned `open: true`). The arbiter
 * picks AT MOST ONE to actually open, honoring the per-student daily ceiling
 * and the A > C > B precedence.
 *
 * `loop` drives precedence; the rest is opaque pass-through context the worker
 * needs to actually open the row (subject/chapter for A/C, sentinel for B).
 */
export interface InterventionCandidate {
  loop: LoopId;
  subjectCode: string;
  chapterNumber: number;
  /**
   * Optional severity tie-break WITHIN a loop (e.g. Loop A's deepest drop, Loop
   * C's highest at-risk count). Higher = more severe. Across loops, `loop`
   * precedence dominates; this only orders multiple same-loop candidates.
   */
  severity?: number | null;
}

export type ArbiterReason =
  | 'opened' // one candidate was selected to open
  | 'ceiling_already_spent' // a row was already opened for this student tonight
  | 'no_candidates'; // nothing was eligible

export interface ArbiterResult {
  /** The single candidate that may open today, or null if none. */
  selected: InterventionCandidate | null;
  reason: ArbiterReason;
}

/**
 * Loop precedence: A (most acute) > D (causal block) > C > B (Decision X3 +
 * Slice-1 Loop D insertion). Lower rank wins. The pre-existing A > C > B order
 * is preserved exactly; D is inserted between A and C (see the Loop D header for
 * the pedagogical rationale). The ceiling logic and the sort itself are
 * unchanged — D simply joins the same precedence comparison, so the anti-storm
 * ≤1-new-intervention-per-student-per-day guarantee is untouched.
 */
const LOOP_PRECEDENCE: Record<LoopId, number> = { A: 0, D: 1, C: 2, B: 3 };

/**
 * Cross-loop arbiter — given the candidates the three loops produced for ONE
 * student tonight plus whether a row was already opened for this student
 * earlier in the run, return which ONE candidate (if any) may open today.
 *
 * Pure and deterministic; never throws.
 *
 * Anti-storm logic (spec §5):
 *   - CEILING: at most `per_student_daily_intervention_ceiling` (1) NEW
 *     intervention opens per student per day, across A/B/C. If a row was
 *     already opened tonight (`alreadyOpenedTonight === true`), NOTHING opens —
 *     reason 'ceiling_already_spent'. (Verify-phase transitions on already-open
 *     rows are NOT routed through here; the ceiling caps NEW opens only.)
 *   - PRECEDENCE: among the candidates, the highest-precedence loop wins
 *     (A > C > B). Ties within a loop break by descending `severity` (null/
 *     non-finite sorts last), then ascending subjectCode, then ascending
 *     chapterNumber — fully deterministic.
 *
 * The worker calls each loop's planner first; only candidates whose planner
 * returned `open: true` should be passed here. The arbiter then enforces the
 * SINGLE daily slot across loops and tells the worker which one to actually
 * write. After a successful open, the worker flips its per-student
 * `alreadyOpenedTonight` to true so subsequent loops (or a re-call) see the
 * spent ceiling.
 */
export function arbitrateInterventions(
  candidates: InterventionCandidate[],
  alreadyOpenedTonight: boolean,
): ArbiterResult {
  // Ceiling: the student's single daily slot is already spent.
  if (alreadyOpenedTonight === true) {
    return { selected: null, reason: 'ceiling_already_spent' };
  }

  const list = (candidates ?? []).filter(
    (c): c is InterventionCandidate =>
      c != null &&
      (c.loop === 'A' || c.loop === 'B' || c.loop === 'C' || c.loop === 'D'),
  );
  if (list.length === 0) {
    return { selected: null, reason: 'no_candidates' };
  }

  const sorted = [...list].sort((a, b) => {
    const pa = LOOP_PRECEDENCE[a.loop];
    const pb = LOOP_PRECEDENCE[b.loop];
    if (pa !== pb) return pa - pb; // higher precedence (lower rank) first
    // Within a loop: descending severity (null/non-finite last).
    const sa =
      a.severity != null && Number.isFinite(a.severity) ? a.severity : -Infinity;
    const sb =
      b.severity != null && Number.isFinite(b.severity) ? b.severity : -Infinity;
    if (sa !== sb) return sb - sa;
    return (
      a.subjectCode.localeCompare(b.subjectCode) ||
      a.chapterNumber - b.chapterNumber
    );
  });

  return { selected: sorted[0], reason: 'opened' };
}
