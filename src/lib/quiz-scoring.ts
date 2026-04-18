/**
 * Quiz scoring helpers — pure functions shared between the client quiz page
 * and the server-side `submit_quiz_results` RPC regression tests.
 *
 * Context: MCQ options are shuffled for display (see `buildShuffleMaps` in
 * `src/app/quiz/page.tsx`). The student's `selected_option` is the SHUFFLED
 * display index they clicked. The canonical `correct_answer_index` stored on
 * `question_bank` is the ORIGINAL pre-shuffle index. Comparing the two
 * coordinate spaces directly silently miscounted ~75% of shuffled quizzes.
 *
 * `resolveOriginalIndex` is the one-liner that crosses the two spaces. The
 * `submit_quiz_results` RPC (see migration 20260418110000) mirrors this
 * algorithm in PL/pgSQL — keep the two implementations in sync.
 *
 * Product invariants:
 *   - P1 (score accuracy): is_correct = (resolveOriginalIndex(selected, map) === correctIdx)
 *   - P3 (anti-cheat): server remains authoritative for answer correctness
 *
 * Related tests:
 *   - src/__tests__/quiz-shuffle-scoring-fix.test.ts        (client-side 384 permutations)
 *   - src/__tests__/quiz-server-shuffle-integration.test.ts (server-side algorithm parity)
 */

/**
 * Given the SHUFFLED display index the student clicked and the shuffle map
 * used to render those options, return the ORIGINAL (pre-shuffle) index to
 * compare against `question_bank.correct_answer_index`.
 *
 * Tolerant of all the shapes a real payload can arrive in:
 *   - `shuffleMap === null | undefined` → no shuffle; return `selected` as-is
 *   - `shuffleMap` not an array of length 4 → malformed; fall back to `selected`
 *   - `selected` outside 0..3 → out of range; return `selected` as-is (server
 *     scoring treats it as wrong via the downstream equality check)
 *
 * The function MUST NEVER throw — called on every quiz response row.
 */
export function resolveOriginalIndex(
  selected: number | null | undefined,
  shuffleMap: number[] | null | undefined,
): number {
  // Malformed / absent selected → pass through; caller handles the equality.
  if (selected === null || selected === undefined || Number.isNaN(selected)) {
    return selected as number;
  }

  // No shuffle map → selected is already in original space (mobile, diagnostic,
  // mock-exam, pyq, learn surfaces, and the legacy pre-shuffle write path).
  if (!shuffleMap) return selected;

  // Malformed shuffle map → fall back to treating selected as original-space.
  // (Same behaviour as the RPC's safety check.)
  if (!Array.isArray(shuffleMap) || shuffleMap.length !== 4) return selected;

  // Out-of-range selected index → return as-is so equality is false downstream.
  if (selected < 0 || selected > 3) return selected;

  // Every entry must be a valid 0..3 integer — otherwise fall back.
  for (let i = 0; i < 4; i++) {
    const v = shuffleMap[i];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 3) {
      return selected;
    }
  }

  return shuffleMap[selected];
}

/**
 * Compute `is_correct` given the student's shuffled pick, the shuffle map, and
 * the original correct index stored on the question. Mirrors the PL/pgSQL in
 * `submit_quiz_results`.
 */
export function scoreAnswer(
  selected: number | null | undefined,
  shuffleMap: number[] | null | undefined,
  originalCorrectIdx: number | null | undefined,
): boolean {
  if (originalCorrectIdx === null || originalCorrectIdx === undefined) return false;
  if (selected === null || selected === undefined) return false;
  return resolveOriginalIndex(selected, shuffleMap) === originalCorrectIdx;
}
