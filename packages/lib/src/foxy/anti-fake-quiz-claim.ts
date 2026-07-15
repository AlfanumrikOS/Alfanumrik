// packages/lib/src/foxy/anti-fake-quiz-claim.ts
//
// ANTI-FAKE QUIZ-CLAIM BACKSTOP (P6 "fake action" guard, P12 AI safety).
//
// THE BUG THIS EXISTS FOR
// -----------------------
// A Foxy quiz/practice turn could ship the student-facing sentence
// "Generated 5 quiz questions." while the actual validated questions lived in
// `metadata.questions` — which the legacy persist path drops. The student saw a
// CLAIM of a quiz with ZERO questions. That is a "fake action": Foxy asserting
// it did something it did not surface.
//
// WHAT THIS MODULE DOES
// ---------------------
// A pure, deterministic, flag-independent detector: given the student-facing
// text, decide whether it is a CLAIM-ONLY quiz meta-claim — a "generated /
// created / here are N questions"-style sentence that is NOT accompanied by any
// real question content (no MCQ option markers, no multiple inline questions).
// When it is claim-only, the caller replaces the whole turn with a graceful
// bilingual fallback (P7) so a claim-with-no-questions can NEVER reach a student.
//
// It NEVER strips a turn that carries real rendered questions (option markers /
// multiple question marks) — those pass through untouched — so genuine quiz
// content and normal teaching answers are unaffected.
//
// Owner: ai-engineer. Reviewed by: assessment (age-appropriateness / scope of
// the fallback copy), testing (REG coverage for the flag-OFF / legacy path).

/**
 * Graceful bilingual (P7) fallback shown IN PLACE OF a claim-only quiz turn.
 * English first, then Hindi (Devanagari). No claim of any produced questions.
 * Invites the student to retry or name the chapter they want to practise.
 */
export const QUIZ_CLAIM_FALLBACK_TEXT =
  "I couldn't put together the full set of practice questions just now — let's " +
  'try again in a moment, or tell me the exact chapter you want to practise. ' +
  'अभी मैं पूरे अभ्यास प्रश्न तैयार नहीं कर पाया — थोड़ी देर में दोबारा कोशिश करते हैं, ' +
  'या बताइए आप कौन-सा अध्याय अभ्यास करना चाहते हैं।';

/**
 * Sentence shapes that CLAIM a quiz / set of questions was produced. Each keeps
 * the match inside a single sentence (`[^.?!\n]{0,40}` bounded gaps — no
 * catastrophic backtracking) and is deliberately narrow: it needs either a
 * creation verb + a COUNT + "question(s)", or the explicit "quiz" qualifier, so
 * ordinary prose like "I prepared a summary with a few questions to consider"
 * does NOT match. Case-insensitive; no global flag (`.test()` is stateless).
 */
const CLAIM_PATTERNS: readonly RegExp[] = [
  // "Generated 5 quiz questions." / "created 5 questions" / "made 3 practice questions"
  /\b(?:generated|created|prepared|made|put\s+together)\b[^.?!\n]{0,40}\b\d+\b[^.?!\n]{0,40}\bquestions?\b/i,
  // "here are 5 questions" / "here's 5 quiz questions"
  /\bhere(?:'s|\s+are|\s+is)\b[^.?!\n]{0,40}\b\d+\b[^.?!\n]{0,40}\bquestions?\b/i,
  // "I've generated a quiz ... questions" (count optional, but "quiz"-qualified)
  /\bi(?:'ve|\s+have)?\s+(?:just\s+)?(?:generated|created|prepared|made)\b[^.?!\n]{0,40}\bquiz\b[^.?!\n]{0,20}\bquestions?\b/i,
  // Hindi/Hinglish claim: a count + प्रश्न/सवाल + a "made/prepared" verb
  // (बनाए/बनाया/तैयार) — defense-in-depth for a Devanagari fake claim.
  /\d+\s*(?:प्रश्न|सवाल)[^।.?!\n]{0,30}(?:बनाए|बनाया|बना दिए|तैयार)/u,
];

/**
 * Evidence that the text ACTUALLY carries questions the student can see/answer.
 * Either >=3 MCQ-style option markers (A) B) C) / (a) / 1. 2.) or >=2 question
 * marks (multiple inline questions). Rendered quiz text always satisfies the
 * option-marker branch, so a real quiz is never treated as claim-only.
 */
function hasQuestionContent(text: string): boolean {
  const optionMarkers = text.match(/(?:^|[\s(])[A-Da-d1-4][).]/g);
  if (optionMarkers && optionMarkers.length >= 3) return true;
  const questionMarks = text.match(/[?？]/g);
  if (questionMarks && questionMarks.length >= 2) return true;
  return false;
}

export interface AntiFakeQuizResult {
  /** True when the text CLAIMS a quiz but carries no real question content. */
  claimOnly: boolean;
  /**
   * The text the caller SHOULD surface: the original when it is safe, or the
   * graceful bilingual fallback when the original was a claim-only quiz turn.
   */
  text: string;
}

/**
 * Deterministic anti-fake backstop. Pure, synchronous, never throws.
 *
 * Returns `{ claimOnly: false, text: <original> }` for any text that is empty,
 * carries no quiz meta-claim, OR is a claim BACKED by real rendered questions.
 * Returns `{ claimOnly: true, text: QUIZ_CLAIM_FALLBACK_TEXT }` only when the
 * text claims a quiz it did not actually surface — the caller must then serve
 * `text` (the graceful bilingual fallback) instead of the original claim.
 */
export function stripFakeQuizClaim(text: unknown): AntiFakeQuizResult {
  const original = typeof text === 'string' ? text : '';
  if (original.trim().length === 0) {
    return { claimOnly: false, text: original };
  }
  const hasClaim = CLAIM_PATTERNS.some((p) => p.test(original));
  if (!hasClaim || hasQuestionContent(original)) {
    return { claimOnly: false, text: original };
  }
  return { claimOnly: true, text: QUIZ_CLAIM_FALLBACK_TEXT };
}
