/**
 * Bayesian Knowledge Tracing (BKT) — Corbett & Anderson 1995.
 *
 * Given a prior P(L_t) that the student knows the concept and an
 * observation (correct/wrong), returns the posterior P(L_{t+1}).
 *
 * Parameters mirror the ones used by the SQL `public.bkt_update` plpgsql
 * function — both implementations are verified equal to 1e-9 in
 * src/__tests__/migrations/bkt-sql-parity.integration.test.ts (skipped
 * unless RUN_INTEGRATION_TESTS=1 with real Supabase env).
 *
 * Why parameters are global (not per-concept) in Phase 2: per-concept
 * calibration is Phase 2.1. Until we have enough interaction data, the
 * literature consensus (pInit=0.30, pTransit=0.10, pGuess=0.20,
 * pSlip=0.10) is what we use.
 */

export interface BKTParams {
  pInit: number;
  pTransit: number;
  pGuess: number;
  pSlip: number;
}

export const DEFAULT_BKT_PARAMS: BKTParams = {
  pInit: 0.30,
  pTransit: 0.10,
  pGuess: 0.20,
  pSlip: 0.10,
};

const EPSILON = 1e-6;

export function updateMasteryBKT(
  prior: number,
  correct: boolean,
  params: BKTParams = DEFAULT_BKT_PARAMS,
): number {
  const { pTransit, pGuess, pSlip } = params;
  const p = Math.max(EPSILON, Math.min(1 - EPSILON, prior));

  let postObs: number;
  if (correct) {
    postObs = (p * (1 - pSlip)) / ((p * (1 - pSlip)) + ((1 - p) * pGuess));
  } else {
    postObs = (p * pSlip) / ((p * pSlip) + ((1 - p) * (1 - pGuess)));
  }

  const result = postObs + (1 - postObs) * pTransit;
  return Math.max(EPSILON, Math.min(1 - EPSILON, result));
}
