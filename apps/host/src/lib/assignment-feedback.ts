/**
 * P7 (Phase 3 item 3.10) — language-aware pick for teacher feedback on an
 * assignment submission.
 *
 * `assignment_submissions` carries two feedback columns: `teacher_feedback`
 * (English, always present when a teacher leaves feedback) and the additive
 * `teacher_feedback_hi` (optional Hindi variant). The student assignments page
 * renders a single feedback line, so it must choose which to show:
 *
 *  - Hindi-preferring student WITH a Hindi variant  → Hindi.
 *  - Hindi-preferring student WITHOUT a Hindi variant → English fallback
 *    (a teacher may fill only English; never show a blank box).
 *  - English-preferring student → always English.
 *
 * Returns null only when there is genuinely no feedback in either language,
 * in which case the caller renders nothing.
 *
 * Kept in a standalone module (not exported from the page) because Next.js
 * App Router route files may only export the reserved page/route symbols.
 */
export function pickTeacherFeedback(
  isHi: boolean,
  en: string | null | undefined,
  hi: string | null | undefined,
): string | null {
  const enTrim = en?.trim();
  const hiTrim = hi?.trim();
  if (isHi && hiTrim) return hi as string;
  if (enTrim) return en as string;
  // Last-resort: a Hindi variant exists but English is blank — still show it
  // rather than nothing (shouldn't normally happen, but never hide feedback).
  if (hiTrim) return hi as string;
  return null;
}
