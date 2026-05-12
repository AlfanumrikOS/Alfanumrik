/**
 * supabase/functions/_shared/state-runtime/bkt.ts
 *
 * Deno-side copy of `src/lib/tutor/bkt.ts`. Stays in sync with the
 * Node-side copy by hand. The numeric parity between this and the SQL
 * public.bkt_update is the determinism contract for ADR-005 Path C v2 —
 * verified to 1e-9 in
 * src/__tests__/migrations/state-runtime/bkt-sql-parity.test.ts.
 *
 * (We don't load the Node copy at runtime because Supabase Edge Functions
 * run on Deno and cannot reach into the Next.js src/ tree.)
 */

export interface BKTParams {
  pInit: number
  pTransit: number
  pGuess: number
  pSlip: number
}

export const DEFAULT_BKT_PARAMS: BKTParams = {
  pInit: 0.30,
  pTransit: 0.10,
  pGuess: 0.20,
  pSlip: 0.10,
}

const EPSILON = 1e-6

export function updateMasteryBKT(
  prior: number,
  correct: boolean,
  params: BKTParams = DEFAULT_BKT_PARAMS,
): number {
  const { pTransit, pGuess, pSlip } = params
  const p = Math.max(EPSILON, Math.min(1 - EPSILON, prior))

  let postObs: number
  if (correct) {
    postObs = (p * (1 - pSlip)) / ((p * (1 - pSlip)) + ((1 - p) * pGuess))
  } else {
    postObs = (p * pSlip) / ((p * pSlip) + ((1 - p) * (1 - pGuess)))
  }

  const result = postObs + (1 - postObs) * pTransit
  return Math.max(EPSILON, Math.min(1 - EPSILON, result))
}
