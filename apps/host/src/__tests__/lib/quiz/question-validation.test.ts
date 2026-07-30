/**
 * P6 — Canonical question-quality gate.
 *
 * Subject under test: `packages/lib/src/quiz/question-validation.ts`, the SINGLE
 * validator every path that serves a question to a student now runs.
 *
 * WHY THIS SUITE EXISTS
 * =====================
 * P6 used to be implemented three times — in `quiz-assembler.ts` (the LIVE
 * student quiz path), `domains/quiz.ts`, and `supabase.ts` — and the three had
 * drifted. The live copy was the WEAKEST:
 *
 *   1. It range-checked `correct_answer_index` with `idx < 0 || idx > 3` and no
 *      null guard. In JS `null < 0` and `null > 3` are BOTH false, so a question
 *      with a NULL answer key sailed through the live gate and was then treated
 *      as index 0 — the student was graded against an answer key that did not
 *      exist. The 2026-07-29 forensic audit fixed this in the other two copies
 *      only, which is exactly the defect class this file guards.
 *   2. It accepted `>= 3` DISTINCT options, so a duplicated distractor silently
 *      turned a 4-way MCQ into a 3-way guess.
 *   3. It had no `bloom_level` check.
 *   4. It had no explanation word-count floor.
 *
 * The canonical module is the STRICT UNION of all three. These tests pin that
 * union — every rejection below is a check that at least one former copy did
 * NOT have, plus the shared checks, plus the TWO axes that are deliberately NOT
 * unioned-on-by-default: `allowNonMcq` (shape contract) and `enforceBloomLevel`
 * (metadata tag — default OFF so serving callers never drop an answerable
 * question over a bloom tag; see the option's doc comment in the module).
 *
 * Assertions are on the RETURNED `{ valid, reason }` contract (behaviour), not
 * on internals. Every test is independent.
 *
 * Invariant: P6 (Question Quality). Owner: assessment.
 */

import { describe, it, expect } from 'vitest';
import {
  validateQuestion,
  validateQuestions,
  MIN_QUESTION_TEXT_LENGTH,
  MIN_EXPLANATION_LENGTH,
  MIN_EXPLANATION_WORDS,
  REQUIRED_OPTION_COUNT,
} from '@alfanumrik/lib/quiz/question-validation';
import { BLOOM_LEVELS_ORDERED } from '@alfanumrik/lib/score-config';

// ── Fixture ───────────────────────────────────────────────────────────────────
// A question that passes every check, so each test below isolates exactly ONE
// violation. Keep it valid: if the baseline ever stops being valid, the
// "baseline is valid" test fails first and names the problem, rather than every
// rejection test passing for the wrong reason.

function makeValidQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q-valid',
    question_text: 'Which organelle is chiefly responsible for producing ATP in a eukaryotic cell?',
    options: ['Nucleus', 'Mitochondrion', 'Ribosome', 'Golgi apparatus'],
    correct_answer_index: 1,
    explanation:
      'Mitochondria generate most cellular ATP through oxidative phosphorylation in their inner membrane.',
    difficulty: 2,
    bloom_level: 'remember',
    chapter_number: 1,
    question_type: 'mcq',
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 0. Exported thresholds — the numbers other code and tests key off.
// ════════════════════════════════════════════════════════════════════════════

