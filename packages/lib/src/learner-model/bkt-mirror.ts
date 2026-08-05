/**
 * Learner-model facade — canonical TS BKT mirror.
 *
 * ⚠ MIRROR of `update_learner_state_post_quiz` (SQL RPC, migration
 * 20260623000100) — DISPLAY/PREVIEW ONLY, never writes concept_mastery (E6).
 * Analyzer check 6 allowlists exactly this file.
 *
 * The SQL is the ONLY writer of mastery (product design E1/E6: mastery is
 * written solely by the atomic submit chain; the LLM/AI paths and every UI
 * surface read it through this facade). This mirror exists so display /
 * preview / what-if surfaces can show the SAME posterior the SQL will
 * compute, without a round-trip — it must never be used to persist state.
 *
 * Verified against the deployed SQL body (20260623000100) on 2026-08-05:
 *
 *   p_p_learn FLOAT DEFAULT 0.2
 *   p_p_slip  FLOAT DEFAULT 0.1
 *   p_p_guess FLOAT DEFAULT 0.25
 *   prior init: COALESCE(cm.mastery_probability, 0.1)   -- new row → 0.1
 *
 *   correct:  pE = prior·(1−slip) + (1−prior)·guess
 *             pK = prior·(1−slip) / pE
 *   wrong:    pE = prior·slip + (1−prior)·(1−guess)
 *             pK = prior·slip / pE
 *   posterior = clamp01( pK + (1−pK)·learn )            -- LEAST/GREATEST
 *
 * The lockstep of these literals with the SQL is pinned by
 * `packages/lib/src/__tests__/learner-model/thresholds-lockstep.test.ts`;
 * hand-computed posterior parity fixtures live in
 * `packages/lib/src/__tests__/learner-model/bkt-mirror.test.ts`.
 */

export interface BktParams {
  /** P(T): probability of learning on this opportunity. */
  pLearn: number;
  /** P(S): probability of slipping (wrong despite knowing). */
  pSlip: number;
  /** P(G): probability of guessing right without knowing. */
  pGuess: number;
  /** P(L0): prior for a brand-new (student, topic) row. */
  priorInit: number;
}

/**
 * Canonical BKT parameters — byte-for-byte the SQL RPC's defaults
 * (SQL WINS; if the RPC ever changes, change these AND the lockstep test).
 */
export const BKT_PARAMS: Readonly<BktParams> = Object.freeze({
  pLearn: 0.2,
  pSlip: 0.1,
  pGuess: 0.25,
  priorInit: 0.1,
});

/**
 * Pure BKT posterior — the exact math of update_learner_state_post_quiz.
 *
 * @param prior   current mastery_probability (use BKT_PARAMS.priorInit for a
 *                topic with no row yet)
 * @param correct whether the attempt was correct
 * @param p       BKT parameters (defaults = the SQL defaults)
 * @returns the new mastery_probability the SQL would write, clamped to [0,1]
 */
export function bktPosterior(
  prior: number,
  correct: boolean,
  p: BktParams = BKT_PARAMS,
): number {
  let pEvidence: number;
  let pKnow: number;
  if (correct) {
    pEvidence = prior * (1.0 - p.pSlip) + (1.0 - prior) * p.pGuess;
    pKnow = (prior * (1.0 - p.pSlip)) / pEvidence;
  } else {
    pEvidence = prior * p.pSlip + (1.0 - prior) * (1.0 - p.pGuess);
    pKnow = (prior * p.pSlip) / pEvidence;
  }
  return Math.min(1.0, Math.max(0.0, pKnow + (1.0 - pKnow) * p.pLearn));
}

/**
 * Convenience: fold a correct/wrong sequence from a prior (defaults to the
 * SQL's new-row prior 0.1). PREVIEW ONLY — see the module header (E6).
 */
export function bktPosteriorSequence(
  outcomes: readonly boolean[],
  prior: number = BKT_PARAMS.priorInit,
  p: BktParams = BKT_PARAMS,
): number {
  let m = prior;
  for (const correct of outcomes) m = bktPosterior(m, correct, p);
  return m;
}
