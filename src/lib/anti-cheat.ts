/**
 * ALFANUMRIK — Anti-Cheat Pure Functions
 *
 * Extracted production invariant P3 (Anti-Cheat).
 * Three checks, enforced client-side and server-side:
 * 1. Minimum 3s average per question
 * 2. Not all same answer index if >3 questions
 * 3. Response count equals question count
 *
 * DO NOT duplicate this logic anywhere. Import from here.
 */

/** Check 1: Minimum 3s average per question */
export function checkMinimumTime(totalSeconds: number, questionCount: number): boolean {
  if (questionCount <= 0) return false;
  return (totalSeconds / questionCount) >= 3;
}

/** Check 2: Not all same answer index if >3 questions */
export function checkNotAllSameAnswer(responses: Array<{ selected_option: number }>): boolean {
  if (responses.length <= 3) return true; // Small quizzes exempt
  const counts = [0, 0, 0, 0];
  responses.forEach(r => {
    if (r.selected_option >= 0 && r.selected_option < 4) counts[r.selected_option]++;
  });
  return Math.max(...counts) < responses.length;
}

/** Check 3: Response count equals question count */
export function checkResponseCount(responseCount: number, questionCount: number): boolean {
  return responseCount === questionCount;
}

/** Combined anti-cheat validation */
export function validateAntiCheat(
  totalSeconds: number,
  responses: Array<{ selected_option: number }>,
  questionCount: number
): { valid: boolean; reason?: string } {
  if (!checkMinimumTime(totalSeconds, questionCount)) {
    return { valid: false, reason: 'speed_hack' };
  }
  if (!checkNotAllSameAnswer(responses)) {
    return { valid: false, reason: 'same_answer_pattern' };
  }
  if (!checkResponseCount(responses.length, questionCount)) {
    return { valid: false, reason: 'count_mismatch' };
  }
  return { valid: true };
}
