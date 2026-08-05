/**
 * Client-side deterministic validator for AI-drafted assignment questions
 * (K5). This is a UX hint — it lets the teacher see obvious defects (missing
 * text, duplicate/empty options, invalid correct index) before hitting
 * `publish_draft_assignment`. The EF is authoritative and re-validates every
 * question on publish; the client is NEVER the gate (P6).
 */

export interface DraftQuestion {
  id: string;
  question_text: string;
  options: string[];
  correct_answer_index: number;
  bloom_level?: string;
  difficulty?: string;
}

/** Returns null when valid; otherwise a bilingual-ish English-first hint. */
export function validateDraftQuestion(q: DraftQuestion): string | null {
  if (!q.question_text || q.question_text.trim().length === 0) {
    return 'Question text is empty.';
  }
  if (q.question_text.includes('{{') || q.question_text.includes('[BLANK]')) {
    return 'Question text has an unfilled placeholder.';
  }
  if (!Array.isArray(q.options) || q.options.length !== 4) {
    return 'Must have exactly 4 options.';
  }
  const trimmed = q.options.map((o) => (o ?? '').trim());
  if (trimmed.some((o) => o.length === 0)) {
    return 'One or more options are empty.';
  }
  if (new Set(trimmed).size !== 4) {
    return 'Options must be distinct.';
  }
  if (
    !Number.isInteger(q.correct_answer_index) ||
    q.correct_answer_index < 0 ||
    q.correct_answer_index > 3
  ) {
    return 'Correct-answer index must be 0, 1, 2, or 3.';
  }
  return null;
}
