// src/__tests__/quiz-oracle.test.ts
//
// REG-54: AI quiz-generator validation oracle.
//
// Covers:
//   1. Deterministic checks (P6 + extras) — every rejection category
//   2. LLM-grader contract — verdict mapping, parse failures, throws
//   3. Cache-key stability + parse robustness
//   4. End-to-end validateCandidate() flow with a mocked grader

import { describe, it, expect, vi } from 'vitest';
import {
  runDeterministicChecks,
  validateCandidate,
  parseLlmGraderResponse,
  checkNumericConsistency,
  type CandidateQuestion,
  type LlmGradeResult,
  type LlmGrader,
} from '@/lib/ai/validation/quiz-oracle';
import {
  QUIZ_ORACLE_GRADER_SYSTEM_PROMPT,
  buildQuizOracleGraderUserPrompt,
} from '@/lib/ai/validation/quiz-oracle-prompts';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function validCandidate(overrides: Partial<CandidateQuestion> = {}): CandidateQuestion {
  return {
    question_text: 'What is the chemical symbol for water?',
    options: ['H2O', 'CO2', 'NaCl', 'O2'],
    correct_answer_index: 0,
    explanation: 'Water is composed of two hydrogen atoms and one oxygen atom, so its chemical formula is H2O.',
    difficulty: 1,
    bloom_level: 'remember',
    ...overrides,
  };
}

// ─── Deterministic: P6 violations ────────────────────────────────────────────

describe('runDeterministicChecks — P6 question_text', () => {
  it('rejects empty text', () => {
    const r = runDeterministicChecks(validCandidate({ question_text: '   ' }));
    expect(r?.category).toBe('p6_text_empty_or_placeholder');
  });

  it('rejects {{ placeholder', () => {
    const r = runDeterministicChecks(validCandidate({ question_text: 'What is {{topic}}?' }));
    expect(r?.category).toBe('p6_text_empty_or_placeholder');
  });

  it('rejects [BLANK] placeholder (case-insensitive)', () => {
    const r = runDeterministicChecks(validCandidate({ question_text: 'Fill in the [blank] please.' }));
    expect(r?.category).toBe('p6_text_empty_or_placeholder');
  });

  it('accepts ordinary punctuation including curly quotes', () => {
    const r = runDeterministicChecks(
      validCandidate({ question_text: 'Why is the sky “blue”? Choose one.' }),
    );
    expect(r).toBeNull();
  });
});

describe('runDeterministicChecks — P6 options', () => {
  it('rejects when options is not an array', () => {
    const r = runDeterministicChecks(
      validCandidate({ options: 'a,b,c,d' as unknown as string[] }),
    );
    expect(r?.category).toBe('p6_options_not_4');
  });

  it('rejects when there are fewer than 4 options', () => {
    const r = runDeterministicChecks(validCandidate({ options: ['a', 'b', 'c'] }));
    expect(r?.category).toBe('p6_options_not_4');
  });

  it('rejects when there are more than 4 options', () => {
    const r = runDeterministicChecks(validCandidate({ options: ['a', 'b', 'c', 'd', 'e'] }));
    expect(r?.category).toBe('p6_options_not_4');
  });

  it('rejects empty string options', () => {
    const r = runDeterministicChecks(validCandidate({ options: ['a', '', 'c', 'd'] }));
    expect(r?.category).toBe('p6_options_not_4');
  });

  it('rejects whitespace-only options', () => {
    const r = runDeterministicChecks(validCandidate({ options: ['a', '   ', 'c', 'd'] }));
    expect(r?.category).toBe('p6_options_not_4');
  });

  it('rejects duplicate options (case-insensitive)', () => {
    const r = runDeterministicChecks(validCandidate({ options: ['Yes', 'no', 'YES', 'maybe'] }));
    expect(r?.category).toBe('p6_options_not_distinct');
  });
});

