// packages/lib/src/predict/outcome-prediction.ts
//
// Outcome Prediction Agent — PURE composer (GenAI arch Phase 5a).
//
// This module COMPOSES the platform's EXISTING predictors into one unified,
// typed `OutcomePrediction`. It invents NO new prediction math, NO new
// thresholds, and NO new confidence formula. Every numeric behaviour is
// delegated to, or read verbatim from:
//
//   • `predictExamScore(chapters, totalMarks)`   — cognitive-engine (the core
//      per-chapter → total-marks predictor; returns { predicted, confidence,
//      breakdown }). We reuse its returned `confidence` and its `predicted`.
//   • `calculateBoardExamScore(correct,total,totalMarks)` — cognitive-engine
//      (the CBSE grade bands A1/A2/B1/B2/C1/D). We reuse it as the SOLE oracle
//      for grade labels AND for the D-band pass boundary (never hardcode 50).
//   • `PULSE_THRESHOLDS.at_risk_mastery` (0.4) — pulse/signals (the single
//      platform-wide at-risk mastery line). Reused verbatim.
//   • Precomputed rows `board_score_predictions` / `cme_exam_readiness` — read
//      verbatim when present; NEVER recomputed here.
//
// ── WHAT/HOW + READ-ONLY (registry contract) ─────────────────────────────────
// The Outcome Prediction agent decides HOW to *project* a learner's trajectory.
// It is a READ-ONLY projection. It writes NOTHING — not mastery, not
// progression, not XP, and specifically NOT `board_score_predictions` /
// `cme_exam_readiness` (the cron / edge functions own those rows). This module
// is a pure function: no I/O, no DB, no `Date.now`, no `throw`. The backend
// route (later, backend-owned) reads the DB and calls `composeOutcomePrediction`.
//
// ── DATA-SOURCE RESILIENCE (fallback ladder) ─────────────────────────────────
//   Tier 1  board_score_predictions present → range + coverage-widened band
//           read straight from the row; confidence = coverage passthrough.
//   Tier 2  memory-derived per-chapter masteries present → `predictExamScore`;
//           band synthesized from the confidence THAT PREDICTOR RETURNS.
//   Tier 2' only cme_exam_readiness present → its overall_score / predicted_marks
//           read verbatim as the point estimate; band synthesized the same way,
//           confidence mirrors predictExamScore's mastery-based confidence
//           (= overall_score/100). No recompute of the board score.
//   Tier 3  none of the above → explicit `insufficient_data`, low confidence.
//
// ── PASS-MARK (product decision, NOT assumed here) ───────────────────────────
// The platform has NO canonical 33% pass constant. "Pass" is expressed here
// ONLY in terms of the EXISTING CBSE bands: `passLikelihood` is a coverage-aware
// likelihood of landing at/above the D→C1 boundary (grade != 'D'), where that
// boundary is DERIVED from `calculateBoardExamScore` (not a literal). Whether a
// canonical numeric pass-mark should exist is a product decision for
// CEO/architect — flagged in the spec, NOT decided here.

import {
  predictExamScore,
  calculateBoardExamScore,
  type ExamChapter,
} from '../cognitive-engine';
import { PULSE_THRESHOLDS, type PulseSignals } from '../pulse/signals';

// ════════════════════════════════════════════════════════════════════════════
// INPUT TYPES — all ALREADY-READ upstream (the route does the DB + auth work).
// ════════════════════════════════════════════════════════════════════════════

/** A precomputed `board_score_predictions` row (read verbatim; never recomputed). */
export interface BoardScorePredictionRow {
  /** predicted_pct (0..100). */
  predictedPct: number;
  /** confidence_band_low (percentage, ±10 / ±15-if-coverage<60 already applied). */
  confidenceBandLow: number;
  /** confidence_band_high (percentage). */
  confidenceBandHigh: number;
  /** coverage_pct (0..100) — syllabus coverage the prediction was built on. */
  coveragePct: number;
  /** chapter_scores (optional, for weak-chapter surfacing). */
  chapterScores?: Array<{ chapter: string | number; predicted: number; max?: number }>;
  /** recovery_plan (optional, feeds interventions/weak-concepts). */
  recoveryPlan?: Array<{ chapter: string | number; action?: string; actionHi?: string }>;
}

