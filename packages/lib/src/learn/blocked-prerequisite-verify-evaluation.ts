/**
 * Alfanumrik — Adaptive Closed Loops / Loop D (blocked_prerequisite, Digital
 * Twin + Knowledge Graph Slice 1)
 * Verify Evaluation (has the blocking prerequisite recovered?).
 *
 * PURE module: zero I/O, zero DB, zero clock reads other than the explicit
 * `nowMs` the caller passes in. Mirrors the shape of recovery-evaluation.ts
 * (Loop A) and concentration-resolution-evaluation.ts (Loop C) exactly:
 *
 *   - a frozen-at-inject record (here: the trigger_snapshot's prerequisite
 *     chapter + the window bounds),
 *   - the student's CURRENT observation(s) for that prerequisite chapter,
 *   - a pure verdict function that never throws and degrades to the SAFE
 *     side (still_blocked) on malformed/missing input.
 *
 * ═══ WHY THIS FILE EXISTS (the crowding-out bug it fixes) ════════════════════
 *
 * Loop D Slice 1 shipped detection-only: `blocked_prerequisite` rows were
 * always routed straight to `summary.pending++` in the cron worker's verify
 * phase with a comment that the evaluator "lands in a later slice" — meaning
 * these rows NEVER left `active` state and were re-selected by the bounded
 * `MAX_VERIFY_ROWS_PER_RUN` sweep every single night, forever. At scale this
 * crowds out real Loop A/B/C rows from the same bounded sweep. This module is
 * that later slice: it lets `blocked_prerequisite` rows actually transition to
 * a terminal state (`recovered` on resolution, `escalated` when the window
 * elapses with no resolution — Slice 1 has no parent/teacher notification
 * channel wired for Loop D yet, so `escalated` here is a durable terminal
 * state, not a live human handoff; that channel is a further follow-up).
 *
 * ═══ RESOLUTION DEFINITION (symmetric with the block that opened the loop) ═══
 *
 * The classification is delegated ENTIRELY to
 * `classifyPrerequisiteBlock` (adaptive-loops-rules.ts) — the SAME function
 * and the SAME two canonical floors (`BLOCKED_PREREQUISITE_RULES.mastery_floor`
 * / `.decay_floor`) that decided the block at inject time. Resolution is
 * simply "classifyPrerequisiteBlock now returns `blocked: false`" at the
 * LATEST in-window observation — perfectly symmetric with the trigger, and
 * zero threshold duplication (guardrail: no second, drifting definition of
 * "blocked").
 *
 * ═══ VERIFY WINDOW: 7 DAYS (BLOCKED_PREREQUISITE_RULES.return_window_days) ═══
 *
 * Clearing a single prerequisite chapter is a single-chapter recovery — the
 * same shape as Loop A's mastery-cliff recovery — so it reuses Loop A's 7-day
 * cadence rather than Loop C's 14-day subject-wide window. The constant is
 * NOT redefined here; it is read from BLOCKED_PREREQUISITE_RULES (single
 * source of truth) exactly like recovery-evaluation.ts reads
 * ADAPTIVE_REMEDIATION_RULES.verification_window_days.
 *
 * ═══ WINDOW BOUNDARY SEMANTICS (identical to Loops A & C) ════════════════════
 *
 *   - ROLLING-MILLISECOND window: windowEndMs = createdAtMs + windowDays * 24h.
 *   - An observation counts when createdAtMs <= observedAtMs <= windowEndMs —
 *     INCLUSIVE at both ends — and is not in the future (observedAtMs <= nowMs).
 *   - 'expired' fires only STRICTLY AFTER the boundary (nowMs > windowEndMs);
 *     at exactly windowEndMs a still-blocked prerequisite is still
 *     'still_blocked'.
 *   - 'resolved' is checked BEFORE expiry: a resolution observed exactly at
 *     the boundary instant beats a same-instant expiry sweep (resolves in the
 *     student's favor); a late evaluation of an in-window resolution still
 *     reads 'resolved'.
 *   - The LATEST in-window observation decides (not best-in-window) — a
 *     transient mid-window recovery that regresses again is NOT a resolution,
 *     mirroring the latest-reading robustness of the other two evaluators.
 *
 * P5: grades are strings; this module never touches grade. P13: inputs and
 * outputs carry subject codes, chapter numbers, and derived BKT/retention
 * numbers only — never PII.
 */

