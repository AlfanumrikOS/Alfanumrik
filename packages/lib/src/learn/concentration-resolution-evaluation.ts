/**
 * Alfanumrik — Adaptive Closed Loops / Phase A Loop C (at-risk concentration)
 * Resolution Evaluation (did the at-risk subject drop out of the 'high' band?).
 *
 * PURE module: zero I/O, zero DB, zero fetch, zero clock reads other than the
 * explicit `nowMs` the caller passes in. The backend cron/route loads the
 * concentration intervention record plus the subject's per-snapshot
 * at-risk-chapter counts during the verify window and asks this module for a
 * verdict. On 'expired' the backend RE-NOTIFIES the same human (teacher re-flag
 * / parent re-alert / ops) — Decision C4, NOT a second intervention row; on
 * 'resolved' it closes the intervention as `recovered`.
 *
 * ─── How this composes with existing machinery (no duplication) ─────────────
 *
 * 1. THE BAND BOUNDARY IS NOT REDEFINED HERE. The 'high' entry/exit boundary is
 *    `concentration_high_min` (5), which lives in src/lib/pulse/signals.ts
 *    `PULSE_THRESHOLDS` and is re-exported (NOT re-typed) through
 *    ADAPTIVE_LOOPS_BC_RULES. The band predicate this module uses is the exact
 *    same `deriveAtRiskConcentration` band logic from signals.ts — IMPORTED,
 *    never re-derived (guardrail B/C-6). The trigger ('high' opened the loop)
 *    and the resolution ('count < high_min' closes it) read ONE boundary, so
 *    open and close are perfectly symmetric.
 *
 * 2. CONSTANTS + WINDOW MATH are NOT redefined here. The return window
 *    (`concentration_return_window_days = 14`) and the rolling-ms boundary
 *    helper (`concentrationReturnWindowEndMs`) live in the single source of
 *    truth, src/lib/learn/adaptive-loops-rules.ts, and are imported. This
 *    module is the backend-facing CONTRACT surface (the spec §7 file map
 *    promises `concentration-resolution-evaluation.ts` with
 *    `evaluateConcentrationResolution`); it delegates the load-bearing window
 *    arithmetic + band classification to the canonical layer so detection and
 *    verification can never drift.
 *
 * 3. BOUNDARY SEMANTICS mirror recovery-evaluation.ts EXACTLY:
 *      - ROLLING-MILLISECOND window (every subject gets windowDays × 24h
 *        regardless of the time of day the escalation fired).
 *      - A snapshot counts when createdAtMs <= observedAtMs <= windowEndMs —
 *        INCLUSIVE at both ends.
 *      - 'expired' fires only STRICTLY AFTER the boundary (nowMs > windowEndMs);
 *        at exactly windowEndMs a still-'high' subject is still 'pending'.
 *      - 'resolved' is checked BEFORE expiry: a band-drop snapshot at the exact
 *        boundary instant beats a same-instant expiry sweep (resolves in the
 *        student's favor); a late evaluation of an in-window resolution still
 *        reads 'resolved'.
 *      - LATEST snapshot decides (not best-in-window): a transient mid-window
 *        dip that climbs back to 'high' is NOT a resolution — the subject's
 *        current durable state is what matters, mirroring the latest-reading
 *        robustness of recovery-evaluation.ts. Conversely, a mid-window 'high'
 *        followed by a sustained drop IS resolved.
 *
 * 4. CHAPTER CHURN IS A NON-ISSUE. The intervention's `chapter_number` is the
 *    worst-at-trigger chapter, fixed at inject; this verify keys on the
 *    SUBJECT's count, not the specific chapter (the worst chapter may change
 *    across the 14-day window). Snapshots are matched by `subjectCode` only.
 *
 * ═══ VERDICT (backend worker contract) ═══════════════════════════════════════
 *
 *   - 'resolved' = the subject's at-risk-chapter count is BELOW
 *     `concentration_high_min` (5) — back to medium/low/none — at the LATEST
 *     in-window snapshot. Symmetric with the 'high'-band trigger.
 *   - 'expired'  = still 'high' (count >= 5) at the window end, OR no in-window
 *     snapshot at all after the window. Triggers a re-notify (Decision C4),
 *     never a silent close and never a false 'resolved'.
 *   - 'pending'  = window still open and the subject is still 'high' (or no
 *     usable snapshot yet). Malformed/unevaluable input also degrades to
 *     'pending' — never a false resolution or re-notify off corrupt data.
 *
 * `atRiskCountNow` is the at-risk-chapter count at the latest usable in-window
 * snapshot (null when none). `bandNow` is the band recomputed here from that
 * count against the canonical boundary (null when none) — never trusted blindly
 * from the snapshot, so a snapshot need only carry the count + a timestamp.
 *
 * P5: grades are strings; this module never touches grade. P13: inputs/outputs
 * carry subject codes + derived integer counts + timestamps only — never PII.
 */

