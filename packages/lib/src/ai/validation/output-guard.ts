/**
 * Output Guard — validates LLM output before it reaches students.
 *
 * Enforces AI safety (P12): age-appropriate, no leaked errors,
 * no prompt injection artifacts, no hallucination markers.
 *
 * ⚠️ PHASE 0.1 HARDENING (2026-07-14) — the profanity BLOCKLIST below is now
 * WARN/FLAG-ONLY and NON-DESTRUCTIVE. It used to rewrite bare-substring matches
 * to `***`, which censored legitimate CBSE curriculum vocabulary that merely
 * *contains* a token ("class" → "cl***", "assertive" → "***ertive", "shell" →
 * "s***", "sexual reproduction" → "***ual reproduction", "passage" → "p***age").
 * That masked text reached students on the legacy/fallback Foxy path. The
 * `***`-masking has been removed: a match still records an entry in `errors`
 * (so `valid` becomes false and callers get an advisory flag) but `validateOutput`
 * NO LONGER mutates `sanitizedContent` for a blocklist match.
 *
 * The REAL student-facing safety decision is owned by the word-boundary-safe
 * `screenStudentFacingText` (./output-screen.ts). This substring BLOCKLIST is a
 * coarse observability signal only — it must not decide, and must never mutate,
 * what a student sees.
 */

import type { ValidationResult } from '../types';

/**
 * Clean, age-appropriate, bilingual (P7) safe-abstain reply. Served in place of
 * a model turn when the word-boundary `screenStudentFacingText` backstop judges
 * the LLM output unsafe on the legacy/fallback Foxy path. Foxy stays in its AI
 * study-buddy identity (never impersonates a human teacher — P12). This string
 * is itself clean (contains no blocklist/hard-block token), so re-screening it
 * downstream is a no-op.
 */
export const SAFE_ABSTAIN_MESSAGE =
  "Let's keep our chat focused on your studies — I can't help with that one. " +
  'Try asking me something about your chapter, or check with your teacher if you are unsure.' +
  '\n\n' +
  'चलो अपनी पढ़ाई पर ध्यान देते हैं — मैं इसमें मदद नहीं कर सकता। ' +
  'अपने अध्याय के बारे में कुछ पूछो, या किसी बात पर संदेह हो तो अपने शिक्षक से पूछ लेना।';

const BLOCKLIST = [
  'damn', 'hell', 'shit', 'fuck', 'bastard', 'ass', 'bitch', 'crap',
  'kill yourself', 'suicide', 'self-harm', 'murder', 'weapon',
  'drug abuse', 'alcohol', 'gambling', 'porn', 'sex',
];

const HALLUCINATION_MARKERS = [
  'as an ai language model',
  'as a large language model',
  "i don't have access to",
  "i cannot browse the internet",
  'i was trained by',
  "i'm an ai",
  'my training data',
  'my knowledge cutoff',
];

const PROMPT_LEAK_MARKERS = [
  'system prompt',
  'you are a helpful assistant',
  'instructions:',
  '<system>',
  '</system>',
  '<<SYS>>',
  '[INST]',
];

const ERROR_MARKERS = [
  'stack trace',
  'error:',
  'exception:',
  'traceback',
  'at line ',
  'syntaxerror',
  'typeerror',
  'referenceerror',
  'unhandled rejection',
  'ECONNREFUSED',
  'ETIMEDOUT',
];

const MIN_LENGTH = 10;
const MAX_LENGTH = 10_000;

export function validateOutput(
  content: string,
  context?: { grade?: string; subject?: string },
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let sanitized = content;

  // 1. Non-empty
  if (!content || content.trim().length === 0) {
    return { valid: false, errors: ['Empty response'], warnings, sanitizedContent: '' };
  }

  const lower = content.toLowerCase();

  // 2. Error / stack trace leaks
  for (const marker of ERROR_MARKERS) {
    if (lower.includes(marker)) {
      errors.push(`Leaked error marker: "${marker}"`);
      sanitized = sanitized.replace(new RegExp(marker, 'gi'), '[removed]');
    }
  }

  // 3. Inappropriate content — WARN/FLAG ONLY, NON-DESTRUCTIVE (Phase 0.1).
  //
  // This BLOCKLIST matches BARE SUBSTRINGS, so it fires on legitimate CBSE
  // vocabulary ("class"/"mass"/"passage" ⊃ "ass", "shell"/"hello" ⊃ "hell",
  // "sexual reproduction" ⊃ "sex"). We record the match as an advisory flag
  // (=> `valid` false) for telemetry, but we DO NOT rewrite `sanitized` — the
  // old `.replace(word, '***')` censored real lessons and shipped masked text
  // to students. The word-boundary `screenStudentFacingText` (./output-screen)
  // is the actual student-facing blocker; this loop is observability only.
  for (const word of BLOCKLIST) {
    if (lower.includes(word)) {
      errors.push(`Inappropriate content flagged (advisory): "${word}"`);
    }
  }

  // 4. Hallucination markers
  for (const marker of HALLUCINATION_MARKERS) {
    if (lower.includes(marker)) {
      warnings.push(`Hallucination marker: "${marker}"`);
    }
  }

  // 5. Prompt injection / system prompt leaks
  for (const marker of PROMPT_LEAK_MARKERS) {
    if (lower.includes(marker)) {
      errors.push(`Prompt leak detected: "${marker}"`);
      sanitized = sanitized.replace(new RegExp(marker, 'gi'), '[removed]');
    }
  }

  // 6. Length sanity
  const trimmed = content.trim();
  if (trimmed.length < MIN_LENGTH) {
    warnings.push(`Response too short (${trimmed.length} chars, min ${MIN_LENGTH})`);
  }
  if (trimmed.length > MAX_LENGTH) {
    warnings.push(`Response too long (${trimmed.length} chars, max ${MAX_LENGTH})`);
    sanitized = sanitized.slice(0, MAX_LENGTH) + '...';
  }

  // Context-aware warnings
  if (context?.grade) {
    const gradeNum = parseInt(context.grade, 10);
    if (gradeNum <= 8 && lower.includes('calculus')) {
      warnings.push('Advanced topic (calculus) mentioned for grade <= 8');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitizedContent: sanitized,
  };
}