/** A precomputed `cme_exam_readiness` row (read verbatim; never recomputed). */
export interface CmeExamReadinessRow {
  /** overall_score (0..100). */
  overallScore: number;
  /** predicted_marks (absolute marks). */
  predictedMarks: number;
  /** weakest_chapters (optional). */
  weakestChapters?: Array<{ chapter: string | number; mastery?: number; title?: string }>;
}

/** Concept-level slices projected from unified StudentMemory (`cognitive.*`). */
export interface MemoryDerivedInputs {
  /** cognitive.weakTopics — { title, mastery(0..1), attempts }. */
  weakTopics?: Array<{ title: string; mastery: number; attempts?: number }>;
  /** cognitive.knowledgeGaps — { target, prerequisite, gapType }. */
  knowledgeGaps?: Array<{
    target: string;
    prerequisite: string;
    gapType: string;
    description?: string;
    descriptionHi?: string;
  }>;
}

/**
 * The complete already-read input bundle for `composeOutcomePrediction`.
 * Every field is optional/defensive so the composer degrades to
 * `insufficient_data` rather than throwing.
 */
export interface OutcomePredictionInputs {
  subject: string;
  /** P5: grade is a STRING "6".."12", never int. Passed through verbatim. */
  grade: string;
  /** Total board marks. When omitted, the CBSE default (80) is read from
   *  `calculateBoardExamScore` — never hardcoded here. */
  totalBoardMarks?: number;

  // ── Tier-1 precomputed rows (read verbatim; may be absent) ──
  boardScorePrediction?: BoardScorePredictionRow | null;
  cmeExamReadiness?: CmeExamReadinessRow | null;

  // ── Tier-2 pure-predictor inputs (memory-derived per-chapter masteries +
  //    cbse_chapter_weights, already assembled by the route) ──
  chapters?: ExamChapter[];

  // ── Concept-level memory slices ──
  memory?: MemoryDerivedInputs;

  // ── Pulse at-risk signals (already derived via deriveSignals upstream) ──
  pulseSignals?: PulseSignals | null;

  // ── Learning velocity (already computed via calculateLearningVelocity) ──
  learningVelocity?: number | null;
}

// ════════════════════════════════════════════════════════════════════════════
// OUTPUT TYPES
// ════════════════════════════════════════════════════════════════════════════

/** Which source the board-score range was built from (fallback ladder tier). */
export type PredictionSource =
  | 'board_score_predictions'
  | 'pure_predict_exam_score'
  | 'cme_exam_readiness'
  | 'insufficient_data';

/** Pass likelihood expressed strictly in terms of the existing CBSE bands. */
export type PassBand = 'likely' | 'borderline' | 'at_risk' | 'unknown';

export interface PassLikelihood {
  /** Band-honest verdict derived from the CBSE grade oracle over [low, high]. */
  band: PassBand;
  /** Coverage-aware P(grade != 'D') over the predicted interval, 0..1; null
   *  when there is no interval to measure. */
  likelihood: number | null;
  /** Confidence in this sub-prediction (mirrors overall board-score confidence). */
  confidence: number;
  /** The CBSE boundary used, derived from calculateBoardExamScore (never a literal). */
  basis: string;
}

export interface BoardScoreRange {
  /** Percentages (0..100). */
  low: number;
  mid: number;
  high: number;
  /** Absolute marks. */
  lowMarks: number;
  midMarks: number;
  highMarks: number;
  totalMarks: number;
  /** CBSE band at mid / low / high, from calculateBoardExamScore. */
  grade: string;
  gradeLow: string;
  gradeHigh: string;
  /** The reported coverage-widened band [low, high] in percentage points. */
  confidenceBand: [number, number];
}

export interface WeakConcept {
  label: string;
  kind: 'knowledge_gap' | 'weak_topic' | 'weak_chapter';
  /** Mastery 0..1 when known, else null. */
  mastery: number | null;
  detail?: string;
  detailHi?: string;
  source: 'memory' | 'board_score_predictions' | 'cme_exam_readiness';
}

export interface InterventionRecommendation {
  kind:
    | 'remediate_prerequisite'
    | 'review_regression'
    | 'revise_chapter'
    | 'concentrate_subject'
    | 'resume_practice';
  /** The concept / chapter / subject the action targets. */
  target: string;
  reason: string;
  reasonHi?: string;
  /** Deterministic ordinal rank (lower = more urgent). Ordering only, not a threshold. */
  priority: number;
}