describe('runDeterministicChecks — P6 correct_answer_index', () => {
  it('rejects negative index', () => {
    const r = runDeterministicChecks(validCandidate({ correct_answer_index: -1 }));
    expect(r?.category).toBe('p6_correct_index_out_of_range');
  });

  it('rejects index 4', () => {
    const r = runDeterministicChecks(validCandidate({ correct_answer_index: 4 }));
    expect(r?.category).toBe('p6_correct_index_out_of_range');
  });

  it('rejects non-integer index', () => {
    const r = runDeterministicChecks(validCandidate({ correct_answer_index: 1.5 }));
    expect(r?.category).toBe('p6_correct_index_out_of_range');
  });

  it('rejects non-number index', () => {
    const r = runDeterministicChecks(
      validCandidate({ correct_answer_index: '2' as unknown as number }),
    );
    expect(r?.category).toBe('p6_correct_index_out_of_range');
  });

  it('accepts boundary indexes 0 and 3', () => {
    expect(runDeterministicChecks(validCandidate({ correct_answer_index: 0 }))).toBeNull();
    // Need a candidate where index 3 is correct AND explanation refers to last option.
    const r = runDeterministicChecks({
      ...validCandidate({ correct_answer_index: 3 }),
      explanation: 'O2 is just oxygen gas; H2O is water but the marked correct option is O2 here.',
      // Skip numeric consistency by using non-numeric options + explanation.
      options: ['alpha', 'beta', 'gamma', 'delta'],
      question_text: 'Which Greek letter comes last among these?',
      explanation_keep: undefined,
    } as CandidateQuestion);
    // It's fine if r is null OR another non-index error — we only assert no
    // p6_correct_index_out_of_range for index=3.
    expect(r?.category).not.toBe('p6_correct_index_out_of_range');
  });
});

describe('runDeterministicChecks — P6 explanation', () => {
  it('rejects empty explanation', () => {
    const r = runDeterministicChecks(validCandidate({ explanation: '' }));
    expect(r?.category).toBe('p6_explanation_empty');
  });

  it('rejects whitespace-only explanation', () => {
    const r = runDeterministicChecks(validCandidate({ explanation: '   \n  ' }));
    expect(r?.category).toBe('p6_explanation_empty');
  });
});

describe('runDeterministicChecks — P6 difficulty', () => {
  it('accepts numeric 1..5', () => {
    for (const d of [1, 2, 3, 4, 5]) {
      const r = runDeterministicChecks(validCandidate({ difficulty: d }));
      expect(r).toBeNull();
    }
  });

  it('accepts string easy|medium|hard', () => {
    for (const d of ['easy', 'medium', 'hard']) {
      const r = runDeterministicChecks(validCandidate({ difficulty: d }));
      expect(r).toBeNull();
    }
  });

  it('rejects out-of-range numeric', () => {
    const r = runDeterministicChecks(validCandidate({ difficulty: 6 }));
    expect(r?.category).toBe('p6_invalid_difficulty');
  });

  it('rejects unknown string', () => {
    const r = runDeterministicChecks(validCandidate({ difficulty: 'extreme' }));
    expect(r?.category).toBe('p6_invalid_difficulty');
  });

  it('skips check when difficulty is undefined', () => {
    const r = runDeterministicChecks({ ...validCandidate(), difficulty: undefined });
    expect(r).toBeNull();
  });
});

describe('runDeterministicChecks — P6 bloom_level', () => {
  it('accepts all 6 valid Bloom levels', () => {
    for (const b of ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']) {
      const r = runDeterministicChecks(validCandidate({ bloom_level: b }));
      expect(r).toBeNull();
    }
  });

  it('accepts case-insensitively', () => {
    const r = runDeterministicChecks(validCandidate({ bloom_level: 'APPLY' }));
    expect(r).toBeNull();
  });

  it('rejects unknown bloom_level', () => {
    const r = runDeterministicChecks(validCandidate({ bloom_level: 'memorize' }));
    expect(r?.category).toBe('p6_invalid_bloom');
  });

  it('skips check when bloom_level is undefined', () => {
    const r = runDeterministicChecks({ ...validCandidate(), bloom_level: undefined });
    expect(r).toBeNull();
  });
});

// ─── Deterministic: option overlap ───────────────────────────────────────────

describe('runDeterministicChecks — options_overlap_semantic', () => {
  it('rejects high-overlap short options (>=70% Jaccard)', () => {
    const r = runDeterministicChecks(
      validCandidate({
        options: ['the cat sat', 'the cat sat down', 'a dog ran', 'a fish swam'],
      }),
    );
    expect(r?.category).toBe('options_overlap_semantic');
  });

  it('does NOT reject low-overlap distinct options', () => {
    const r = runDeterministicChecks(
      validCandidate({
        options: ['photosynthesis', 'respiration', 'transpiration', 'germination'],
      }),
    );
    expect(r).toBeNull();
  });

  it('rejects very high overlap on long options too (>=85%)', () => {
    const r = runDeterministicChecks(
      validCandidate({
        options: [
          'a long process by which plants make food using sunlight water and air',
          'a long process by which plants make food using sunlight water and gas',
          'something completely different about animals',
          'an unrelated geological phenomenon',
        ],
      }),
    );
    expect(r?.category).toBe('options_overlap_semantic');
  });
});

// ─── Deterministic: numeric consistency ─────────────────────────────────────