import {
  ADAPTIVE_LOOPS_BC_RULES,
  concentrationReturnWindowEndMs,
  type ConcentrationInterventionRecord,
  type SubjectSnapshotObservation,
} from './adaptive-loops-rules';
import { PULSE_THRESHOLDS, type ConcentrationBand } from '../pulse/signals';

const MS_PER_DAY = 86_400_000;

// Re-export the canonical record + snapshot types + window helper so the
// backend worker can import the entire Loop C resolution contract from this one
// module (the file the spec §7 file map names). No new shapes are minted —
// these are the canonical definitions, surfaced here for convenience.
export {
  concentrationReturnWindowEndMs,
  type ConcentrationInterventionRecord,
  type SubjectSnapshotObservation,
} from './adaptive-loops-rules';

export type ConcentrationResolutionVerdict = 'resolved' | 'pending' | 'expired';

/**
 * The backend-facing verdict shape for Loop C verify. Field names match the
 * contract handed to the backend worker (`atRiskCountNow`, `bandNow`) — see
 * module header. `daysToResolve` feeds
 * `system.concentration_resolved.daysToResolve`.
 */
export interface ConcentrationResolutionEvaluation {
  verdict: ConcentrationResolutionVerdict;
  /** At-risk-chapter count at the latest in-window snapshot; null if none. */
  atRiskCountNow: number | null;
  /** Band recomputed from `atRiskCountNow` against the canonical boundary. */
  bandNow: ConcentrationBand | null;
  /**
   * Whole rolling days from createdAt to the resolving snapshot (floored);
   * null when not resolved.
   */
  daysToResolve: number | null;
}

/**
 * Recompute the concentration band from an at-risk-chapter count using the SAME
 * `PULSE_THRESHOLDS` boundaries the `deriveAtRiskConcentration` signal uses — no
 * duplicate boundary (guardrail B/C-6). 'high' iff count >= concentration_high_min.
 */
function bandForCount(count: number): ConcentrationBand {
  if (count >= PULSE_THRESHOLDS.concentration_high_min) return 'high';
  if (count >= PULSE_THRESHOLDS.concentration_medium_min) return 'medium';
  if (count >= PULSE_THRESHOLDS.concentration_low_min) return 'low';
  return 'none';
}

/**
 * Evaluate whether a concentration intervention's subject has dropped below the
 * 'high' band inside the return window. Pure and deterministic; never throws —
 * malformed input degrades to 'pending' (never falsely resolves or re-notifies
 * off corrupt data).
 *
 * Snapshot filtering: a snapshot counts when it (a) matches the record's
 * subjectCode, (b) falls inside [createdAtMs, windowEndMs] INCLUSIVE, (c) is
 * not in the future (observedAtMs <= nowMs), and (d) carries a finite count +
 * timestamp. The LATEST such snapshot (max observedAtMs; later array element
 * wins on ties — callers pass chronological order) supplies the current
 * count/band.
 */
export function evaluateConcentrationResolution(
  record: ConcentrationInterventionRecord,
  subjectMasteryObservations: SubjectSnapshotObservation[],
  nowMs: number,
): ConcentrationResolutionEvaluation {
  // Defensive: an unevaluable record stays pending (degrade, don't re-notify).
  if (!Number.isFinite(record?.createdAtMs) || !Number.isFinite(nowMs)) {
    return {
      verdict: 'pending',
      atRiskCountNow: null,
      bandNow: null,
      daysToResolve: null,
    };
  }

  // Rolling-ms window end via the canonical helper (no duplicate boundary math).
  const windowEnd = concentrationReturnWindowEndMs(record);

  // Latest in-window snapshot for the record's subject.
  let latest: SubjectSnapshotObservation | null = null;
  for (const s of subjectMasteryObservations ?? []) {
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

  const atRiskCountNow = latest ? latest.atRiskChapterCount : null;
  const bandNow = atRiskCountNow != null ? bandForCount(atRiskCountNow) : null;

  // Resolution check runs BEFORE expiry (boundary semantics in the header).
  if (latest != null && bandNow !== 'high') {
    const daysToResolve = Math.floor(
      (latest.observedAtMs - record.createdAtMs) / MS_PER_DAY,
    );
    return { verdict: 'resolved', atRiskCountNow, bandNow, daysToResolve };
  }

  // Expiry: strictly after the window boundary (still 'high' / no snapshot).
  if (nowMs > windowEnd) {
    return { verdict: 'expired', atRiskCountNow, bandNow, daysToResolve: null };
  }

  return { verdict: 'pending', atRiskCountNow, bandNow, daysToResolve: null };
}

// Re-export the canonical return-window constant for callers that want the
// number alongside the evaluator (single source: ADAPTIVE_LOOPS_BC_RULES).
export const CONCENTRATION_RETURN_WINDOW_DAYS =
  ADAPTIVE_LOOPS_BC_RULES.concentration_return_window_days;
