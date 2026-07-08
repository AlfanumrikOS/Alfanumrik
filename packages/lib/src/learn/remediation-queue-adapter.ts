/**
 * Alfanumrik — Adaptive Closed Loop / Phase A Loop A
 * Remediation Queue Adapter (mastery-cliff → daily-rhythm injection planner).
 *
 * PURE module: zero I/O, zero DB, zero fetch, zero clock reads other than the
 * explicit `nowMs` the caller passes in. Backend routes/cron assemble the
 * already-authorized inputs (Pulse cliff signal, cognitive-load fatigue score,
 * the student's intervention ledger, today's queue size) and this module
 * decides — deterministically — whether and which remediation cards to inject
 * into today's daily rhythm.
 *
 * Style mirrors src/lib/pulse/signals.ts and src/lib/learn/due-reviews-adapter.ts:
 * documented constants, exported input/output types, a single pure entry point.
 *
 * ─── How this composes with existing machinery (no duplication) ─────────────
 *
 * 1. CLIFF DETECTION is NOT re-derived here. The gate is the
 *    `MasteryCliffSignal` produced by `deriveMasteryCliff` in
 *    src/lib/pulse/signals.ts (verdict 'flagged' / 'none' / 'unknown'). All
 *    mastery thresholds are imported from `PULSE_THRESHOLDS` — this module
 *    defines NO duplicate mastery constants.
 *
 * 2. DAILY RHYTHM BASE QUEUE comes from `composeDailyRhythm` in
 *    src/lib/learn/daily-rhythm-orchestrator.ts: 5 SRS + 1 ZPD + 1 reflection
 *    = 7 base items. `RemediationCard.kind = 'remediation_review'` is
 *    deliberately disjoint from the existing `RhythmItem` kinds so the backend
 *    can extend the queue union without touching the orchestrator.
 *
 * 3. FATIGUE convention comes from `updateCognitiveLoad` in
 *    src/lib/cognitive-engine.ts: `shouldEaseOff = fatigueScore > 0.6`
 *    (strict greater-than). Injecting EXTRA work into the queue is the
 *    opposite of easing off, so we skip injection under the exact same
 *    condition, with the exact same strict comparison.
 *
 * 4. REMEDIATION CONTENT for an injected card is resolved downstream via the
 *    Eedi-pattern lookup in src/lib/learn/wrong-answer-remediation.ts (and/or
 *    chapter SRS material). This module only plans WHICH (subject, chapter)
 *    gets a card today — never what the card contains.
 *
 * 5. ESCALATION TARGET: when `recovery-evaluation.ts` returns verdict
 *    'expired', the backend escalates by creating a
 *    `teacher_remediation_assignments` row (status 'assigned' — see migration
 *    20260613000004). 'recovered', 'expired'(→escalated), and teacher/student
 *    'dismissed' are all TERMINAL statuses; each starts the same-chapter
 *    cooldown below.
 *
 * ═══ RATIFIED LOOP CONSTANTS (academic justification) ═══════════════════════
 *
 * All constants live in ADAPTIVE_REMEDIATION_RULES — the single source of
 * truth for the adaptive closed loop. recovery-evaluation.ts imports from
 * here. No other module may redefine these numbers.
 *
 * • max_remediation_cards_per_day = 3 — RATIFIED. The base rhythm is 7 items;
 *   3 remediation cards caps remediation at 30% of a full 10-item day, so a
 *   struggling student still spends the majority of the session on regular
 *   forward progress (avoids the demotivating "all remediation" session, which
 *   contradicts the productive-struggle design of the ZPD slot).
 *
 * • max_daily_queue_total = 10 — RATIFIED. 7 base + 3 remediation = 10. At the
 *   exam-engine's typical 60-150s/question pacing this keeps the daily session
 *   in the 15-25 minute band — a realistic after-school cadence for CBSE
 *   students on the platform's target devices/network.
 *
 * • fatigue_skip_threshold = 0.6 (strict >) — RATIFIED. Identical value AND
 *   identical comparison operator to cognitive-engine `shouldEaseOff`
 *   (`fatigueScore > 0.6`). A `null` fatigue score (no recent session state)
 *   is treated as NOT fatigued: absence of signal is not a signal of fatigue,
 *   and the queue caps still bound the worst case.
 *
 * • chapter_cooldown_days = 3 — RATIFIED. After a TERMINAL intervention on the
 *   same (subject, chapter), wait 3 days before re-injecting. SM-2's first two
 *   intervals after a reset are 1 and 6 days (cognitive-engine `sm2Update`);
 *   3 days sits between them — long enough for at least one natural SRS review
 *   of that chapter to come due and produce a FRESH mastery observation (so we
 *   never re-flag off stale post-cliff data), short enough that a genuinely
 *   unrecovered cliff is re-addressed within the same school week.
 *   Boundary: the cooldown interval is [terminalAtMs, terminalAtMs + 3 days)
 *   — EXCLUSIVE end, so injection is allowed at exactly +3 days.
 *
 * • one active intervention per (student, subject, chapter) — RATIFIED.
 *   Duplicate concurrent interventions would double-inject cards and make the
 *   recovery window ambiguous (which trough? which baseline?). The adapter
 *   receives `activeInterventions` already scoped to the student, so the rule
 *   is enforced per (subject, chapter) here; the backend should mirror it with
 *   a partial unique index when it ships the table.
 *
 * • verification_window_days = 7 — RATIFIED (see recovery-evaluation.ts header
 *   for the full SM-2 / study-cadence argument).
 *
 * • recovery thresholds — REUSED from PULSE_THRESHOLDS, not redefined:
 *   recovery_min_gain_from_trough = mastery_cliff_drop (0.15) and
 *   recovery_at_risk_floor = at_risk_mastery (0.4). Rationale in
 *   recovery-evaluation.ts.
 *
 * P5: grades are strings; this module never touches grade. P13: inputs and
 * outputs carry internal identifiers (subject codes, chapter numbers,
 * intervention UUIDs) only — never PII.
 */

