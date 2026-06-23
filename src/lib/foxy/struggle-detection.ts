// src/lib/foxy/struggle-detection.ts
//
// PART B2 — chat-observed struggle detection.
//
// PURE detectors over the current message + recent session history. They emit a
// signalType from the architect's learner.struggle_observed enum (registry.ts).
// This module NEVER writes mastery and NEVER echoes the student's words — the
// route maps a detection to the IDs/enums-only event and publishes it.
//
// Mapping of the task's signal names to the architect's existing registry enum
// (the schema validates against the enum, so we use the canonical values):
//   task 'repeat_explain'            -> 'repeated_hint'       (asked to re-explain/simplify >= 2x)
//   task 'self_reported_confusion'   -> 'explicit_confusion'  ("I don't get this" / "confused")
//   task 'multiple_chat_wrong'       -> 'repeated_wrong'      (>= 2 wrong free-text answers in session)
//
// Owner: ai-engineer. Reviewed by: assessment (signal semantics), testing.
// P13: detectors return enums only; no message text leaves this module.

/** The struggle signal kinds the chat detector can emit (subset of the registry enum). */
export type ChatStruggleSignal =
  | 'repeated_hint'
  | 'explicit_confusion'
  | 'repeated_wrong';

// Explicit-confusion phrases (EN + Hinglish + Devanagari). Conservative: these
// are unambiguous "I don't understand" statements, not mere questions.
const CONFUSION_PATTERNS: RegExp[] = [
  /\bi\s+(?:don'?t|do not|dont)\s+(?:get|understand)\b/i,
  /\bi'?m\s+(?:so\s+)?confused\b/i,
  /\b(?:still|really)\s+confused\b/i,
  /\bthis\s+(?:is|makes no)\s+(?:confusing|sense)\b/i,
  /\bnot\s+(?:getting|understanding)\s+(?:this|it)\b/i,
  /\bmakes?\s+no\s+sense\b/i,
  /\b(?:samajh|samaj)\s+nahi(?:n)?\s+(?:aa?ya|aa\s*raha|aata)\b/i,
  /\bnahi(?:n)?\s+samajh\b/i,
  /\bconfuse\s+ho\s+(?:gaya|raha)\b/i,
];

const CONFUSION_HINDI_RE = /(समझ\s*नहीं\s*आ|समझ\s*नहीं|कन्फ्यूज)/;

// Re-explain / simplify request phrases. Used to count how many times in the
// session the student asked Foxy to re-teach the SAME thing.
const REEXPLAIN_PATTERNS: RegExp[] = [
  /\b(?:explain|teach)\s+(?:it\s+)?(?:again|simpler|more simply|differently)\b/i,
  /\b(?:re-?explain|explain once more)\b/i,
  /\bsimplif(?:y|ied)\b/i,
  /\bmake\s+it\s+simpler\b/i,
  /\b(?:didn'?t|did not|still don'?t)\s+(?:get|understand)\b/i,
  /\b(?:phir se|dobara)\s+(?:samjha\w*|samajh\w*|batao|explain)\b/i,
  /\b(?:aur|thoda)\s+(?:simple|aasan)\b/i,
];

const REEXPLAIN_HINDI_RE = /(फिर\s*से\s*समझा|दोबारा\s*समझा|आसान\s*भाषा)/;

/** True when the message is an explicit "I don't understand" statement. */
export function isExplicitConfusion(message: string): boolean {
  const text = (message ?? '').trim();
  if (!text) return false;
  return CONFUSION_PATTERNS.some((re) => re.test(text)) || CONFUSION_HINDI_RE.test(text);
}

/** True when the message is a request to re-explain / simplify. */
export function isReExplainRequest(message: string): boolean {
  const text = (message ?? '').trim();
  if (!text) return false;
  return REEXPLAIN_PATTERNS.some((re) => re.test(text)) || REEXPLAIN_HINDI_RE.test(text);
}

export interface StruggleDetectionInput {
  /** The current student message (raw). */
  message: string;
  /**
   * The student's recent messages THIS session, oldest-first, INCLUDING the
   * current one as the last element. Used for the repeat counts. Bounded by the
   * caller (we only need the last handful).
   */
  recentStudentMessages: string[];
  /**
   * Optional coach directive on this turn. 'simplify' is a re-explain request
   * even when the message body is empty/UI-driven (the button re-sends the same
   * question with coachDirective='simplify').
   */
  coachDirective?: 'simplify' | 'example' | 'quiz_me' | null;
  /**
   * Count of wrong free-text/MCQ answers OBSERVED in this session so far (the
   * caller supplies this; e.g. from prior non-evidential grading or chat
   * heuristics). >= 2 fires 'repeated_wrong'. Default 0 (no signal).
   */
  sessionWrongCount?: number;
}

/**
 * Detect at most ONE struggle signal for this turn. Precedence (strongest first):
 *   1. repeated_wrong       — sessionWrongCount >= 2
 *   2. explicit_confusion   — current message is an explicit "I don't get it"
 *   3. repeated_hint        — >= 2 re-explain/simplify requests in the session
 *                             (counting the current turn's request + directive)
 *
 * Returns null when no signal fires. PURE — no I/O, no PII echoed.
 */
export function detectStruggleSignal(input: StruggleDetectionInput): ChatStruggleSignal | null {
  const wrongCount = input.sessionWrongCount ?? 0;
  if (wrongCount >= 2) return 'repeated_wrong';

  if (isExplicitConfusion(input.message)) return 'explicit_confusion';

  // Count re-explain requests across the session, plus the current directive.
  const reExplainTurns = (input.recentStudentMessages ?? []).filter((m) =>
    isReExplainRequest(m),
  ).length;
  const directiveIsReExplain = input.coachDirective === 'simplify';
  // The current message may already be in recentStudentMessages; the directive
  // is an independent signal (button-driven), so add it when present and not
  // already reflected by a matching message.
  const total =
    reExplainTurns + (directiveIsReExplain && !isReExplainRequest(input.message) ? 1 : 0);

  if (total >= 2) return 'repeated_hint';

  return null;
}