describe('checkNumericConsistency', () => {
  it('flags when correct option has number missing from explanation', () => {
    const r = checkNumericConsistency(
      'Solve for x.',
      'x = 12',
      'We add the two sides and divide; the answer is 15.',
    );
    expect(r).toMatch(/12.*explanation/);
  });

  it('passes when correct option number appears in explanation', () => {
    const r = checkNumericConsistency(
      'Solve for x.',
      'x = 12',
      'We add the two sides and divide; the answer is 12.',
    );
    expect(r).toBeNull();
  });

  it('ignores numbers given in the question itself', () => {
    // "Given 5x + 7 = 22" — the explanation re-states 5 and 7 before
    // arriving at x=3. The option "x = 3" must match an explanation number.
    const r = checkNumericConsistency(
      'Given 5x + 7 = 22, find x.',
      '3',
      'Subtract 7 from both sides to get 5x = 15, then divide by 5 to get x = 3.',
    );
    expect(r).toBeNull();
  });

  it('passes when both option and explanation are non-numeric', () => {
    const r = checkNumericConsistency(
      'What gas do plants release?',
      'oxygen',
      'During photosynthesis plants release oxygen as a byproduct.',
    );
    expect(r).toBeNull();
  });

  it('passes when option has no numbers (no constraint to check)', () => {
    const r = checkNumericConsistency(
      'What is the capital?',
      'Paris',
      'The capital is Paris, founded around the year 250 BC.',
    );
    expect(r).toBeNull();
  });
});

// ─── End-to-end: validateCandidate ───────────────────────────────────────────