describe('P6 canonical validator: exported thresholds', () => {
  it('pins the four thresholds at their strict-union values', () => {
    expect(MIN_QUESTION_TEXT_LENGTH).toBe(15);
    expect(MIN_EXPLANATION_LENGTH).toBe(20);
    expect(MIN_EXPLANATION_WORDS).toBe(8);
    // P6 verbatim: "exactly 4 distinct non-empty options". NOT 3.
    expect(REQUIRED_OPTION_COUNT).toBe(4);
  });

  it('the baseline fixture is valid (guards every rejection test below)', () => {
    expect(validateQuestion(makeValidQuestion())).toEqual({ valid: true });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. correct_answer_index — the `null < 0 === false` hole that was LIVE.
// ════════════════════════════════════════════════════════════════════════════

describe('P6 canonical validator: correct_answer_index', () => {
  it('rejects a NULL answer index (the live-path hole: `null < 0` is false in JS)', () => {
    const result = validateQuestion(makeValidQuestion({ correct_answer_index: null }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing_answer_index');
  });

  it('rejects an UNDEFINED answer index', () => {
    const result = validateQuestion(makeValidQuestion({ correct_answer_index: undefined }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing_answer_index');
  });

  it('rejects a numeric STRING index like "2" (would pass a bare `< 0 || > 3` check)', () => {
    // '2' < 0 → false and '2' > 3 → false, so the old range-only check accepted
    // it; downstream `selectedIndex === correct_answer_index` then never matches
    // because the comparison is strict, silently marking every student wrong.
    const result = validateQuestion(makeValidQuestion({ correct_answer_index: '2' }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad_answer_index');
  });

  it('rejects a non-integer index like 2.5', () => {
    const result = validateQuestion(makeValidQuestion({ correct_answer_index: 2.5 }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad_answer_index');
  });

  it('rejects NaN', () => {
    const result = validateQuestion(makeValidQuestion({ correct_answer_index: NaN }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad_answer_index');
  });

  it('rejects out-of-range indices (-1 and 4)', () => {
    expect(validateQuestion(makeValidQuestion({ correct_answer_index: -1 })).reason).toBe(
      'bad_answer_index',
    );
    expect(validateQuestion(makeValidQuestion({ correct_answer_index: 4 })).reason).toBe(
      'bad_answer_index',
    );
  });

  it('accepts every in-range index 0..3 (boundaries are inclusive)', () => {
    for (const idx of [0, 1, 2, 3]) {
      expect(validateQuestion(makeValidQuestion({ correct_answer_index: idx }))).toEqual({
        valid: true,
      });
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Options — exactly FOUR, all non-empty, all DISTINCT.
// ════════════════════════════════════════════════════════════════════════════

describe('P6 canonical validator: options', () => {
  it('rejects 3 options (count) with a count-bearing reason', () => {
    const result = validateQuestion(makeValidQuestion({ options: ['A', 'B', 'C'] }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('3_options');
  });

  it('rejects 5 options', () => {
    expect(validateQuestion(makeValidQuestion({ options: ['A', 'B', 'C', 'D', 'E'] })).reason).toBe(
      '5_options',
    );
  });

  it('rejects a missing / non-array options field', () => {
    expect(validateQuestion(makeValidQuestion({ options: undefined })).reason).toBe('0_options');
    expect(validateQuestion(makeValidQuestion({ options: 'A,B,C,D' })).reason).toBe('0_options');
  });

  it('rejects 4 options when only 3 are DISTINCT (the old `>= 3 distinct` hole)', () => {
    // Four options, but two identical → a 4-way MCQ that is really a 3-way
    // guess. The former live path accepted this.
    const result = validateQuestion(
      makeValidQuestion({ options: ['Nucleus', 'Mitochondrion', 'Ribosome', 'Nucleus'] }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('duplicate_options');
  });

  it('treats distinctness case- and whitespace-insensitively', () => {
    // 'Nucleus' vs '  nucleus ' is the same distractor to a student.
    const result = validateQuestion(
      makeValidQuestion({ options: ['Nucleus', 'Mitochondrion', 'Ribosome', '  nucleus '] }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('duplicate_options');
  });

  it('rejects an empty / whitespace-only option before the distinctness check', () => {
    expect(
      validateQuestion(makeValidQuestion({ options: ['A option', 'B option', 'C option', ''] }))
        .reason,
    ).toBe('empty_option');
    expect(
      validateQuestion(makeValidQuestion({ options: ['A option', 'B option', 'C option', '   '] }))
        .reason,
    ).toBe('empty_option');
  });

  it('rejects filler distractors (garbage option substrings)', () => {
    const result = validateQuestion(
      makeValidQuestion({ options: ['Nucleus', 'Mitochondrion', 'Ribosome', 'Art and craft'] }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('garbage_option');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. bloom_level — OPT-IN via `enforceBloomLevel` (default OFF). When enforced:
//    only the canonical six, no spelling variants. When not enforced: the tag
//    is not validated at all — serving callers must never lose an answerable
//    question over metadata.
// ════════════════════════════════════════════════════════════════════════════

describe('P6 canonical validator: bloom_level', () => {
  it('does NOT validate bloom_level by default — a NULL/variant bloom row is still served', () => {
    // THE BLOCKER REGRESSION PIN (assessment, 2026-07-29). `question_bank.
    // bloom_level` is nullable with no CHECK, and no live serving path has ever
    // filtered on it. If the default silently re-tightens, serving callers that
    // pass no options start dropping otherwise-answerable questions and can
    // empty a whole chapter ("No questions available"). If this test fails,
    // the DEFAULT changed — that is the regression, not a fixture problem.
    expect(validateQuestion(makeValidQuestion({ bloom_level: null }))).toEqual({ valid: true });
    expect(validateQuestion(makeValidQuestion({ bloom_level: undefined }))).toEqual({
      valid: true,
    });
    expect(validateQuestion(makeValidQuestion({ bloom_level: 'analyse' }))).toEqual({
      valid: true,
    });
  });

  it('accepts each of the canonical six levels under enforceBloomLevel', () => {
    expect(BLOOM_LEVELS_ORDERED.length).toBe(6);
    for (const level of BLOOM_LEVELS_ORDERED) {
      expect(
        validateQuestion(makeValidQuestion({ bloom_level: level }), { enforceBloomLevel: true }),
      ).toEqual({ valid: true });
    }
  });

  it('is case- and whitespace-tolerant on an otherwise canonical level under enforceBloomLevel', () => {
    expect(
      validateQuestion(makeValidQuestion({ bloom_level: '  Apply ' }), {
        enforceBloomLevel: true,
      }),
    ).toEqual({ valid: true });
  });

  it('rejects the British spelling "analyse" under enforceBloomLevel (a variant forks the mastery heatmap)', () => {
    const result = validateQuestion(makeValidQuestion({ bloom_level: 'analyse' }), {
      enforceBloomLevel: true,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid_bloom_level');
  });

  it('rejects an unknown level, an empty level, and a missing level under enforceBloomLevel', () => {
    for (const bad of ['recall', '', null, undefined, 3]) {
      const result = validateQuestion(makeValidQuestion({ bloom_level: bad }), {
        enforceBloomLevel: true,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_bloom_level');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Question text — template markers, length floor, garbage openers.
// ════════════════════════════════════════════════════════════════════════════

describe('P6 canonical validator: question_text', () => {
  it('rejects an unrendered `{{` template marker', () => {
    const result = validateQuestion(
      makeValidQuestion({ question_text: 'What is the value of {{variable}} in this reaction?' }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('template_marker');
  });

  it('rejects a `[BLANK]` template marker', () => {
    const result = validateQuestion(
      makeValidQuestion({ question_text: 'Photosynthesis occurs in the [BLANK] of the plant cell.' }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('template_marker');
  });

  it('rejects text shorter than MIN_QUESTION_TEXT_LENGTH', () => {
    const short = 'x'.repeat(MIN_QUESTION_TEXT_LENGTH - 1);
    expect(validateQuestion(makeValidQuestion({ question_text: short })).reason).toBe(
      'text_too_short',
    );
  });

  it('rejects missing / non-string text', () => {
    expect(validateQuestion(makeValidQuestion({ question_text: '' })).reason).toBe('empty_text');
    expect(validateQuestion(makeValidQuestion({ question_text: null })).reason).toBe('empty_text');
    expect(validateQuestion(makeValidQuestion({ question_text: 42 })).reason).toBe('empty_text');
  });

  it('rejects known content-free template openers', () => {
    const garbage = [
      'A student studying this chapter should focus on the following ideas.',
      'Which of the following best describes the main topic of this chapter?',
      'Why is this chapter important for grade 8 students to learn?',
      'The chapter on light is most closely related to which area of science?',
      'What is the primary purpose of studying this chapter in school?',
      'Pick the option about an unrelated topic from the following list.',
    ];
    for (const question_text of garbage) {
      const result = validateQuestion(makeValidQuestion({ question_text }));
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('garbage_text');
    }
  });

  it('rejects a null / non-object row outright', () => {
    expect(validateQuestion(null).reason).toBe('null_question');
    expect(validateQuestion(undefined).reason).toBe('null_question');
    expect(validateQuestion('a question').reason).toBe('null_question');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. Explanation — character floor AND word floor AND self-contradiction.
// ════════════════════════════════════════════════════════════════════════════

describe('P6 canonical validator: explanation', () => {
  it('rejects a missing or too-short explanation (< MIN_EXPLANATION_LENGTH chars)', () => {
    expect(validateQuestion(makeValidQuestion({ explanation: '' })).reason).toBe('weak_explanation');
    expect(validateQuestion(makeValidQuestion({ explanation: null })).reason).toBe(
      'weak_explanation',
    );
    expect(validateQuestion(makeValidQuestion({ explanation: 'Too short.' })).reason).toBe(
      'weak_explanation',
    );
  });

  it('rejects a long-but-terse explanation below MIN_EXPLANATION_WORDS', () => {
    // 7 words, comfortably over the 20-CHARACTER floor — only the WORD floor
    // catches it. This is the check that broke the domain-quiz fixture.
    const sevenWords = 'Mitochondria produce adenosine triphosphate via oxidative phosphorylation.';
    expect(sevenWords.trim().split(/\s+/).length).toBe(MIN_EXPLANATION_WORDS - 1);
    expect(sevenWords.length).toBeGreaterThan(MIN_EXPLANATION_LENGTH);

    const result = validateQuestion(makeValidQuestion({ explanation: sevenWords }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('terse_explanation');
  });

  it('accepts an explanation at exactly MIN_EXPLANATION_WORDS (boundary is inclusive)', () => {
    const eightWords = 'Mitochondria make cellular energy by running oxidative phosphorylation';
    expect(eightWords.trim().split(/\s+/).length).toBe(MIN_EXPLANATION_WORDS);
    expect(validateQuestion(makeValidQuestion({ explanation: eightWords }))).toEqual({
      valid: true,
    });
  });

  it('rejects a self-contradicting explanation (the model disputes its own answer key)', () => {
    const result = validateQuestion(
      makeValidQuestion({
        explanation:
          'The computed value does not match any option, so we selected the nearest available choice.',
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unreliable_explanation');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. `allowNonMcq` — relaxes MCQ SHAPE only. It relaxes NO quality check.
//
//    This axis is deliberately not unioned across the former copies, because
//    quiz-assembler (live path) must keep serving short/long-answer types
//    while supabase.ts / domains/quiz.ts must keep rejecting them. The danger
//    is that the flag quietly becomes a general "be lenient" switch — these
//    tests pin that it is not. (Bloom validity is NOT in the table below: it is
//    no longer a default quality check — it has its own opt-in axis,
//    `enforceBloomLevel`, pinned in section 3 and composed with this flag in
//    the last test of this block.)
// ════════════════════════════════════════════════════════════════════════════

describe('P6 canonical validator: allowNonMcq relaxes SHAPE only', () => {
  function makeShortAnswer(overrides: Record<string, unknown> = {}) {
    return {
      id: 'sa-1',
      question_text: 'Explain in two sentences why mitochondria are called the powerhouse.',
      question_type_v2: 'short_answer',
      expected_answer: 'They synthesise ATP, the cell energy currency.',
      explanation:
        'A complete answer names ATP synthesis by oxidative phosphorylation as the reason for the nickname.',
      bloom_level: 'understand',
      difficulty: 2,
      ...overrides,
    };
  }

  it('a short-answer row (no options, no answer index) is REJECTED by default', () => {
    const result = validateQuestion(makeShortAnswer());
    expect(result.valid).toBe(false);
    // The MCQ shape contract applies unconditionally when the flag is off.
    expect(result.reason).toBe('0_options');
  });

  it('the same short-answer row is ACCEPTED with allowNonMcq: true', () => {
    expect(validateQuestion(makeShortAnswer(), { allowNonMcq: true })).toEqual({ valid: true });
  });

  it('allowNonMcq still requires SOMETHING for the grader to mark against', () => {
    const result = validateQuestion(
      makeShortAnswer({ expected_answer: '', explanation: 'Short.' }),
      { allowNonMcq: true },
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing_expected_answer');
  });

  it('allowNonMcq does NOT relax MCQ shape for rows that declare themselves mcq', () => {
    // The flag selects WHICH shape contract applies — it does not disable the
    // MCQ one. A null answer key on an mcq row is still a rejection.
    expect(
      validateQuestion(makeValidQuestion({ correct_answer_index: null }), { allowNonMcq: true })
        .reason,
    ).toBe('missing_answer_index');
    expect(
      validateQuestion(makeValidQuestion({ options: ['A', 'B', 'C'] }), { allowNonMcq: true })
        .reason,
    ).toBe('3_options');
    expect(
      validateQuestion(
        makeValidQuestion({ options: ['Nucleus', 'Mitochondrion', 'Ribosome', 'Nucleus'] }),
        { allowNonMcq: true },
      ).reason,
    ).toBe('duplicate_options');
  });

  it('allowNonMcq relaxes NO quality check — every one still rejects a non-MCQ row', () => {
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
      [
        'template marker',
        { question_text: 'Explain why {{organelle}} is called the powerhouse of the cell.' },
        'template_marker',
      ],
      [
        'garbage opener',
        { question_text: 'What is the primary purpose of studying this chapter in school?' },
        'garbage_text',
      ],
      ['text too short', { question_text: 'Explain why.' }, 'text_too_short'],
      [
        'explanation below the character floor',
        { expected_answer: 'ATP synthesis happens there.', explanation: 'ATP.' },
        'weak_explanation',
      ],
      [
        'explanation below the word floor',
        { explanation: 'Mitochondria produce adenosine triphosphate via oxidative phosphorylation.' },
        'terse_explanation',
      ],
      [
        'self-contradicting explanation',
        {
          explanation:
            'None of the options is correct here, so we picked the closest plausible wording available.',
        },
        'unreliable_explanation',
      ],
    ];

    for (const [label, overrides, expectedReason] of cases) {
      const result = validateQuestion(makeShortAnswer(overrides), { allowNonMcq: true });
      expect(result.valid, `${label} must still be rejected under allowNonMcq`).toBe(false);
      expect(result.reason, `${label} rejection reason`).toBe(expectedReason);
    }
  });

  it('bloom stays opt-in under allowNonMcq, and the two flags compose', () => {
    // allowNonMcq alone does not smuggle bloom enforcement in (default OFF
    // holds regardless of the shape flag)…
    expect(
      validateQuestion(makeShortAnswer({ bloom_level: 'analyse' }), { allowNonMcq: true }),
    ).toEqual({ valid: true });

    // …and allowNonMcq does not DISABLE an explicitly requested bloom check.
    const composed = [
      ['non-canonical bloom', { bloom_level: 'analyse' }],
      ['missing bloom', { bloom_level: undefined }],
    ] as const;
    for (const [label, overrides] of composed) {
      const result = validateQuestion(makeShortAnswer(overrides), {
        allowNonMcq: true,
        enforceBloomLevel: true,
      });
      expect(result.valid, `${label} must be rejected when enforceBloomLevel is on`).toBe(false);
      expect(result.reason, `${label} rejection reason`).toBe('invalid_bloom_level');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 7. validateQuestions — batch filter + within-batch dedupe.
// ════════════════════════════════════════════════════════════════════════════

describe('P6 canonical validator: validateQuestions batch', () => {
  it('drops invalid rows and keeps valid ones, preserving order', () => {
    const batch = [
      makeValidQuestion({ id: 'a', question_text: 'Which organelle synthesises ATP in a cell?' }),
      makeValidQuestion({ id: 'bad', question_text: 'Which organelle has {{marker}} inside it?' }),
      makeValidQuestion({ id: 'b', question_text: 'Which organelle assembles proteins in a cell?' }),
    ];
    const out = validateQuestions(batch);
    expect(out.map((q) => q.id)).toEqual(['a', 'b']);
  });

  it('deduplicates by normalised question_text, first occurrence wins', () => {
    const text = 'Which organelle is responsible for photosynthesis in a plant cell?';
    const batch = [
      makeValidQuestion({ id: 'first', question_text: text }),
      makeValidQuestion({ id: 'second', question_text: `  ${text.toUpperCase()}  ` }),
      makeValidQuestion({ id: 'third', question_text: text }),
    ];
    const out = validateQuestions(batch);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('first');
  });

  it('returns an empty array when every row is invalid (never throws)', () => {
    // NOTE: a variant bloom_level is NOT an invalid row under default options
    // any more (enforceBloomLevel defaults OFF) — the third element must be
    // invalid on a check that is on by default.
    const batch = [
      makeValidQuestion({ correct_answer_index: null }),
      makeValidQuestion({ options: ['A', 'B', 'C'] }),
      makeValidQuestion({ explanation: 'Too short.' }),
    ];
    expect(validateQuestions(batch)).toEqual([]);
  });

  it('handles an empty batch', () => {
    expect(validateQuestions([])).toEqual([]);
  });

  it('forwards allowNonMcq to the per-question gate', () => {
    const shortAnswer = {
      id: 'sa',
      question_text: 'Describe the role of chlorophyll in the light-dependent reactions.',
      question_type_v2: 'short_answer',
      expected_answer: 'It absorbs light energy to drive electron transport.',
      explanation:
        'Chlorophyll absorbs photons and passes excited electrons into the photosynthetic electron transport chain.',
      bloom_level: 'understand',
    };
    expect(validateQuestions([shortAnswer])).toEqual([]);
    expect(validateQuestions([shortAnswer], { allowNonMcq: true })).toHaveLength(1);
  });

  it('forwards enforceBloomLevel to the per-question gate', () => {
    // Distinct question_text on each row so the within-batch dedupe cannot be
    // the thing that drops a row and mask a forwarding failure.
    const batch = [
      makeValidQuestion({ id: 'canonical', bloom_level: 'apply' }),
      makeValidQuestion({
        id: 'variant',
        question_text: 'Which organelle packages proteins for secretion in a eukaryotic cell?',
        options: ['Nucleus', 'Mitochondrion', 'Ribosome', 'Golgi apparatus'],
        correct_answer_index: 3,
        bloom_level: 'analyse',
      }),
    ];
    // Default: bloom is not validated — both rows survive the batch.
    expect(validateQuestions(batch).map((q) => q.id)).toEqual(['canonical', 'variant']);
    // Flag on: the batch wrapper forwards it and the variant-bloom row is dropped.
    expect(validateQuestions(batch, { enforceBloomLevel: true }).map((q) => q.id)).toEqual([
      'canonical',
    ]);
  });

  it('does not mutate the input batch', () => {
    const batch = [makeValidQuestion({ id: 'keep' }), makeValidQuestion({ correct_answer_index: null })];
    const snapshot = JSON.stringify(batch);
    validateQuestions(batch);
    expect(JSON.stringify(batch)).toBe(snapshot);
    expect(batch).toHaveLength(2);
  });
});
