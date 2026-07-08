/**
 * Regression guard for the bug where students typing
 *   "Provide me 5 questions from this chapter to practice"
 * while the UI was in mode='learn' got an empty intro response (no MCQs).
 *
 * Root cause: foxy_tutor_v1 template emits the STEP CARDS shape for
 * mode='learn'; only mode='practice' triggers MODE_DIRECTIVES.practice
 * which instructs Claude to emit 5 mcq blocks. The route now auto-swaps
 * mode→'practice' when the message matches QUIZ_PATTERNS, regardless of
 * the UI-selected mode.
 *
 * This test exercises the swap helper directly via the regex export.
 */

import { describe, it, expect } from 'vitest';
import { QUIZ_PATTERNS } from '@alfanumrik/lib/ai/workflows/foxy-router';

// Replicate the route's effective-mode logic so we can unit-test the
// behavior without spinning up the full Foxy POST handler. If the route's
// logic changes, update this helper to match.
function effectiveMode(requestedMode: string, message: string): string {
  const isQuizIntent = QUIZ_PATTERNS.test(message);
  return isQuizIntent && requestedMode !== 'practice' ? 'practice' : requestedMode;
}

describe('Foxy effective mode (quiz-intent swap)', () => {
  it('promotes learn → practice when message asks for practice questions', () => {
    expect(effectiveMode('learn', 'Provide me 5 questions from this chapter to practice.')).toBe('practice');
    expect(effectiveMode('learn', 'give me practice questions')).toBe('practice');
    expect(effectiveMode('learn', 'I want to solve some hard problems')).toBe('practice');
    expect(effectiveMode('learn', 'Ask me a few MCQs')).toBe('practice');
    expect(effectiveMode('learn', 'Generate 10 questions for me')).toBe('practice');
    expect(effectiveMode('learn', 'questions from this chapter')).toBe('practice');
    expect(effectiveMode('learn', 'Set me a test on this chapter')).toBe('practice');
  });

  it('promotes explain → practice when message asks for practice questions', () => {
    expect(effectiveMode('explain', 'Provide me 5 questions to practice.')).toBe('practice');
  });

  it('preserves practice when already in practice mode', () => {
    expect(effectiveMode('practice', 'Provide me 5 questions to practice.')).toBe('practice');
  });

  it('does NOT swap when message is conceptual (explain/doubt)', () => {
    expect(effectiveMode('learn', 'Explain photosynthesis to me')).toBe('learn');
    expect(effectiveMode('learn', 'What is the difference between mitosis and meiosis?')).toBe('learn');
    expect(effectiveMode('learn', 'I am confused about chemistry')).toBe('learn');
    expect(effectiveMode('explain', 'Tell me about Newton\'s laws')).toBe('explain');
    expect(effectiveMode('revise', 'Summarize chapter 3 for me')).toBe('revise');
  });

  it('preserves doubt mode when message is conceptual', () => {
    expect(effectiveMode('doubt', 'I don\'t understand why ice floats')).toBe('doubt');
  });
});
