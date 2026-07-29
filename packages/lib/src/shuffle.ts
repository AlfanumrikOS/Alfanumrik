/**
 * ALFANUMRIK — Canonical array shuffle.
 *
 * ONE correct shuffle for the whole monorepo. Import this; never hand-roll.
 *
 * WHY THIS EXISTS
 * ---------------
 * `arr.sort(() => Math.random() - 0.5)` is NOT a shuffle. The comparator is
 * non-transitive (it can claim a<b, b<c AND c<a in the same sort), which makes
 * the result implementation-defined and heavily biased toward the input order:
 * V8's TimSort leaves short runs largely untouched. Every call site in this repo
 * then does `.slice(0, count)`, so the bias decides WHICH questions a student
 * actually sees — the first N rows the database returned win far more often than
 * chance. That is a quiz-integrity defect, not a cosmetic one.
 *
 * This is a Fisher-Yates (Knuth) shuffle: every permutation is equally likely,
 * O(n), and it returns a NEW array — callers rely on their input not being
 * clobbered (the biased `.sort()` they replaced mutated in place).
 *
 * SEEDABILITY
 * -----------
 * `rng` is injectable so tests can assert distribution deterministically without
 * stubbing globals. It defaults to `Math.random`, so production behaviour is
 * unchanged by its presence. Pass any function returning a float in [0, 1).
 *
 * NOT FOR CRYPTOGRAPHY. `Math.random` is not a CSPRNG. Question ordering does
 * not need one; if a future caller does, pass a crypto-backed `rng`.
 */

/** A source of uniform randomness in the half-open interval [0, 1). */
export type RandomFn = () => number;

/**
 * Fisher-Yates shuffle. Returns a new array; the input is never mutated.
 *
 * @param arr  Items to shuffle (read-only — a copy is made).
 * @param rng  Optional randomness source, defaults to `Math.random`.
 */
export function shuffle<T>(arr: readonly T[], rng: RandomFn = Math.random): T[] {
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