import { PULSE_THRESHOLDS, type MasteryCliffSignal } from '../pulse/signals';

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS — single source of truth for the adaptive closed loop.
// ════════════════════════════════════════════════════════════════════════════

export const ADAPTIVE_REMEDIATION_RULES = {
  /** Max remediation cards injected into one day's rhythm queue. */
  max_remediation_cards_per_day: 3,
  /** Hard cap on the total daily queue (7 base rhythm items + injections). */
  max_daily_queue_total: 10,
  /**
   * Skip injection when fatigueScore is STRICTLY greater than this.
   * Mirrors cognitive-engine `shouldEaseOff` (`fatigueScore > 0.6`) exactly.
   */
  fatigue_skip_threshold: 0.6,
  /**
   * Days after a TERMINAL intervention (recovered / expired→escalated /
   * dismissed) during which the same (subject, chapter) may not receive a new
   * injection. Interval is [terminalAt, terminalAt + cooldown) — exclusive end.
   */
  chapter_cooldown_days: 3,
  /** Recovery verification window (days). Justified in recovery-evaluation.ts. */
  verification_window_days: 7,
  /**
   * Minimum absolute mastery gain from the post-cliff trough for the
   * gain-based recovery branch. REUSES the cliff-detection drop threshold
   * (0.15): a recovery must be at least as large as the smallest drop that
   * can trigger a cliff, making detection and recovery symmetric and keeping
   * the rule robust to per-observation BKT noise (single BKT updates move
   * p_know far less than 0.15 outside first attempts).
   */
  recovery_min_gain_from_trough: PULSE_THRESHOLDS.mastery_cliff_drop,
  /**
   * The gain-based recovery branch additionally requires current mastery at
   * or above the platform-wide at-risk line (0.4) — a chapter cannot be
   * declared "recovered" while the platform's own concentration signal still
   * counts it at-risk, unless it is fully back at its pre-cliff baseline.
   */
  recovery_at_risk_floor: PULSE_THRESHOLDS.at_risk_mastery,
} as const;

const MS_PER_DAY = 86_400_000;

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

/**
 * One injectable remediation candidate, built by the backend from the Pulse
 * cliff signal + student context (typically one per cliffed chapter; the
 * `MasteryCliffSignal` itself carries only the WORST drop, so multi-chapter
 * candidates come from the underlying mastery-change events the route already
 * holds). `interventionId` is the id of the intervention ledger row the
 * backend created (or reserved) for this cliff — the adapter never mints ids.
 */
export interface AdaptiveInterventionCandidate {
  subjectCode: string;
  chapterNumber: number;
  interventionId: string;
  /**
   * Cliff drop magnitude (fromMastery - toMastery, 0..1). Null when unknown
   * (e.g. the score-trend cliff path has no mastery delta). Used only for
   * priority ordering — null sorts after any known magnitude.
   */
  dropMagnitude: number | null;
}

/** An intervention currently in a NON-terminal status for this student. */
export interface ActiveInterventionRef {
  subjectCode: string;
  chapterNumber: number;
}

