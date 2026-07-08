/**
 * Alfanumrik — Adaptive Closed Loop / Phase A Loop A
 * Recovery Evaluation (did the remediated chapter actually recover?).
 *
 * PURE module: zero I/O, zero DB, zero clock reads other than the explicit
 * `nowMs` the caller passes in. The backend cron/route loads the intervention
 * record plus the chapter's post-intervention mastery observations and asks
 * this module for a verdict. On 'expired' the backend escalates by creating a
 * `teacher_remediation_assignments` row (migration 20260613000004); on
 * 'recovered' it closes the intervention. Both are TERMINAL statuses and start
 * the same-chapter cooldown defined in remediation-queue-adapter.ts.
 *
 * All loop constants are imported from ADAPTIVE_REMEDIATION_RULES (the single
 * source of truth in remediation-queue-adapter.ts), which itself reuses
 * PULSE_THRESHOLDS — no thresholds are redefined here.
 *
 * ═══ RATIFIED RECOVERY DEFINITION ════════════════════════════════════════════
 *
 * A chapter is RECOVERED iff, at the LATEST in-window mastery observation:
 *
 *   (A) masteryNow >= baselineMastery                  (full restoration), OR
 *   (B) gainFromTrough >= 0.15  AND  masteryNow >= 0.4 (substantial re-learning
 *                                                       clear of the at-risk line)
 *
 * Why a composite rule (vs. the two single-rule placeholders):
 *
 * • Baseline-only is too strict under BKT noise. BKT p_know estimates carry
 *   meaningful per-observation noise; demanding an exact return to a 0.75
 *   baseline can outlast the window even when the student has demonstrably
 *   re-learned (e.g. trough 0.45 → 0.70). Branch B credits that real gain.
 *
 * • Gain-only is too weak at the bottom. A cliff 0.5 → 0.2 climbing to 0.36
 *   meets a bare ≥0.15 gain yet leaves the chapter BELOW the platform-wide
 *   at-risk line (0.4) — the Pulse concentration signal would still count it
 *   at-risk while the loop declared victory. Branch B therefore also requires
 *   masteryNow >= PULSE at_risk_mastery (0.4).
 *
 * • Branch A deliberately has NO at-risk floor: recovery is defined relative
 *   to the CLIFF, not to absolute mastery. If the baseline itself was below
 *   0.4 (e.g. 0.35 → 0.15 → back to 0.35), the regression is healed — the
 *   chapter's chronic weakness remains the at-risk concentration signal's
 *   job, not this loop's.
 *
 * • The 0.15 gain threshold REUSES PULSE_THRESHOLDS.mastery_cliff_drop: a
 *   recovery must be at least as large as the smallest drop that can flag a
 *   cliff. Detection and recovery are symmetric, and 0.15 sits well above
 *   single-update BKT noise, so one lucky review cannot fake a recovery.
 *
 * • LATEST observation, not best-in-window: recovery is the student's current
 *   durable state. A transient day-2 peak followed by a day-5 slump is not
 *   recovery — using the latest reading makes the verdict robust to BKT
 *   wobble and means a relapse inside the window correctly fails verification.
 *
 * ═══ RATIFIED VERIFICATION WINDOW: 7 DAYS ════════════════════════════════════
 *
 * • SM-2 anchoring: after the reset a cliff typically causes, SM-2's first two
 *   review intervals are 1 day and 6 days (cognitive-engine `sm2Update`). A
 *   7-day window guarantees the student is scheduled to touch the remediated
 *   material at least TWICE inside the window — the minimum needed to
 *   distinguish durable recovery from one lucky review. 3-4 days would expire
 *   before the day-6 review ever lands.
 *
 * • Study cadence: CBSE students run a weekly school cycle; 7 days always
 *   contains a full cycle including the weekend, so a window never expires
 *   purely because of a normal weekend gap, and it tolerates ~2-3 missed days
 *   (the Pulse streak system treats 2+ days as broken) while the 3-cards/day
 *   dose still completes.
 *
 * • Escalation latency: 14 days would let a struggling student languish two
 *   weeks before the teacher sees it — contradicting the intent of
 *   teacher_remediation_assignments (at-risk follow-up within the week).
 *
 * ═══ WINDOW BOUNDARY SEMANTICS (documented choice) ═══════════════════════════
 *
 * The window is a ROLLING-MILLISECOND interval, not UTC calendar days:
 * interventions are created at arbitrary times of day, and a rolling window
 * gives every student exactly windowDays × 24h regardless of when the cliff
 * fired. (Pulse's inactivity signal uses UTC calendar days only because the
 * streak cron is calendar-based — different mechanism, different anchor.)
 *
 *   windowEndMs = createdAtMs + windowDays * 86_400_000
 *
 * • Observations count when createdAtMs <= observedAtMs <= windowEndMs —
 *   INCLUSIVE at both ends.
 * • Expiry fires only STRICTLY AFTER the boundary (nowMs > windowEndMs);
 *   at exactly windowEndMs the record is still 'pending'.
 * • Consequence: a recovery observation timestamped at the exact boundary
 *   instant beats a same-instant expiry sweep — same-instant races resolve in
 *   the student's favor.
 * • 'recovered' is checked BEFORE expiry: if the latest in-window observation
 *   satisfies recovery but the evaluation runs late (nowMs past the window),
 *   the verdict is still 'recovered' — the recovery happened inside the
 *   window; only the evaluation was late.
 *
 * Floating-point guard: threshold comparisons use a 1e-9 epsilon so an
 * exactly-at-threshold gain that IEEE-754 represents as 0.149999999999...
 * (e.g. 0.7 - 0.55) still counts as >= 0.15. BKT values carry far more noise
 * than 1e-9, so this cannot flip a genuinely-below-threshold case.
 *
 * P5: grades are strings; this module never touches grade. P13: identifiers
 * only (subject codes, chapter numbers, timestamps) — never PII.
 */

