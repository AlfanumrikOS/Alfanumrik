// eval/irt/harness/metrics.ts
//
// Phase 3 E2 — IRT shadow-eval harness: PURE metric computation.
// No I/O, no DB, no network, no Date, no randomness. Offline tooling only —
// NEVER imported by production / client code.
//
// Two metric families:
//   1. Shadow-divergence aggregation — median Spearman rho + median top-K
//      overlap across the irt_shadow_divergence telemetry samples emitted by
//      the live selector (packages/lib/src/irt/shadow-metrics.ts produces the
//      per-sample values; this module only aggregates).
//   2. Predictive-fit comparison — for calibrated responses (items with 2PL
//      irt_a/irt_b at calibration_n >= 30), compare how well the calibrated
//      2PL model predicts correctness vs the legacy proxy model:
//        2PL:   P = irt2plProb(theta, a, b)   = sigmoid(a * (theta - b))
//        proxy: P = sigmoid(theta - irt_difficulty) = irt2plProb(theta, 1, d)
//      via AUC (discrimination) and Brier score (calibration). Both models are
//      evaluated on the IDENTICAL response set so the deltas are paired.

import { irt2plProb } from '../../../packages/lib/src/irt/fisher-info';

// ─── Input shapes ─────────────────────────────────────────────────────────────

/** One irt_shadow_divergence telemetry sample (system_metrics tags). */
export interface ShadowSampleRow {
  spearmanRho: number | null;
  top5Overlap: number | null;
  top10Overlap: number | null;
  nCandidates: number;
  nCalibrated: number;
}

/** One calibrated response joined to its item params + the student's theta. */
export interface CalibratedResponseRow {
  /** Distinct-student counting only — never emitted into the report. */
  studentId: string;
  correct: boolean;
  /** Student ability (student_learning_profiles.irt_theta for the subject). */
  theta: number;
  /** Calibrated 2PL discrimination (question_bank.irt_a). */
  irtA: number;
  /** Calibrated 2PL difficulty (question_bank.irt_b). */
  irtB: number;
  /** Legacy proxy difficulty (question_bank.irt_difficulty). */
  irtDifficulty: number;
}

// ─── Output shapes ────────────────────────────────────────────────────────────

export interface ShadowSummary {
  nSamples: number;
  medianSpearman: number | null;
  medianTop5Overlap: number | null;
  medianTop10Overlap: number | null;
  totalCandidatesScored: number;
  totalCalibratedScored: number;
}

export interface ModelComparison {
  /** Responses in the paired evaluation set (finite theta/a/b/difficulty). */
  n: number;
  /** Distinct students in the evaluation set. */
  nStudents: number;
  auc2pl: number | null;
  aucProxy: number | null;
  /** auc2pl - aucProxy. Positive = 2PL discriminates better. */
  deltaAUC: number | null;
  brier2pl: number | null;
  brierProxy: number | null;
  /** brier2pl - brierProxy. NEGATIVE = 2PL is better calibrated (lower loss). */
  deltaBrier: number | null;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Median of the finite values in a list. null when none. */
export function median(values: Array<number | null | undefined>): number | null {
  const xs = values.filter(isFiniteNumber).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * ROC AUC via the rank-based Mann-Whitney statistic with average-rank tie
 * handling. Returns null when either class is empty (AUC undefined).
 */
export function auc(pairs: Array<{ label: boolean; p: number }>): number | null {
  const valid = pairs.filter((x) => isFiniteNumber(x.p));
  const nPos = valid.filter((x) => x.label).length;
  const nNeg = valid.length - nPos;
  if (nPos === 0 || nNeg === 0) return null;

  // Average ranks over p (rank 1 = smallest).
  const order = valid.map((x, i) => ({ ...x, i })).sort((a, b) => a.p - b.p);
  const ranks = new Array<number>(valid.length);
  let pos = 0;
  while (pos < order.length) {
    let end = pos;
    while (end + 1 < order.length && order[end + 1].p === order[pos].p) end++;
    const avg = (pos + 1 + (end + 1)) / 2;
    for (let k = pos; k <= end; k++) ranks[order[k].i] = avg;
    pos = end + 1;
  }

  let rankSumPos = 0;
  valid.forEach((x, i) => {
    if (x.label) rankSumPos += ranks[i];
  });
  const u = rankSumPos - (nPos * (nPos + 1)) / 2;
  return u / (nPos * nNeg);
}

/** Mean squared error between predicted P and the 0/1 outcome. null on empty. */
export function brier(pairs: Array<{ label: boolean; p: number }>): number | null {
  const valid = pairs.filter((x) => isFiniteNumber(x.p));
  if (valid.length === 0) return null;
  const sum = valid.reduce((s, x) => s + (x.p - (x.label ? 1 : 0)) ** 2, 0);
  return sum / valid.length;
}

// ─── Metric family 1: shadow-divergence aggregation ──────────────────────────

export function summariseShadowSamples(rows: ShadowSampleRow[]): ShadowSummary {
  return {
    nSamples: rows.length,
    medianSpearman: median(rows.map((r) => r.spearmanRho)),
    medianTop5Overlap: median(rows.map((r) => r.top5Overlap)),
    medianTop10Overlap: median(rows.map((r) => r.top10Overlap)),
    totalCandidatesScored: rows.reduce(
      (s, r) => s + (isFiniteNumber(r.nCandidates) ? r.nCandidates : 0),
      0,
    ),
    totalCalibratedScored: rows.reduce(
      (s, r) => s + (isFiniteNumber(r.nCalibrated) ? r.nCalibrated : 0),
      0,
    ),
  };
}

// ─── Metric family 2: 2PL vs proxy predictive fit ─────────────────────────────

/**
 * Paired comparison of the calibrated 2PL model vs the legacy proxy model on
 * the same responses. Rows missing any required finite field are dropped
 * BEFORE either model is scored, so both models see the identical set.
 */
export function compareModels(rows: CalibratedResponseRow[]): ModelComparison {
  const usable = rows.filter(
    (r) =>
      r &&
      typeof r.correct === 'boolean' &&
      isFiniteNumber(r.theta) &&
      isFiniteNumber(r.irtA) &&
      isFiniteNumber(r.irtB) &&
      isFiniteNumber(r.irtDifficulty),
  );

  const pairs2pl = usable.map((r) => ({
    label: r.correct,
    p: irt2plProb(r.theta, r.irtA, r.irtB),
  }));
  // Proxy: Rasch on the legacy irt_difficulty scale = 2PL with a = 1.
  const pairsProxy = usable.map((r) => ({
    label: r.correct,
    p: irt2plProb(r.theta, 1, r.irtDifficulty),
  }));

  const auc2pl = auc(pairs2pl);
  const aucProxy = auc(pairsProxy);
  const brier2pl = brier(pairs2pl);
  const brierProxy = brier(pairsProxy);

  return {
    n: usable.length,
    nStudents: new Set(usable.map((r) => r.studentId)).size,
    auc2pl,
    aucProxy,
    deltaAUC: auc2pl !== null && aucProxy !== null ? auc2pl - aucProxy : null,
    brier2pl,
    brierProxy,
    deltaBrier: brier2pl !== null && brierProxy !== null ? brier2pl - brierProxy : null,
  };
}