export interface RationaleDriver {
  /** Stable machine code for the driver (e.g. 'weak_prerequisites'). */
  code: string;
  detail: string;
  detailHi?: string;
}

export interface OutcomePrediction {
  subject: string;
  /** P5 string. */
  grade: string;
  source: PredictionSource;
  /** false only for the insufficient_data tier. */
  sufficientData: boolean;

  passLikelihood: PassLikelihood;
  boardScoreRange: BoardScoreRange | null;
  weakConcepts: WeakConcept[];
  atRiskSignals: {
    signals: PulseSignals | null;
    anyAtRisk: boolean;
  };
  interventionRecommendations: InterventionRecommendation[];
  confidence: {
    overall: number;
    perPrediction: {
      boardScore: number;
      passLikelihood: number;
    };
  };
  /** Deterministic, structured explanation — assembled from inputs, never LLM. */
  rationale: RationaleDriver[];
  /** Mastery points/day (from calculateLearningVelocity), passed through. */
  learningVelocity: number | null;
}

// ════════════════════════════════════════════════════════════════════════════
// PURE HELPERS
// ════════════════════════════════════════════════════════════════════════════

/** Clamp to the [0, 1] probability/fraction domain. */
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Clamp to the [0, max] marks domain. */
function clampMarks(x: number, max: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > max ? max : x;
}

/** Round a percentage/marks value to one decimal for stable display. */
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * Read the CBSE default total board marks (80) from its source of truth rather
 * than hardcoding it. `calculateBoardExamScore` carries the default.
 */
function defaultBoardMarks(): number {
  return calculateBoardExamScore(0, 1).totalMarks;
}

/** Classify a percentage into its CBSE grade band via the sole oracle. */
function gradeForPct(pct: number, totalMarks: number): string {
  return calculateBoardExamScore(pct, 100, totalMarks).grade;
}

/**
 * The D→C1 pass boundary, DERIVED from the CBSE band oracle (never a literal
 * 50). The smallest integer percentage the bands classify as NOT grade 'D'.
 * 0..100 are percentage-domain bounds, not tuning thresholds.
 */
function passBoundaryPct(totalMarks: number): number {
  for (let p = 0; p <= 100; p++) {
    if (gradeForPct(p, totalMarks) !== 'D') return p;
  }
  return 100;
}

/**
 * Synthesize a [low, high] band around a mid estimate using ONLY the confidence
 * the predictor already produced. Half-width scales with uncertainty
 * (1 - confidence); no tuning constant is introduced.
 *   low  = mid - (1-confidence)*mid          = mid * confidence
 *   high = mid + (1-confidence)*(total-mid)
 */
function bandFromConfidence(
  midMarks: number,
  totalMarks: number,
  confidence: number,
): { lowMarks: number; midMarks: number; highMarks: number } {
  const c = clamp01(confidence);
  const u = 1 - c;
  const lowMarks = clampMarks(midMarks * c, totalMarks);
  const highMarks = clampMarks(midMarks + u * (totalMarks - midMarks), totalMarks);
  return { lowMarks, midMarks: clampMarks(midMarks, totalMarks), highMarks };
}

/** Assemble a fully-populated BoardScoreRange from marks endpoints. */
function buildRange(
  lowMarks: number,
  midMarks: number,
  highMarks: number,
  totalMarks: number,
): BoardScoreRange {
  const toPct = (m: number) => (totalMarks > 0 ? (m / totalMarks) * 100 : 0);
  const low = round1(toPct(lowMarks));
  const mid = round1(toPct(midMarks));
  const high = round1(toPct(highMarks));
  return {
    low,
    mid,
    high,
    lowMarks: round1(lowMarks),
    midMarks: round1(midMarks),
    highMarks: round1(highMarks),
    totalMarks,
    grade: gradeForPct(mid, totalMarks),
    gradeLow: gradeForPct(low, totalMarks),
    gradeHigh: gradeForPct(high, totalMarks),
    confidenceBand: [low, high],
  };
}