import { ADAPTIVE_REMEDIATION_RULES } from './remediation-queue-adapter';

const MS_PER_DAY = 86_400_000;
const EPS = 1e-9;

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

/** One adaptive intervention awaiting recovery verification. */
export interface InterventionRecord {
  subjectCode: string;
  chapterNumber: number;
  /**
   * Pre-cliff mastery (the cliff event's fromMastery), BKT p_know 0..1.
   * Null when the baseline is unknown (e.g. score-trend cliff path) — then
   * only the gain branch (B) can declare recovery.
   */
  baselineMastery: number | null;
  /** Post-cliff mastery (the cliff event's toMastery), BKT p_know 0..1. */
  troughMastery: number;
  /** When the intervention was opened, ms epoch. */
  createdAtMs: number;
  /**
   * Verification window in days. Canonical value:
   * ADAPTIVE_REMEDIATION_RULES.verification_window_days (7). Non-finite or
   * <= 0 values fall back to the canonical default (degrade, don't throw).
   */
  windowDays: number;
}

/** One post-intervention BKT mastery reading for a (subject, chapter). */
export interface MasteryObservation {
  subjectCode: string;
  chapterNumber: number;
  /** BKT p_know, 0..1. */
  mastery: number;
  /** When observed, ms epoch. */
  observedAtMs: number;
}

export type RecoveryVerdict = 'recovered' | 'pending' | 'expired';

export interface RecoveryEvaluation {
  verdict: RecoveryVerdict;
  /** Mastery at the latest usable in-window observation; null if none. */
  masteryNow: number | null;
  /** masteryNow - troughMastery (may be negative); null if not computable. */
  gainFromTrough: number | null;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

/** Epsilon-tolerant `a >= b` (see floating-point guard note in the header). */
function gte(a: number, b: number): boolean {
  return a >= b - EPS;
}

function effectiveWindowDays(record: InterventionRecord): number {
  const w = record.windowDays;
  if (!Number.isFinite(w) || w <= 0) {
    return ADAPTIVE_REMEDIATION_RULES.verification_window_days;
  }
  return w;
}

/**
 * End of the verification window (ms epoch) for an intervention record.
 * Exported so the backend cron can query "records whose window has ended"
 * with the exact same boundary math the verdict uses.
 */
export function verificationWindowEndMs(record: InterventionRecord): number {
  return record.createdAtMs + effectiveWindowDays(record) * MS_PER_DAY;
}

// ════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate whether an intervention's chapter has recovered. Pure and
 * deterministic; never throws — malformed input degrades to 'pending' with
 * null metrics (never falsely escalates to a teacher off corrupt data; a
 * separate data-quality sweep owns that case).
 *
 * Observation filtering: only observations that (a) match the record's
 * (subjectCode, chapterNumber), (b) fall inside
 * [createdAtMs, windowEndMs] inclusive, (c) are not in the future
 * (observedAtMs <= nowMs), and (d) carry a finite mastery are considered.
 * The LATEST such observation (max observedAtMs; on equal timestamps the
 * later array element wins — callers pass chronological order) supplies
 * masteryNow.
 */
export function evaluateRecovery(
  record: InterventionRecord,
  observations: MasteryObservation[],
  nowMs: number,
): RecoveryEvaluation {
  // Defensive: an unevaluable record stays pending (degrade, don't escalate).
  if (
    !Number.isFinite(record?.createdAtMs) ||
    !Number.isFinite(nowMs)
  ) {
    return { verdict: 'pending', masteryNow: null, gainFromTrough: null };
  }

  const windowEnd = verificationWindowEndMs(record);

  // ── Latest usable in-window observation ───────────────────────────────────
  let latest: MasteryObservation | null = null;
  for (const obs of observations ?? []) {
    if (obs.subjectCode !== record.subjectCode) continue;
    if (obs.chapterNumber !== record.chapterNumber) continue;
    if (!Number.isFinite(obs.observedAtMs)) continue;
    if (!Number.isFinite(obs.mastery)) continue;
    if (obs.observedAtMs < record.createdAtMs) continue; // pre-intervention
    if (obs.observedAtMs > windowEnd) continue;          // outside window (inclusive end)
    if (obs.observedAtMs > nowMs) continue;              // future reading — ignore
    // `>=` so equal timestamps resolve to the later array element.
    if (latest === null || obs.observedAtMs >= latest.observedAtMs) {
      latest = obs;
    }
  }

  const masteryNow = latest ? latest.mastery : null;
  const gainFromTrough =
    masteryNow != null && Number.isFinite(record.troughMastery)
      ? masteryNow - record.troughMastery
      : null;

  // ── Recovery check (runs BEFORE expiry — see boundary semantics) ──────────
  if (masteryNow != null) {
    const baselineRestored =
      record.baselineMastery != null &&
      Number.isFinite(record.baselineMastery) &&
      gte(masteryNow, record.baselineMastery);

    const substantialGain =
      gainFromTrough != null &&
      gte(gainFromTrough, ADAPTIVE_REMEDIATION_RULES.recovery_min_gain_from_trough) &&
      gte(masteryNow, ADAPTIVE_REMEDIATION_RULES.recovery_at_risk_floor);

    if (baselineRestored || substantialGain) {
      return { verdict: 'recovered', masteryNow, gainFromTrough };
    }
  }

  // ── Expiry: strictly after the window boundary ─────────────────────────────
  if (nowMs > windowEnd) {
    return { verdict: 'expired', masteryNow, gainFromTrough };
  }

  return { verdict: 'pending', masteryNow, gainFromTrough };
}
