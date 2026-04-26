// src/lib/irt/fisher-info.ts
// 2-parameter logistic IRT primitives — pure functions, zero dependencies.
//
// These are the TypeScript twins of the SQL Fisher-info computation in
// the select_questions_by_irt_info RPC. Keeping a TS implementation lets
// us:
//   1. unit-test the math (the SQL version is harder to assert against)
//   2. compute Fisher info on the client when we render a per-item
//      "selection signal" badge in the super-admin diagnostics page
//   3. verify the SQL implementation against the TS one when a reference
//      test calls both with the same (theta, a, b) inputs.

/**
 * 2PL probability of a correct response: P(y=1 | theta, a, b)
 * P = sigmoid(a * (theta - b))
 *
 * Bounds: returns a value in (0, 1). For numerical stability the
 * caller is responsible for any clipping needed downstream.
 */
export function irt2plProb(theta: number, a: number, b: number): number {
  const z = a * (theta - b);
  return 1 / (1 + Math.exp(-z));
}

/**
 * 2PL Fisher information at a given theta:
 *   I(theta) = a^2 * P * (1 - P)
 *
 * Higher values = item is more discriminating at this ability level.
 * Picked items where Fisher info is maximised at the student's theta
 * make the most efficient adaptive test (Lord 1980, ch. 9).
 *
 * Clips P away from 0/1 by 0.001 so floor/ceiling items don't collapse
 * to zero info — matches the SQL implementation's GREATEST/LEAST clip.
 */
export function irt2plFisherInfo(theta: number, a: number, b: number): number {
  const pRaw = irt2plProb(theta, a, b);
  const p = Math.max(Math.min(pRaw, 0.999), 0.001);
  return a * a * p * (1 - p);
}

/**
 * Combined selection score matching the SQL RPC's logic.
 * Used in tests to verify SQL ↔ TS parity.
 *
 * - When (a, b) are calibrated (n >= 30, both non-null):
 *     score = Fisher info + 0.5 (calibrated-item bonus)
 * - When only irt_difficulty (proxy) is available:
 *     score = 1 / (1 + |theta - difficulty|)
 * - Otherwise:
 *     score = 0.1 (last-resort floor)
 */
export interface IrtItemParams {
  irt_a: number | null;
  irt_b: number | null;
  irt_calibration_n: number;
  irt_difficulty: number | null;
}

export type SelectionPath = 'fisher_info' | 'proxy_distance' | 'uncalibrated';

export interface SelectionScore {
  score: number;
  path: SelectionPath;
}

export function computeSelectionScore(
  theta: number,
  item: IrtItemParams,
): SelectionScore {
  if (item.irt_calibration_n >= 30 && item.irt_a != null && item.irt_b != null) {
    return {
      score: irt2plFisherInfo(theta, item.irt_a, item.irt_b) + 0.5,
      path: 'fisher_info',
    };
  }
  if (item.irt_difficulty != null) {
    return {
      score: 1 / (1 + Math.abs(theta - item.irt_difficulty)),
      path: 'proxy_distance',
    };
  }
  return { score: 0.1, path: 'uncalibrated' };
}