import {
  BLOCKED_PREREQUISITE_RULES,
  classifyPrerequisiteBlock,
  type PrerequisiteState,
} from './adaptive-loops-rules';

const MS_PER_DAY = 86_400_000;

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

/** One blocked-prerequisite intervention awaiting verify. Frozen fields come
 *  from the row's trigger_snapshot + created_at/verify_by at inject time. */
export interface BlockedPrerequisiteInterventionRecord {
  /** Dependent (advanced) chapter's subject — same subject the row is keyed on. */
  subjectCode: string;
  /** The upstream prerequisite chapter that blocked at inject time. */
  prereqChapterNumber: number;
  /** The dependent (advanced) chapter the student was blocked on. */
  dependentChapterNumber: number;
  /** When the intervention was opened, ms epoch. */
  createdAtMs: number;
  /**
   * Verify window in days. Canonical:
   * BLOCKED_PREREQUISITE_RULES.return_window_days (7). Non-finite or <= 0
   * falls back to the canonical default (degrade, don't throw).
   */
  windowDays: number;
}

/**
 * One CURRENT reading for the prerequisite chapter, in the exact shape
 * `classifyPrerequisiteBlock` (via `PrerequisiteState`) expects. Unlike Loop
 * A/C, which replay a stream of historical events, Loop D verify re-checks
 * LIVE state at sweep time — callers typically pass a single-element array
 * (the current BKT/decay reading), but the evaluator accepts any array and
 * picks the latest in-window entry, so it composes if a future caller ever
 * wants to replay a history instead.
 */
export interface PrerequisiteMasteryObservation {
  subjectCode: string;
  prereqChapterNumber: number;
  /** Current BKT p_know for the prerequisite chapter (0..1); null if unread. */
  pKnow: number | null;
  /** Whole days since the prerequisite was last studied; null if unread. */
  daysSinceStudy: number | null;
  /** SM-2 memory-strength multiplier; null/non-finite => 1.0 (classifier default). */
  strength?: number | null;
  /** When this reading was taken, ms epoch. */
  observedAtMs: number;
}

export type BlockedPrerequisiteVerdict = 'resolved' | 'still_blocked' | 'expired';

export interface BlockedPrerequisiteEvaluation {
  verdict: BlockedPrerequisiteVerdict;
  /** Prerequisite BKT p_know at the latest in-window observation; null if none. */
  prereqPKnowNow: number | null;
  /** Prerequisite predicted retention at the latest in-window observation; null if none. */
  retentionNow: number | null;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function effectiveWindowDays(windowDays: number): number {
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    return BLOCKED_PREREQUISITE_RULES.return_window_days;
  }
  return windowDays;
}

/**
 * End of the verify window (ms epoch) for a blocked-prerequisite intervention
 * record. Exported so the backend cron can query/reason about "records whose
 * window has ended" with the exact boundary math the verdict uses (mirrors
 * `verificationWindowEndMs` in recovery-evaluation.ts).
 */
export function blockedPrerequisiteVerifyWindowEndMs(
  record: BlockedPrerequisiteInterventionRecord,
): number {
  return record.createdAtMs + effectiveWindowDays(record.windowDays) * MS_PER_DAY;
}