/** An intervention that reached a terminal status (for cooldown checks). */
export interface TerminalInterventionRef {
  subjectCode: string;
  chapterNumber: number;
  /** When it became terminal (recovered/expired/dismissed), ms epoch. */
  terminalAtMs: number;
}

/**
 * A planned injection into the daily rhythm queue. `kind` is disjoint from
 * the daily-rhythm `RhythmItem` kinds so the queue union extends cleanly.
 */
export interface RemediationCard {
  kind: 'remediation_review';
  subjectCode: string;
  chapterNumber: number;
  interventionId: string;
  /** 1-based severity rank among today's injected cards; 1 = deepest drop. */
  priority: number;
}

export type RemediationPlanReason =
  | 'ok'            // at least one card injected
  | 'fatigue'       // fatigueScore > threshold — whole injection deferred
  | 'cooldown'      // every candidate blocked; top-priority blocker was cooldown
  | 'active_exists' // every candidate blocked; top-priority blocker was an active intervention
  | 'queue_full'    // no queue capacity left today
  | 'no_cliff';     // no flagged cliff / no actionable candidates

export interface PlanRemediationInput {
  /** Pulse mastery-cliff signal for this student (`deriveMasteryCliff`). */
  cliffSignal: MasteryCliffSignal;
  /** Injectable candidates derived from the cliff + student context. */
  candidates: AdaptiveInterventionCandidate[];
  /**
   * Latest cognitive-load fatigue score (0..1), or null when no recent
   * session state exists. Null / non-finite = treated as NOT fatigued.
   */
  fatigueScore: number | null;
  /** Non-terminal interventions for this student (one-active-per-chapter rule). */
  activeInterventions: ActiveInterventionRef[];
  /** Recently-terminal interventions (same-chapter cooldown rule). */
  recentTerminalInterventions: TerminalInterventionRef[];
  /** Items already in today's queue (base rhythm = 7). Fail-closed if unknown. */
  currentQueueSize: number;
  /** Current wall clock, ms epoch — passed in so the module stays pure. */
  nowMs: number;
}

