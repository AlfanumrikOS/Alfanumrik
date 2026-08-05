// packages/lib/src/irt/estimate-theta.ts
//
// Phase 3 E2 — PURE TypeScript twin of the `update_irt_theta` SQL
// Newton-Raphson MLE (Rasch / 1PL ability estimation).
//
// SQL sources of truth (verified 2026-08-05):
//   - supabase/migrations/20260506000001_fix_irt_and_affective_race_conditions.sql
//   - supabase/migrations/00000000000000_baseline_from_prod.sql:8326
//     (`update_irt_theta`; the trigger wrapper `trg_fn_update_irt_theta` is at
//     baseline:8109)
//
// Verified SQL constants mirrored here EXACTLY:
//   - ICC:            P = 1 / (1 + exp(-(theta - b)))          (Rasch, a = 1)
//   - P clip:         GREATEST(0.0001, LEAST(0.9999, P))
//   - start theta:    0.0
//   - iterations:     5 max
//   - L'' guard:      |L''| < 1e-8 → stop
//   - theta clip:     GREATEST(-4.0, LEAST(4.0, theta)) each iteration
//   - convergence:    |theta - theta_prev| < 0.001 → stop
//   - min responses:  n < 2 → no estimate (SQL RETURNs without writing)
//   - SE:             1 / sqrt(Σ P_i(1-P_i))  (Fisher information at final theta)
//
// DELIBERATE DIVERGENCE from the SQL — SE bounds. The SQL writes
// student_learning_profiles.irt_theta_se and caps SE at 9.99 (an
// "unreliable estimate" sentinel). THIS estimator feeds
// student_skill_state.theta_se, whose schema contract is different
// (baseline:13996): cold-start default is 1.5 per Wainer (2000) / van der
// Linden (2010) because "tighter values commit early and starve
// item-information gain" — an SE ABOVE the cold-start prior would claim we
// know LESS after data than before any. So for skill-state writes:
//   - SE cap   = 1.5  (never exceed the cold-start prior)
//   - SE floor = 0.3  (never let a lucky short streak claim near-certainty;
//                      >= 5-response minimum per LO keeps n small, and an
//                      unclamped SE at n=5..20 can dip implausibly low)
// The theta math itself (clips, iterations, convergence) is byte-equivalent
// to the SQL.
//
// Pure function: no I/O, no Date, no randomness.
// Owning agent: ai-engineer. Assessment reviews mastery-threshold fit.

/** One graded response mapped to an item difficulty. */
export interface ThetaResponse {
  /** Item difficulty on the theta scale (question_bank.irt_b for calibrated
   *  items; the SQL twin uses irt_difficulty as its Rasch b). */
  b: number;
  /** Whether the student answered correctly. */
  correct: boolean;
}

export interface ThetaEstimate {
  /** MLE ability estimate, clipped to [-4, 4]. */
  theta: number;
  /** Standard error = 1/sqrt(Fisher info), clamped to [0.3, 1.5] (see header). */
  se: number;
  /** Number of responses used. */
  n: number;
  /** True when the Newton-Raphson step change fell below 1e-3 within 5 iters. */
  converged: boolean;
}

// ── SQL-mirrored constants (exported so tests pin them explicitly) ──────────
export const THETA_MIN = -4.0;
export const THETA_MAX = 4.0;
export const MAX_ITERATIONS = 5;
export const CONVERGENCE_DELTA = 0.001;
export const P_CLIP_LO = 0.0001;
export const P_CLIP_HI = 0.9999;
export const L_DOUBLE_GUARD = 1e-8;
export const MIN_RESPONSES = 2;

// ── skill-state SE bounds (deliberate divergence — see header) ──────────────
export const SE_FLOOR = 0.3;
export const SE_CAP = 1.5;

/** Rasch ICC with the SQL's P clip. */
function raschP(theta: number, b: number): number {
  const p = 1 / (1 + Math.exp(-(theta - b)));
  return Math.max(P_CLIP_LO, Math.min(P_CLIP_HI, p));
}

/**
 * Estimate ability theta from graded responses via Newton-Raphson MLE on the
 * Rasch model — the TS twin of the `update_irt_theta` SQL (see header for the
 * verified constants). Returns null when fewer than MIN_RESPONSES (2) valid
 * responses are supplied (the SQL RETURNs without writing in that case).
 *
 * Responses with a non-finite `b` are dropped before the count check —
 * mirroring the SQL's `qb.irt_difficulty IS NOT NULL` predicate.
 */
export function estimateTheta(responses: ThetaResponse[]): ThetaEstimate | null {
  const valid = (Array.isArray(responses) ? responses : []).filter(
    (r) => r && Number.isFinite(r.b) && typeof r.correct === 'boolean',
  );
  const n = valid.length;
  if (n < MIN_RESPONSES) return null;

  let theta = 0.0;
  let converged = false;

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    let lPrime = 0.0;
    let lDouble = 0.0;

    for (const r of valid) {
      const p = raschP(theta, r.b);
      const x = r.correct ? 1.0 : 0.0;
      lPrime += x - p;
      lDouble -= p * (1 - p); // always negative
    }

    if (Math.abs(lDouble) < L_DOUBLE_GUARD) break;

    const thetaPrev = theta;
    theta = theta - lPrime / lDouble;
    theta = Math.max(THETA_MIN, Math.min(THETA_MAX, theta));

    if (Math.abs(theta - thetaPrev) < CONVERGENCE_DELTA) {
      converged = true;
      break;
    }
  }

  // SE = 1/sqrt(Fisher information) at the final theta.
  let fisherInfo = 0.0;
  for (const r of valid) {
    const p = raschP(theta, r.b);
    fisherInfo += p * (1 - p);
  }

  const seRaw = fisherInfo > 0 ? 1 / Math.sqrt(fisherInfo) : SE_CAP;
  const se = Math.max(SE_FLOOR, Math.min(SE_CAP, seRaw));

  return { theta, se, n, converged };
}
