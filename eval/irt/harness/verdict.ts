// eval/irt/harness/verdict.ts
//
// Phase 3 E2 — IRT shadow-eval harness: PURE verdict / gate logic.
// No I/O, no DB, no network, no Date, no randomness. Offline tooling only.
//
// This is the evidence gate for ramping ff_irt_question_selection (IRT-scored
// live serving). Three-state, mirroring the eval/rag verdict philosophy: you
// cannot gate a serving-behaviour decision on a measurement you do not trust.
//
//   PASS          — volume gates met AND the calibrated 2PL model beats the
//                   proxy on BOTH paired predictive-fit metrics:
//                     deltaAUC   >= +0.03   (2PL discriminates >= 3pp better)
//                     deltaBrier <= -0.005  (2PL calibration loss lower by
//                                            >= 0.005)
//   INCONCLUSIVE  — volume gates not met, or any required metric is
//                   null/unmeasurable. Never PASS/FAIL on thin or broken data.
//   FAIL          — volume gates met, metrics measurable, but the 2PL deltas
//                   do not clear the thresholds. Do NOT ramp.
//
// Shadow-divergence metrics (median Spearman rho, median top-K overlap) are
// INFORMATIONAL ONLY — they describe how DIFFERENT IRT serving would be, not
// whether it would be BETTER, so they never gate.

import type { ModelComparison, ShadowSummary } from './metrics';

// ─── Gate constants (assessment-reviewed; change requires review) ────────────

/** Minimum calibrated responses in the evaluation window. */
export const MIN_CALIBRATED_RESPONSES = 500;
/** Minimum distinct students contributing those responses. */
export const MIN_STUDENTS = 50;
/** 2PL must beat the proxy AUC by at least this much. */
export const MIN_DELTA_AUC = 0.03;
/** 2PL Brier must be lower (better) than proxy by at least this much. */
export const MAX_DELTA_BRIER = -0.005;

export type IrtVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface IrtVerdictResult {
  verdict: IrtVerdict;
  reasons: string[];
  /** Echo of the gates applied, for the report artifact. */
  gates: {
    minCalibratedResponses: number;
    minStudents: number;
    minDeltaAUC: number;
    maxDeltaBrier: number;
  };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Evaluate the ramp-evidence verdict.
 *
 * Precedence:
 *   1. INCONCLUSIVE — volume gates unmet OR deltaAUC/deltaBrier unmeasurable.
 *   2. FAIL         — measurable but thresholds not cleared.
 *   3. PASS         — both thresholds cleared on sufficient volume.
 */
export function evaluateIrtVerdict(
  model: ModelComparison,
  shadow: ShadowSummary | null,
): IrtVerdictResult {
  const reasons: string[] = [];
  const gates = {
    minCalibratedResponses: MIN_CALIBRATED_RESPONSES,
    minStudents: MIN_STUDENTS,
    minDeltaAUC: MIN_DELTA_AUC,
    maxDeltaBrier: MAX_DELTA_BRIER,
  };

  let inconclusive = false;

  if (model.n < MIN_CALIBRATED_RESPONSES) {
    inconclusive = true;
    reasons.push(
      `INCONCLUSIVE: only ${model.n} calibrated responses in window ` +
        `(need >= ${MIN_CALIBRATED_RESPONSES}).`,
    );
  }
  if (model.nStudents < MIN_STUDENTS) {
    inconclusive = true;
    reasons.push(
      `INCONCLUSIVE: only ${model.nStudents} distinct students ` +
        `(need >= ${MIN_STUDENTS}).`,
    );
  }
  if (!isFiniteNumber(model.deltaAUC)) {
    inconclusive = true;
    reasons.push('INCONCLUSIVE: deltaAUC is unmeasurable (a class or model side is empty).');
  }
  if (!isFiniteNumber(model.deltaBrier)) {
    inconclusive = true;
    reasons.push('INCONCLUSIVE: deltaBrier is unmeasurable.');
  }

  // Informational shadow-divergence notes (never gate).
  if (shadow) {
    if (shadow.nSamples === 0) {
      reasons.push(
        'NOTE (informational): no irt_shadow_divergence telemetry samples in window — ' +
          'ff_irt_shadow_v1 may be OFF or freshly ramped.',
      );
    } else {
      reasons.push(
        `NOTE (informational): shadow divergence over ${shadow.nSamples} samples — ` +
          `median rho=${fmtOrNa(shadow.medianSpearman)}, ` +
          `median top5=${fmtOrNa(shadow.medianTop5Overlap)}, ` +
          `median top10=${fmtOrNa(shadow.medianTop10Overlap)}. ` +
          'Divergence describes how DIFFERENT IRT serving would be; it does not gate.',
      );
    }
  }

  if (inconclusive) return { verdict: 'INCONCLUSIVE', reasons, gates };

  const deltaAUC = model.deltaAUC as number;
  const deltaBrier = model.deltaBrier as number;

  const aucOk = deltaAUC >= MIN_DELTA_AUC;
  const brierOk = deltaBrier <= MAX_DELTA_BRIER;

  if (aucOk && brierOk) {
    reasons.unshift(
      `PASS: deltaAUC=${fmt(deltaAUC)} (>= ${MIN_DELTA_AUC}) AND ` +
        `deltaBrier=${fmt(deltaBrier)} (<= ${MAX_DELTA_BRIER}) on ` +
        `${model.n} responses / ${model.nStudents} students.`,
    );
    return { verdict: 'PASS', reasons, gates };
  }

  if (!aucOk) {
    reasons.push(
      `FAIL: deltaAUC=${fmt(deltaAUC)} does not clear the +${MIN_DELTA_AUC} threshold.`,
    );
  }
  if (!brierOk) {
    reasons.push(
      `FAIL: deltaBrier=${fmt(deltaBrier)} does not clear the ${MAX_DELTA_BRIER} threshold.`,
    );
  }
  return { verdict: 'FAIL', reasons, gates };
}

function fmt(v: number): string {
  return Number(v.toPrecision(4)).toString();
}

function fmtOrNa(v: number | null): string {
  return v === null ? 'n/a' : fmt(v);
}