export interface RemediationInjectionPlan {
  inject: RemediationCard[];
  /**
   * True when at least one wanted card could NOT be injected for a
   * TIME-BASED or CAPACITY reason (fatigue, cooldown, queue capacity) — the
   * caller should re-plan on the next cycle. Candidates blocked only by an
   * existing active intervention are NOT deferred (the live intervention
   * already covers that chapter).
   */
  deferred: boolean;
  reason: RemediationPlanReason;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function chapterKey(subjectCode: string, chapterNumber: number): string {
  return `${subjectCode}::${chapterNumber}`;
}

/**
 * The minimal shape the severity comparator ranks. Structurally satisfied by
 * `AdaptiveInterventionCandidate`; backend callers ranking other row shapes
 * (e.g. active adaptive_interventions rows in /api/rhythm/today) adapt to it.
 */
export interface SeverityRankable {
  subjectCode: string;
  chapterNumber: number;
  /** Cliff drop magnitude (0..1); null/non-finite ranks after any known value. */
  dropMagnitude: number | null;
}

/**
 * Severity ordering: deepest known drop first; null magnitudes last; ties
 * broken by subjectCode asc then chapterNumber asc (fully deterministic).
 *
 * EXPORTED (Round 2, assessment cond 4 — ratified): this is the SINGLE
 * severity comparator for the adaptive loop. The /api/rhythm/today lane
 * builder reuses it instead of duplicating the ordering; the logic is a pure
 * re-export of the original internal `bySeverity` — no behavior change.
 */
export function compareBySeverity(
  a: SeverityRankable,
  b: SeverityRankable,
): number {
  const aMag = a.dropMagnitude != null && Number.isFinite(a.dropMagnitude) ? a.dropMagnitude : -Infinity;
  const bMag = b.dropMagnitude != null && Number.isFinite(b.dropMagnitude) ? b.dropMagnitude : -Infinity;
  if (aMag !== bMag) return bMag - aMag;
  return (
    a.subjectCode.localeCompare(b.subjectCode) ||
    a.chapterNumber - b.chapterNumber
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Plan today's remediation injection. Pure and deterministic: same input
 * always yields the same plan. Never throws — malformed inputs degrade to the
 * safest plan (no injection).
 *
 * Guardrail precedence (documented; tests pin every boundary):
 *   1. no_cliff      — verdict !== 'flagged' OR zero candidates.
 *   2. fatigue       — fatigueScore > 0.6 (strict; mirrors shouldEaseOff).
 *   3. per-candidate — active_exists checked before cooldown; candidates are
 *                      deduped per (subject, chapter) keeping highest severity.
 *   4. queue_full    — capacity = min(3, 10 - currentQueueSize) must be > 0.
 *   5. ok            — inject up to capacity, severity-ordered, priority 1..n.
 *
 * When ALL candidates are blocked at step 3, `reason` is the blocker of the
 * TOP-PRIORITY (deepest-drop) candidate; `deferred` is true iff any candidate
 * was blocked by cooldown (it becomes eligible later).
 */
export function planRemediationInjection(
  input: PlanRemediationInput,
): RemediationInjectionPlan {
  // ── 1. Cliff gate ─────────────────────────────────────────────────────────
  const candidates = input.candidates ?? [];
  if (input.cliffSignal?.verdict !== 'flagged' || candidates.length === 0) {
    return { inject: [], deferred: false, reason: 'no_cliff' };
  }

  // ── 2. Fatigue gate (strict >, exactly-at-threshold injects) ──────────────
  const fatigue = input.fatigueScore;
  if (
    fatigue != null &&
    Number.isFinite(fatigue) &&
    fatigue > ADAPTIVE_REMEDIATION_RULES.fatigue_skip_threshold
  ) {
    return { inject: [], deferred: true, reason: 'fatigue' };
  }

  // ── 3. Dedupe + severity sort + per-candidate guardrails ──────────────────
  const sorted = [...candidates].sort(compareBySeverity);
  const seen = new Set<string>();
  const deduped: AdaptiveInterventionCandidate[] = [];
  for (const c of sorted) {
    const key = chapterKey(c.subjectCode, c.chapterNumber);
    if (seen.has(key)) continue; // keep highest-severity duplicate only
    seen.add(key);
    deduped.push(c);
  }

  const activeKeys = new Set(
    (input.activeInterventions ?? []).map((a) =>
      chapterKey(a.subjectCode, a.chapterNumber),
    ),
  );

  const cooldownMs =
    ADAPTIVE_REMEDIATION_RULES.chapter_cooldown_days * MS_PER_DAY;
  const inCooldown = (c: AdaptiveInterventionCandidate): boolean =>
    (input.recentTerminalInterventions ?? []).some(
      (t) =>
        t.subjectCode === c.subjectCode &&
        t.chapterNumber === c.chapterNumber &&
        Number.isFinite(t.terminalAtMs) &&
        // [terminalAt, terminalAt + cooldown) — exclusive end: at exactly
        // +3 days the cooldown is over and injection is allowed.
        input.nowMs < t.terminalAtMs + cooldownMs,
    );

  const eligible: AdaptiveInterventionCandidate[] = [];
  const blockReasons: Array<'active_exists' | 'cooldown'> = [];
  let anyCooldownBlock = false;

  for (const c of deduped) {
    if (activeKeys.has(chapterKey(c.subjectCode, c.chapterNumber))) {
      blockReasons.push('active_exists');
      continue;
    }
    if (inCooldown(c)) {
      blockReasons.push('cooldown');
      anyCooldownBlock = true;
      continue;
    }
    eligible.push(c);
  }

  if (eligible.length === 0) {
    // Every candidate blocked. Reason = blocker of the top-priority candidate
    // (blockReasons is in severity order because deduped is).
    const reason = blockReasons[0] ?? 'no_cliff';
    return { inject: [], deferred: anyCooldownBlock, reason };
  }

  // ── 4. Capacity gate (fail closed on unknown queue size) ──────────────────
  const rawQueueSize = input.currentQueueSize;
  if (!Number.isFinite(rawQueueSize)) {
    // Unknown queue size: injection is an enhancement — never risk overload.
    return { inject: [], deferred: true, reason: 'queue_full' };
  }
  const queueSize = Math.max(0, rawQueueSize);
  const capacity = Math.min(
    ADAPTIVE_REMEDIATION_RULES.max_remediation_cards_per_day,
    ADAPTIVE_REMEDIATION_RULES.max_daily_queue_total - queueSize,
  );
  if (capacity <= 0) {
    return { inject: [], deferred: true, reason: 'queue_full' };
  }

  // ── 5. Inject up to capacity, severity-ordered ────────────────────────────
  const chosen = eligible.slice(0, capacity);
  const inject: RemediationCard[] = chosen.map((c, i) => ({
    kind: 'remediation_review' as const,
    subjectCode: c.subjectCode,
    chapterNumber: c.chapterNumber,
    interventionId: c.interventionId,
    priority: i + 1,
  }));

  const capacityOverflow = eligible.length > capacity;
  return {
    inject,
    deferred: capacityOverflow || anyCooldownBlock,
    reason: 'ok',
  };
}