describe('validateCandidate — deterministic-only mode', () => {
  it('accepts a valid candidate when LLM grader is disabled', async () => {
    const r = await validateCandidate(validCandidate(), { enableLlmGrader: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.llm_calls).toBe(0);
  });

  it('rejects on deterministic failure without calling grader', async () => {
    const grader: LlmGrader = vi.fn();
    const r = await validateCandidate(validCandidate({ explanation: '' }), {
      enableLlmGrader: true,
      llmGrade: grader,
    });
    expect(r.ok).toBe(false);
    expect(grader).not.toHaveBeenCalled();
    if (!r.ok) {
      expect(r.category).toBe('p6_explanation_empty');
      expect(r.llm_calls).toBe(0);
    }
  });
});

describe('validateCandidate — LLM-grader contract', () => {
  it('accepts when grader returns "consistent"', async () => {
    const grader: LlmGrader = vi.fn().mockResolvedValue({
      verdict: 'consistent',
      reasoning: 'explanation supports H2O',
    } satisfies LlmGradeResult);

    const r = await validateCandidate(validCandidate(), {
      enableLlmGrader: true,
      llmGrade: grader,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.llm_calls).toBe(1);
    expect(grader).toHaveBeenCalledTimes(1);
  });

  it('rejects with llm_mismatch and surfaces suggested_correct_index', async () => {
    const grader: LlmGrader = vi.fn().mockResolvedValue({
      verdict: 'mismatch',
      reasoning: 'explanation describes oxygen, not water',
      suggested_correct_index: 3,
    } satisfies LlmGradeResult);

    const r = await validateCandidate(validCandidate(), {
      enableLlmGrader: true,
      llmGrade: grader,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.category).toBe('llm_mismatch');
      expect(r.suggested_correct_index).toBe(3);
      expect(r.llm_calls).toBe(1);
    }
  });

  it('rejects with llm_ambiguous when grader cannot decide', async () => {
    const grader: LlmGrader = vi.fn().mockResolvedValue({
      verdict: 'ambiguous',
      reasoning: 'explanation could justify either A or B',
    } satisfies LlmGradeResult);

    const r = await validateCandidate(validCandidate(), {
      enableLlmGrader: true,
      llmGrade: grader,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.category).toBe('llm_ambiguous');
      expect(r.llm_calls).toBe(1);
    }
  });

  it('rejects with llm_grader_unavailable when grader throws', async () => {
    const grader: LlmGrader = vi.fn().mockRejectedValue(new Error('Anthropic 500'));

    const r = await validateCandidate(validCandidate(), {
      enableLlmGrader: true,
      llmGrade: grader,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.category).toBe('llm_grader_unavailable');
      expect(r.reason).toContain('Anthropic 500');
      expect(r.llm_calls).toBe(1);
    }
  });

  it('rejects with llm_grader_unavailable when enabled but no grader fn', async () => {
    const r = await validateCandidate(validCandidate(), {
      enableLlmGrader: true,
      // Intentionally no llmGrade
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.category).toBe('llm_grader_unavailable');
      expect(r.llm_calls).toBe(0);
    }
  });

  it('truncates long grader reasoning to 300 chars', async () => {
    const long = 'x'.repeat(500);
    const grader: LlmGrader = vi.fn().mockResolvedValue({
      verdict: 'mismatch',
      reasoning: long,
    } satisfies LlmGradeResult);

    const r = await validateCandidate(validCandidate(), {
      enableLlmGrader: true,
      llmGrade: grader,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.length).toBeLessThanOrEqual(300);
    }
  });
});

// ─── Parser ─────────────────────────────────────────────────────────────────

describe('parseLlmGraderResponse', () => {
  it('parses strict JSON', () => {
    const r = parseLlmGraderResponse(
      '{"verdict":"consistent","reasoning":"ok"}',
    );
    expect(r?.verdict).toBe('consistent');
  });

  it('parses JSON wrapped in ```json fences', () => {
    const r = parseLlmGraderResponse(
      '```json\n{"verdict":"mismatch","reasoning":"wrong","suggested_correct_index":2}\n```',
    );
    expect(r?.verdict).toBe('mismatch');
    expect(r?.suggested_correct_index).toBe(2);
  });

  it('parses JSON wrapped in plain ``` fences', () => {
    const r = parseLlmGraderResponse(
      '```\n{"verdict":"ambiguous","reasoning":"unclear"}\n```',
    );
    expect(r?.verdict).toBe('ambiguous');
  });

  it('returns null on invalid JSON', () => {
    expect(parseLlmGraderResponse('not json')).toBeNull();
  });

  it('returns null when verdict is unknown', () => {
    expect(
      parseLlmGraderResponse('{"verdict":"maybe","reasoning":"hm"}'),
    ).toBeNull();
  });

  it('drops out-of-range suggested_correct_index', () => {
    const r = parseLlmGraderResponse(
      '{"verdict":"mismatch","reasoning":"x","suggested_correct_index":7}',
    );
    expect(r?.suggested_correct_index).toBeUndefined();
  });

  it('drops non-integer suggested_correct_index', () => {
    const r = parseLlmGraderResponse(
      '{"verdict":"mismatch","reasoning":"x","suggested_correct_index":1.5}',
    );
    expect(r?.suggested_correct_index).toBeUndefined();
  });

  it('handles empty reasoning', () => {
    const r = parseLlmGraderResponse('{"verdict":"consistent"}');
    expect(r?.verdict).toBe('consistent');
    expect(r?.reasoning).toBe('');
  });
});

// ─── Prompt builder ─────────────────────────────────────────────────────────

describe('buildQuizOracleGraderUserPrompt', () => {
  it('renders all 4 options and marks the correct one', () => {
    const txt = buildQuizOracleGraderUserPrompt({
      question_text: 'Q?',
      options: ['A', 'B', 'C', 'D'],
      correct_answer_index: 2,
      explanation: 'E.',
    });
    expect(txt).toContain('  0: A\n');
    expect(txt).toContain('  1: B\n');
    expect(txt).toContain('  2: C (MARKED CORRECT)');
    expect(txt).toContain('  3: D');
    expect(txt).toContain('Marked correct_answer_index: 2');
    expect(txt).toContain('Explanation:\nE.');
  });

  it('produces deterministic output for identical inputs (cache-safe)', () => {
    const a = buildQuizOracleGraderUserPrompt({
      question_text: 'Q',
      options: ['a', 'b', 'c', 'd'],
      correct_answer_index: 0,
      explanation: 'E',
    });
    const b = buildQuizOracleGraderUserPrompt({
      question_text: 'Q',
      options: ['a', 'b', 'c', 'd'],
      correct_answer_index: 0,
      explanation: 'E',
    });
    expect(a).toBe(b);
  });
});

describe('QUIZ_ORACLE_GRADER_SYSTEM_PROMPT contract', () => {
  it('instructs strict JSON output (no markdown)', () => {
    expect(QUIZ_ORACLE_GRADER_SYSTEM_PROMPT).toMatch(/STRICT JSON/i);
    expect(QUIZ_ORACLE_GRADER_SYSTEM_PROMPT).toMatch(/no markdown fences/i);
  });

  it('lists all three verdict options', () => {
    expect(QUIZ_ORACLE_GRADER_SYSTEM_PROMPT).toMatch(/consistent/);
    expect(QUIZ_ORACLE_GRADER_SYSTEM_PROMPT).toMatch(/mismatch/);
    expect(QUIZ_ORACLE_GRADER_SYSTEM_PROMPT).toMatch(/ambiguous/);
  });

  it('forbids commenting on difficulty/age/curriculum (out of scope)', () => {
    expect(QUIZ_ORACLE_GRADER_SYSTEM_PROMPT).toMatch(/Do NOT comment on the difficulty/i);
  });
});