// ════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate whether a blocked-prerequisite intervention's prerequisite chapter
 * has recovered. Pure and deterministic; never throws — malformed input
 * degrades to 'still_blocked' with null metrics (never falsely resolves or
 * silently drops a row off corrupt data).
 *
 * Observation filtering: only observations that (a) match the record's
 * (subjectCode, prereqChapterNumber), (b) fall inside
 * [createdAtMs, windowEndMs] inclusive, (c) are not in the future
 * (observedAtMs <= nowMs), and (d) carry a usable reading on at least one
 * axis (finite `pKnow` or a finite non-negative `daysSinceStudy` —
 * `classifyPrerequisiteBlock`'s own "unevaluable" definition) are considered.
 * A fully-unreadable observation (both axes unreadable) is excluded so it can
 * never be classified as `blocked: false` and falsely resolve the row — that
 * classification is correct at INJECT time ("don't fire off no data") but
 * would be a false-positive closure at VERIFY time. The LATEST remaining
 * observation (max observedAtMs; on equal timestamps the later array element
 * wins — callers pass chronological order) is classified via
 * `classifyPrerequisiteBlock`.
 */
export function evaluateBlockedPrerequisiteResolution(
  record: BlockedPrerequisiteInterventionRecord,
  observations: PrerequisiteMasteryObservation[],
  nowMs: number,
): BlockedPrerequisiteEvaluation {
  // Defensive: an unevaluable record stays still_blocked (degrade, don't
  // silently resolve or drop off corrupt data).
  if (!Number.isFinite(record?.createdAtMs) || !Number.isFinite(nowMs)) {
    return { verdict: 'still_blocked', prereqPKnowNow: null, retentionNow: null };
  }

  const windowEnd = blockedPrerequisiteVerifyWindowEndMs(record);

  // ── Latest usable in-window observation ───────────────────────────────────
  let latest: PrerequisiteMasteryObservation | null = null;
  for (const obs of observations ?? []) {
    if (obs.subjectCode !== record.subjectCode) continue;
    if (obs.prereqChapterNumber !== record.prereqChapterNumber) continue;
    if (!Number.isFinite(obs.observedAtMs)) continue;
    if (obs.observedAtMs < record.createdAtMs) continue; // pre-intervention
    if (obs.observedAtMs > windowEnd) continue; // outside window (inclusive end)
    if (obs.observedAtMs > nowMs) continue; // future reading — ignore
    // Fully-unreadable observations (neither axis usable) are not a valid
    // candidate for `latest` — mirrors classifyPrerequisiteBlock's own
    // "unevaluable" definition so a data glitch/delayed BKT update/RPC hiccup
    // can never masquerade as classification's `blocked: false` and falsely
    // resolve the row. A partial reading (only one axis readable) is still a
    // legitimately-evaluable observation and passes through.
    const masteryReadable = typeof obs.pKnow === 'number' && Number.isFinite(obs.pKnow);
    const daysReadable =
      typeof obs.daysSinceStudy === 'number' &&
      Number.isFinite(obs.daysSinceStudy) &&
      obs.daysSinceStudy >= 0;
    if (!masteryReadable && !daysReadable) continue; // fully unreadable — not a valid observation
    // `>=` so equal timestamps resolve to the later array element.
    if (latest === null || obs.observedAtMs >= latest.observedAtMs) {
      latest = obs;
    }
  }

  let retentionNow: number | null = null;
  if (latest != null) {
    const state: PrerequisiteState = {
      subjectCode: record.subjectCode,
      prereqChapterNumber: record.prereqChapterNumber,
      dependentChapterNumber: record.dependentChapterNumber,
      prereqPKnow: latest.pKnow,
      prereqDaysSinceStudy: latest.daysSinceStudy,
      prereqStrength: latest.strength,
    };
    const classification = classifyPrerequisiteBlock(state);
    retentionNow = classification.retention;

    // ── Resolution check (runs BEFORE expiry — see boundary semantics) ──────
    if (!classification.blocked) {
      return { verdict: 'resolved', prereqPKnowNow: latest.pKnow, retentionNow };
    }
  }

  // ── Expiry: strictly after the window boundary ─────────────────────────────
  if (nowMs > windowEnd) {
    return {
      verdict: 'expired',
      prereqPKnowNow: latest?.pKnow ?? null,
      retentionNow,
    };
  }

  return {
    verdict: 'still_blocked',
    prereqPKnowNow: latest?.pKnow ?? null,
    retentionNow,
  };
}
