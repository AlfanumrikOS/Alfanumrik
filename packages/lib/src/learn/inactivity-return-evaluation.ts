/**
 * Alfanumrik — Adaptive Closed Loops / Phase A Loop B (inactivity)
 * Return Evaluation (did the nudged student actually come back?).
 *
 * PURE module: zero I/O, zero DB, zero fetch, zero clock reads other than the
 * explicit `nowMs` the caller passes in. The backend cron/route loads the
 * inactivity intervention record plus the student's post-nudge qualifying
 * activity observations and asks this module for a verdict. On 'expired' the
 * backend escalates to the PARENT (never a teacher — Decision B4); on
 * 'returned' it closes the intervention as `recovered`. Both are TERMINAL
 * statuses and start the nudge cooldown defined in adaptive-loops-rules.ts.
 *
 * ─── How this composes with existing machinery (no duplication) ─────────────
 *
 * 1. CONSTANTS + WINDOW MATH are NOT redefined here. The return window
 *    (`inactivity_return_window_days = 3`) and the rolling-ms boundary helper
 *    (`inactivityReturnWindowEndMs`) live in the single source of truth,
 *    src/lib/learn/adaptive-loops-rules.ts, and are imported. This module is
 *    the backend-facing CONTRACT surface (the spec §7 file map promises
 *    `inactivity-return-evaluation.ts` with `evaluateInactivityReturn`); it
 *    delegates the load-bearing window arithmetic to the canonical helper so
 *    detection and verification can never drift.
 *
 * 2. BOUNDARY SEMANTICS mirror recovery-evaluation.ts EXACTLY (the Loop A
 *    pattern this loop descends from):
 *      - The window is a ROLLING-MILLISECOND interval, not UTC calendar days:
 *        every nudged student gets windowDays × 24h regardless of the time of
 *        day the nudge fired.
 *      - A qualifying return counts when createdAtMs <= observedAtMs <=
 *        windowEndMs — INCLUSIVE at both ends.
 *      - 'expired' fires only STRICTLY AFTER the boundary (nowMs > windowEndMs);
 *        at exactly windowEndMs a still-absent student is still 'pending'.
 *      - 'returned' is checked BEFORE expiry: a return timestamped at the exact
 *        boundary instant beats a same-instant expiry sweep — same-instant
 *        races resolve in the student's favor. A late evaluation of an in-window
 *        return still reads 'returned'.
 *    (Pulse's inactivity SIGNAL uses UTC calendar days because the streak cron
 *    is calendar-based — a different mechanism. The intervention return window
 *    here is rolling-ms, identical to Loop A.)
 *
 * 3. "QUALIFYING ACTIVITY" is a genuine session/quiz return, NOT the
 *    streak-freeze bump `resetMissedStreaks` writes (Decision §10 / Open item
 *    §12-B). The backend filters freeze-bumps out before passing observations
 *    here; this module trusts that each observation represents a real return.
 *    Biasing-to-escalation correctness depends on the caller never passing a
 *    freeze-bump as a return — documented in `ActivityObservation`.
 *
 * ═══ VERDICT (backend worker contract) ═══════════════════════════════════════
 *
 *   - 'returned' = ANY qualifying activity observed STRICTLY-OR-EQUAL after the
 *     intervention's createdAt and within the window. The EARLIEST such return
 *     is the return instant (coming back sooner is strictly better; the first
 *     genuine return ends the loop).
 *   - 'expired'  = no qualifying return strictly after the window end. Biases to
 *     escalation (parent), NEVER a false 'returned': only a real in-window
 *     observation can produce 'returned'; absence of one after the window is
 *     unambiguously 'expired'.
 *   - 'pending'  = window still open, no qualifying return yet (re-evaluate next
 *     cron). Malformed/unevaluable input also degrades to 'pending' — never a
 *     false escalation off corrupt data (a separate data-quality sweep owns
 *     that case).
 *
 * `lastActiveMs` is the ms-epoch of the earliest qualifying in-window return
 * (null when none / not returned). `daysSinceIntervention` is the whole rolling
 * days from createdAt to that return, floored (null when not returned) — feeds
 * the `system.engagement_returned.daysToReturn` payload.
 *
 * P5: grades are strings; this module never touches grade. The sentinel
 * `chapter_number = 0` Loop B uses is an integer, not a grade, and is not read
 * here (return is keyed on time only — there is no chapter to match for a
 * subject-less inactivity row). P13: inputs/outputs carry timestamps + derived
 * integers only — never PII.
 */