/** Pass likelihood over an interval, expressed via the CBSE D boundary only. */
function computePassLikelihood(
  range: BoardScoreRange | null,
  totalMarks: number,
  confidence: number,
): PassLikelihood {
  const boundary = passBoundaryPct(totalMarks);
  const basis = `CBSE D→C1 boundary at ${boundary}% (derived from grade bands)`;

  if (!range) {
    return { band: 'unknown', likelihood: null, confidence, basis };
  }

  const { low, mid, high } = range;
  let likelihood: number;
  if (high > low) {
    likelihood = clamp01((high - boundary) / (high - low));
  } else {
    likelihood = mid >= boundary ? 1 : 0;
  }

  let band: PassBand;
  if (range.gradeLow !== 'D') {
    band = 'likely'; // even the worst case clears the D band
  } else if (range.gradeHigh === 'D') {
    band = 'at_risk'; // even the best case is still D
  } else {
    band = 'borderline'; // interval straddles the boundary
  }

  return { band, likelihood: clamp01(likelihood), confidence, basis };
}

// ════════════════════════════════════════════════════════════════════════════
// WEAK CONCEPTS
// ════════════════════════════════════════════════════════════════════════════

function collectWeakConcepts(inputs: OutcomePredictionInputs): WeakConcept[] {
  const out: WeakConcept[] = [];
  const seen = new Set<string>();
  const push = (c: WeakConcept) => {
    const key = `${c.kind}:${c.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  // 1. Knowledge gaps (prerequisite chains) — highest signal.
  for (const g of inputs.memory?.knowledgeGaps ?? []) {
    push({
      label: g.target,
      kind: 'knowledge_gap',
      mastery: null,
      detail: g.description ?? `Weak prerequisite "${g.prerequisite}" for "${g.target}".`,
      detailHi: g.descriptionHi,
      source: 'memory',
    });
  }

  // 2. Weak topics below the platform at-risk line (0.4, reused).
  for (const t of inputs.memory?.weakTopics ?? []) {
    if (!(t.mastery < PULSE_THRESHOLDS.at_risk_mastery)) continue;
    push({
      label: t.title,
      kind: 'weak_topic',
      mastery: t.mastery,
      source: 'memory',
    });
  }

  // 3. cme_exam_readiness weakest chapters.
  for (const w of inputs.cmeExamReadiness?.weakestChapters ?? []) {
    push({
      label: w.title ?? `Chapter ${w.chapter}`,
      kind: 'weak_chapter',
      mastery: typeof w.mastery === 'number' ? w.mastery : null,
      source: 'cme_exam_readiness',
    });
  }

  // 4. board_score_predictions recovery-plan chapters.
  for (const r of inputs.boardScorePrediction?.recoveryPlan ?? []) {
    push({
      label: `Chapter ${r.chapter}`,
      kind: 'weak_chapter',
      mastery: null,
      detail: r.action,
      detailHi: r.actionHi,
      source: 'board_score_predictions',
    });
  }

  // Weakest-first: known masteries ascending, unknown-mastery entries last.
  return out.sort((a, b) => {
    if (a.mastery == null && b.mastery == null) return 0;
    if (a.mastery == null) return 1;
    if (b.mastery == null) return -1;
    return a.mastery - b.mastery;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// AT-RISK + INTERVENTIONS
// ════════════════════════════════════════════════════════════════════════════

function anyAtRisk(signals: PulseSignals | null | undefined): boolean {
  if (!signals) return false;
  const inactive =
    signals.inactivity.verdict === 'at_risk' || signals.inactivity.verdict === 'broken';
  const cliff = signals.masteryCliff.verdict === 'flagged';
  const concentration = signals.atRiskConcentration.worstBand !== 'none';
  return inactive || cliff || concentration;
}

/**
 * Deterministic intervention list assembled from gaps + at-risk signals +
 * weakest chapters. NO LLM. Priority is a stable ordinal by category urgency.
 */
function buildInterventions(
  inputs: OutcomePredictionInputs,
  weakConcepts: WeakConcept[],
): InterventionRecommendation[] {
  const recs: InterventionRecommendation[] = [];

  // 1. Remediate weak prerequisites first (root-cause).
  for (const g of inputs.memory?.knowledgeGaps ?? []) {
    recs.push({
      kind: 'remediate_prerequisite',
      target: g.prerequisite,
      reason: `Strengthen prerequisite "${g.prerequisite}" before "${g.target}".`,
      reasonHi: g.descriptionHi,
      priority: recs.length,
    });
  }

  // 2. Review a detected mastery regression.
  const cliff = inputs.pulseSignals?.masteryCliff;
  if (cliff && cliff.verdict === 'flagged' && cliff.worstSubject) {
    const chap = cliff.worstChapter != null ? ` chapter ${cliff.worstChapter}` : '';
    recs.push({
      kind: 'review_regression',
      target: `${cliff.worstSubject}${chap}`,
      reason: `Recent drop detected in ${cliff.worstSubject}${chap}; revisit before it compounds.`,
      priority: recs.length,
    });
  }

  // 3. Revise the weakest chapters.
  for (const w of weakConcepts) {
    if (w.kind !== 'weak_chapter') continue;
    recs.push({
      kind: 'revise_chapter',
      target: w.label,
      reason: `Revise ${w.label} — currently a weak area for the exam.`,
      reasonHi: w.detailHi,
      priority: recs.length,
    });
  }

  // 4. Concentrate on a subject with clustered at-risk chapters.
  const conc = inputs.pulseSignals?.atRiskConcentration;
  if (conc && conc.worstBand !== 'none' && conc.bySubject.length > 0) {
    const worst = conc.bySubject[0];
    recs.push({
      kind: 'concentrate_subject',
      target: worst.subject,
      reason: `${worst.atRiskChapterCount} at-risk chapters in ${worst.subject} (${worst.band}); focus practice here.`,
      priority: recs.length,
    });
  }

  // 5. Resume daily practice when inactivity threatens the streak.
  const inact = inputs.pulseSignals?.inactivity;
  if (inact && (inact.verdict === 'at_risk' || inact.verdict === 'broken')) {
    recs.push({
      kind: 'resume_practice',
      target: inputs.subject,
      reason: 'Resume regular practice to keep progress on track.',
      priority: recs.length,
    });
  }

  return recs;
}

// ════════════════════════════════════════════════════════════════════════════
// RATIONALE
// ════════════════════════════════════════════════════════════════════════════

function buildRationale(
  inputs: OutcomePredictionInputs,
  source: PredictionSource,
  range: BoardScoreRange | null,
  weakConcepts: WeakConcept[],
): RationaleDriver[] {
  const drivers: RationaleDriver[] = [];

  drivers.push({
    code: 'source',
    detail: `Prediction source: ${source.replace(/_/g, ' ')}.`,
  });

  const prereqCount = (inputs.memory?.knowledgeGaps ?? []).length;
  if (prereqCount > 0) {
    drivers.push({
      code: 'weak_prerequisites',
      detail: `${prereqCount} weak prerequisite${prereqCount === 1 ? '' : 's'} detected in ${inputs.subject}.`,
    });
  }

  const weakCount = weakConcepts.length;
  if (weakCount > 0) {
    drivers.push({
      code: 'weak_concepts',
      detail: `${weakCount} weak concept${weakCount === 1 ? '' : 's'} feeding the projection.`,
    });
  }

  const board = inputs.boardScorePrediction;
  if (board) {
    const width = round1(Math.abs(board.confidenceBandHigh - board.confidenceBandLow));
    drivers.push({
      code: 'board_coverage',
      detail: `Board coverage ${round1(board.coveragePct)}% → band ${width} pts wide.`,
    });
  }

  if (range) {
    drivers.push({
      code: 'projected_range',
      detail: `Projected ${range.low}%–${range.high}% (mid ${range.mid}%, grade ${range.grade}).`,
    });
  }

  const v = inputs.learningVelocity;
  if (typeof v === 'number' && Number.isFinite(v)) {
    drivers.push({
      code: 'learning_velocity',
      detail:
        v > 0
          ? `Improving ~${round1(v)} mastery pts/day.`
          : v < 0
            ? `Declining ~${round1(v)} mastery pts/day.`
            : 'No net mastery trend.',
    });
  }

  const sig = inputs.pulseSignals;
  if (sig) {
    if (sig.inactivity.verdict === 'at_risk' || sig.inactivity.verdict === 'broken') {
      drivers.push({
        code: 'inactivity',
        detail: `Inactivity: ${sig.inactivity.verdict} (${sig.inactivity.daysSinceActive ?? '?'} days).`,
      });
    }
    if (sig.masteryCliff.verdict === 'flagged') {
      drivers.push({
        code: 'mastery_cliff',
        detail: `Mastery cliff flagged${sig.masteryCliff.worstSubject ? ` in ${sig.masteryCliff.worstSubject}` : ''}.`,
      });
    }
    if (sig.atRiskConcentration.worstBand !== 'none') {
      drivers.push({
        code: 'at_risk_concentration',
        detail: `At-risk concentration: ${sig.atRiskConcentration.worstBand} (${sig.atRiskConcentration.totalAtRiskChapters} chapters).`,
      });
    }
  }

  return drivers;
}

// ════════════════════════════════════════════════════════════════════════════
// RANGE RESOLUTION (the fallback ladder)
// ════════════════════════════════════════════════════════════════════════════

interface ResolvedRange {
  source: PredictionSource;
  range: BoardScoreRange | null;
  /** Board-score sub-prediction confidence (0..1). */
  confidence: number;
}

function resolveRange(inputs: OutcomePredictionInputs, totalMarks: number): ResolvedRange {
  // ── Tier 1: precomputed board_score_predictions (explicit coverage band) ──
  const board = inputs.boardScorePrediction;
  if (board && Number.isFinite(board.predictedPct)) {
    const toMarks = (pct: number) => clampMarks((pct / 100) * totalMarks, totalMarks);
    const range = buildRange(
      toMarks(board.confidenceBandLow),
      toMarks(board.predictedPct),
      toMarks(board.confidenceBandHigh),
      totalMarks,
    );
    // Confidence = precomputed coverage passthrough (higher coverage → the row
    // already produced a tighter band). Not a new formula — a straight read.
    const confidence = clamp01(board.coveragePct / 100);
    return { source: 'board_score_predictions', range, confidence };
  }

  // ── Tier 2: pure predictExamScore over memory-derived chapters ──
  const chapters = inputs.chapters ?? [];
  if (chapters.length > 0) {
    const p = predictExamScore(chapters, totalMarks);
    const b = bandFromConfidence(p.predicted, totalMarks, p.confidence);
    const range = buildRange(b.lowMarks, b.midMarks, b.highMarks, totalMarks);
    return { source: 'pure_predict_exam_score', range, confidence: clamp01(p.confidence) };
  }

  // ── Tier 2': cme_exam_readiness point estimate (read verbatim) ──
  const cme = inputs.cmeExamReadiness;
  if (cme && Number.isFinite(cme.overallScore)) {
    const midMarks = Number.isFinite(cme.predictedMarks)
      ? clampMarks(cme.predictedMarks, totalMarks)
      : clampMarks((cme.overallScore / 100) * totalMarks, totalMarks);
    // Confidence mirrors predictExamScore's mastery-based confidence for a
    // single all-covering estimate: avgMastery with zero variance = mastery,
    // i.e. overall_score/100. No new formula.
    const confidence = clamp01(cme.overallScore / 100);
    const b = bandFromConfidence(midMarks, totalMarks, confidence);
    const range = buildRange(b.lowMarks, b.midMarks, b.highMarks, totalMarks);
    return { source: 'cme_exam_readiness', range, confidence };
  }

  // ── Tier 3: nothing to project ──
  return { source: 'insufficient_data', range: null, confidence: 0 };
}

// ════════════════════════════════════════════════════════════════════════════
// THE COMPOSER
// ════════════════════════════════════════════════════════════════════════════

/**
 * Compose the unified, typed OutcomePrediction from already-read signals.
 * PURE: no I/O, no DB, no clock, no throw. Deterministic for identical inputs.
 */
export function composeOutcomePrediction(inputs: OutcomePredictionInputs): OutcomePrediction {
  const totalMarks =
    typeof inputs.totalBoardMarks === 'number' && inputs.totalBoardMarks > 0
      ? inputs.totalBoardMarks
      : defaultBoardMarks();

  const { source, range, confidence } = resolveRange(inputs, totalMarks);
  const sufficientData = source !== 'insufficient_data';

  const passLikelihood = computePassLikelihood(range, totalMarks, confidence);
  const weakConcepts = collectWeakConcepts(inputs);
  const interventionRecommendations = buildInterventions(inputs, weakConcepts);
  const rationale = buildRationale(inputs, source, range, weakConcepts);

  return {
    subject: inputs.subject,
    grade: inputs.grade,
    source,
    sufficientData,
    passLikelihood,
    boardScoreRange: range,
    weakConcepts,
    atRiskSignals: {
      signals: inputs.pulseSignals ?? null,
      anyAtRisk: anyAtRisk(inputs.pulseSignals),
    },
    interventionRecommendations,
    confidence: {
      overall: confidence,
      perPrediction: {
        boardScore: confidence,
        passLikelihood: passLikelihood.confidence,
      },
    },
    rationale,
    learningVelocity: typeof inputs.learningVelocity === 'number' ? inputs.learningVelocity : null,
  };
}
