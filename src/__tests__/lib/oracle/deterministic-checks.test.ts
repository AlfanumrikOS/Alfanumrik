// src/__tests__/lib/oracle/deterministic-checks.test.ts
//
// Phase 6.17: confirm the `src/lib/oracle/deterministic-checks` re-export
// surface exposes the same `runDeterministicChecks` behaviour as the
// canonical `src/lib/ai/validation/quiz-oracle` module. The retroactive
// scan script imports from this re-export path; if the surface drifts the
// scan would silently mis-classify rows.
//
// We deliberately do NOT re-test every rejection category here — those are
// covered exhaustively in `src/__tests__/quiz-oracle.test.ts`. This file
// guards the four anchor cases the Phase 6.17 task ticket calls out
// explicitly:
//   1. 4-distinct-options check
//   2. correct_answer_index range check
//   3. [BLANK] / placeholder detection
//   4. empty-explanation rejection
// plus a happy-path acceptance to prove the re-export resolves and the
// rejection path is not the only thing wired up.

import { describe, it, expect } from 'vitest';
import {
  runDeterministicChecks,
  type CandidateQuestion,
} from '@/lib/oracle/deterministic-checks';

function validCandidate(
  overrides: Partial<CandidateQuestion> = {},
): CandidateQuestion {
  return {
    question_text: 'What is the chemical symbol for water?',
    options: ['H2O', 'CO2', 'NaCl', 'O2'],
    correct_answer_index: 0,
    explanation:
      'Water is composed of two hydrogen atoms and one oxygen atom, so its chemical formula is H2O.',
    difficulty: 'easy',
    bloom_level: 'remember',
    ...overrides,
  };
}

describe('src/lib/oracle/deterministic-checks (Phase 6.17 re-export)', () => {
  it('accepts a well-formed candidate (smoke test for the re-export wiring)', () => {
    const result = runDeterministicChecks(validCandidate());
    // Pass = null. If the re-export pointed at the wrong module we'd see
    // either an exception (binding missing) or a non-null rejection here.
    expect(result).toBeNull();
  });

  it('rejects candidates without 4 distinct options (4-distinct-options check)', () => {
    // Three distinct + one duplicate. options.length is still 4 so the
    // length check passes; the distinctness Set.size check is the gate.
    const result = runDeterministicChecks(
      validCandidate({
        options: ['H2O', 'CO2', 'NaCl', 'h2o'], // duplicate (case-insensitive)
      }),
    );
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.category).toBe('p6_options_not_distinct');
      expect(result.llm_calls).toBe(0);
    }
  });

  it('rejects candidates whose correct_answer_index is out of 0..3 range', () => {
    const result = runDeterministicChecks(
      validCandidate({ correct_answer_index: 4 }),
    );
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.category).toBe('p6_correct_index_out_of_range');
    }
  });

  it('rejects question_text containing the [BLANK] placeholder', () => {
    const result = runDeterministicChecks(
      validCandidate({
        question_text: 'The capital of India is [BLANK].',
      }),
    );
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.category).toBe('p6_text_empty_or_placeholder');
    }
  });

  it('rejects question_text containing a {{template}} placeholder', () => {
    const result = runDeterministicChecks(
      validCandidate({
        question_text: 'What is {{topic_name}}?',
      }),
    );
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.category).toBe('p6_text_empty_or_placeholder');
    }
  });

  it('rejects candidates with an empty explanation', () => {
    const result = runDeterministicChecks(
      validCandidate({ explanation: '   ' }),
    );
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.category).toBe('p6_explanation_empty');
    }
  });
});