import {
  ADAPTIVE_LOOPS_BC_RULES,
  inactivityReturnWindowEndMs,
  type InactivityInterventionRecord,
  type ActivityObservation,
} from './adaptive-loops-rules';

const MS_PER_DAY = 86_400_000;

// Re-export the canonical record + observation types + window helper so the
// backend worker can import the entire Loop B return contract from this one
// module (the file the spec §7 file map names), without also reaching into
// adaptive-loops-rules.ts. No new shapes are minted — these are the canonical
// definitions, surfaced here for the backend's convenience.
export {
  inactivityReturnWindowEndMs,
  type InactivityInterventionRecord,
  type ActivityObservation,
} from './adaptive-loops-rules';

export type InactivityReturnVerdict = 'returned' | 'pending' | 'expired';

/**
 * The backend-facing verdict shape for Loop B verify. Field names match the
 * contract handed to the backend worker (`lastActiveMs`,
 * `daysSinceIntervention`) — see module header.
 */
export interface InactivityReturnEvaluation {
  verdict: InactivityReturnVerdict;
  /** ms-epoch of the earliest qualifying in-window return; null if none. */
  lastActiveMs: number | null;
  /**
   * Whole rolling days from the intervention's createdAt to the qualifying
   * return (floored); null when not returned. Feeds
   * `system.engagement_returned.daysToReturn`.
   */
  daysSinceIntervention: number | null;
}

/**
 * Evaluate whether a nudged student returned inside the return window. Pure and
 * deterministic; never throws — malformed input degrades to 'pending' (never
 * falsely escalates to a parent off corrupt data).
 *
 * Observation filtering: a qualifying-activity observation counts when it
 * (a) falls inside [createdAtMs, windowEndMs] INCLUSIVE, (b) is not in the
 * future (observedAtMs <= nowMs), and (c) carries a finite timestamp. The
 * EARLIEST such observation is the return instant.
 *
 * Bias-to-escalation guarantee: the only path to 'returned' is a real in-window
 * observation; with no such observation and the clock strictly past the window
 * end, the verdict is 'expired' (escalate to parent). No code path fabricates a
 * 'returned' from a missing/late/future/pre-nudge observation.
 */
export function evaluateInactivityReturn(
  record: InactivityInterventionRecord,
  activityObservations: ActivityObservation[],
  nowMs: number,
): InactivityReturnEvaluation {
  // Defensive: an unevaluable record stays pending (degrade, don't escalate).
  if (!Number.isFinite(record?.createdAtMs) || !Number.isFinite(nowMs)) {
    return { verdict: 'pending', lastActiveMs: null, daysSinceIntervention: null };
  }

  // Rolling-ms window end via the canonical helper (no duplicate boundary math).
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

  // Return check runs BEFORE expiry (boundary semantics in the header).
  if (earliest !== null) {
    const daysSinceIntervention = Math.floor(
      (earliest - record.createdAtMs) / MS_PER_DAY,
    );
    return {
      verdict: 'returned',
      lastActiveMs: earliest,
      daysSinceIntervention,
    };
  }

  // Expiry: strictly after the window boundary → bias to escalation.
  if (nowMs > windowEnd) {
    return { verdict: 'expired', lastActiveMs: null, daysSinceIntervention: null };
  }

  return { verdict: 'pending', lastActiveMs: null, daysSinceIntervention: null };
}

// Re-export the canonical return-window constant for callers that want the
// number alongside the evaluator (single source: ADAPTIVE_LOOPS_BC_RULES).
export const INACTIVITY_RETURN_WINDOW_DAYS =
  ADAPTIVE_LOOPS_BC_RULES.inactivity_return_window_days;
