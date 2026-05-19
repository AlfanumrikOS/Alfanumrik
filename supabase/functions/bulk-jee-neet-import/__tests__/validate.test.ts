// supabase/functions/bulk-jee-neet-import/__tests__/validate.test.ts
//
// Deno test runner (not Vitest). Run via:
//   cd supabase/functions/bulk-jee-neet-import && deno test --allow-all
//
// Covers the pure validation helpers in `../validate.ts`. No I/O, no Supabase
// calls — all assertions are deterministic.

import {
  assert,
  assertEquals,
  assertExists,
  assertStrictEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  ALLOWED_EXAM_FAMILIES,
  ALLOWED_PAPER_PATTERNS,
  ALLOWED_SUBJECTS_BY_EXAM_FAMILY,
  mapSourceType,
  validateBatchSize,
  validatePaper,
  validateQuestion,
  type PaperInput,
} from '../validate.ts';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function validPaper(overrides: Partial<PaperInput> = {}): PaperInput {
  return {
    paper_code: 'jee_main_jan_2024_s1',
    exam_family: 'jee_main',
    paper_pattern: 'mcq_single',
    exam_year: 2024,
    exam_month: 1,
    subject_scope: ['physics', 'chemistry', 'math'],
    total_questions: 1,
    marking_scheme: { correct: 4, wrong: -1, unanswered: 0 },
    ...overrides,
  };
}

function validQuestion(overrides: Record<string, unknown> = {}) {
  return {
    question_text:
      'A particle moves with uniform acceleration. Find its displacement after 5 s.',
    options: ['10 m', '20 m', '25 m', '30 m'],
    correct_answer_index: 2,
    explanation: 'Using s = ut + 0.5*a*t^2 with u=0 and a=2, s = 25 m.',
    subject: 'physics',
    grade: '11',
    difficulty: 3,
    bloom_level: 'apply',
    ...overrides,
  };
}

// ─── Happy path ──────────────────────────────────────────────────────────────

Deno.test('validatePaper + validateQuestion: valid paper + 1-question batch passes', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok, 'expected paper to validate');
  const qResult = validateQuestion(validQuestion(), 0, paperResult.paper);
  assert(qResult.ok, 'expected question to validate');
});

// ─── P6: question text ───────────────────────────────────────────────────────

Deno.test('rejects p6_text_empty_or_placeholder when question_text contains {{', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ question_text: 'Find {{value}} of x.' }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'p6_text_empty_or_placeholder');
});

Deno.test('rejects p6_text_too_short when question_text length <= 10', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ question_text: 'Short?' }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'p6_text_too_short');
});

// ─── P6: options ─────────────────────────────────────────────────────────────

Deno.test('rejects p6_options_not_4 when options.length !== 4', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ options: ['A', 'B', 'C'] }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'p6_options_not_4');
});

Deno.test('rejects p6_options_empty when an option is an empty string', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ options: ['A', '', 'C', 'D'] }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'p6_options_empty');
});

Deno.test('rejects p6_options_not_distinct when duplicate options (case-insensitive)', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ options: ['Yes', 'no', 'YES', 'maybe'] }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'p6_options_not_distinct');
});

// ─── P6: correct_answer_index ────────────────────────────────────────────────

Deno.test('rejects p6_correct_index_out_of_range when correct_answer_index = 4', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ correct_answer_index: 4 }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'p6_correct_index_out_of_range');
});

// ─── P6: explanation ─────────────────────────────────────────────────────────

Deno.test('rejects p6_explanation_empty when explanation is whitespace-only', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ explanation: '   ' }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'p6_explanation_empty');
});

// ─── P6: difficulty / bloom_level ────────────────────────────────────────────

Deno.test('rejects p6_invalid_difficulty when difficulty = 6', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ difficulty: 6 }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'p6_invalid_difficulty');
});

Deno.test('rejects p6_invalid_bloom when bloom_level is not in the allowlist', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ bloom_level: 'memorize' }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'p6_invalid_bloom');
});

// ─── P5: grade ───────────────────────────────────────────────────────────────

Deno.test('rejects p5_invalid_grade when grade = "5" (out of band)', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ grade: '5' }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'p5_invalid_grade');
});

Deno.test('rejects p5_invalid_grade when grade is an integer (P5: must be string)', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ grade: 11 }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'p5_invalid_grade');
});

// ─── Subject × exam_family matrix ────────────────────────────────────────────

Deno.test('rejects invalid_subject_for_family when NEET paper has subject=math', () => {
  const paperResult = validatePaper(validPaper({ exam_family: 'neet' }), 1);
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ subject: 'math' }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'invalid_subject_for_family');
});

Deno.test('rejects invalid_subject_for_family when olympiad_phy paper has subject=biology', () => {
  const paperResult = validatePaper(
    validPaper({ exam_family: 'olympiad_phy', subject_scope: ['physics'] }),
    1,
  );
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ subject: 'biology' }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'invalid_subject_for_family');
});

Deno.test('accepts NEET paper with subject=biology', () => {
  const paperResult = validatePaper(
    validPaper({ exam_family: 'neet', subject_scope: ['biology'] }),
    1,
  );
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ subject: 'biology' }),
    0,
    paperResult.paper,
  );
  assert(result.ok);
});

// ─── paper_pattern (per question override) ───────────────────────────────────

Deno.test('rejects invalid_paper_pattern when per-question paper_pattern is unknown', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ paper_pattern: 'fill_in_the_blank' }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'invalid_paper_pattern');
});

// ─── Marks ───────────────────────────────────────────────────────────────────

Deno.test('rejects invalid_marks when marks_correct = 999', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ marks_correct: 999 }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'invalid_marks');
});

Deno.test('rejects invalid_marks when marks_wrong = NaN', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ marks_wrong: NaN }),
    0,
    paperResult.paper,
  );
  assert(!result.ok);
  assertEquals(result.rejection.code, 'invalid_marks');
});

// ─── Inheritance from paper-level defaults ───────────────────────────────────

Deno.test('inherits paper_pattern from paper when question omits it', () => {
  const paperResult = validatePaper(validPaper({ paper_pattern: 'integer' }), 1);
  assert(paperResult.ok);
  const result = validateQuestion(validQuestion(), 0, paperResult.paper);
  assert(result.ok);
  assertEquals(result.q.paper_pattern, 'integer');
});

Deno.test('inherits marks_correct + marks_wrong from paper.marking_scheme when question omits them', () => {
  const paperResult = validatePaper(
    validPaper({ marking_scheme: { correct: 4, wrong: -1, unanswered: 0 } }),
    1,
  );
  assert(paperResult.ok);
  const result = validateQuestion(validQuestion(), 0, paperResult.paper);
  assert(result.ok);
  assertStrictEquals(result.q.marks_correct, 4);
  assertStrictEquals(result.q.marks_wrong, -1);
});

Deno.test('question-level marks override paper.marking_scheme', () => {
  const paperResult = validatePaper(
    validPaper({ marking_scheme: { correct: 4, wrong: -1, unanswered: 0 } }),
    1,
  );
  assert(paperResult.ok);
  const result = validateQuestion(
    validQuestion({ marks_correct: 2, marks_wrong: 0 }),
    0,
    paperResult.paper,
  );
  assert(result.ok);
  assertStrictEquals(result.q.marks_correct, 2);
  assertStrictEquals(result.q.marks_wrong, 0);
});

Deno.test('defaults difficulty=3 and bloom_level=apply when absent', () => {
  const paperResult = validatePaper(validPaper(), 1);
  assert(paperResult.ok);
  const question = validQuestion();
  delete (question as Record<string, unknown>).difficulty;
  delete (question as Record<string, unknown>).bloom_level;
  const result = validateQuestion(question, 0, paperResult.paper);
  assert(result.ok);
  assertStrictEquals(result.q.difficulty, 3);
  assertStrictEquals(result.q.bloom_level, 'apply');
});

// ─── source_type auto-mapping ────────────────────────────────────────────────

Deno.test('mapSourceType: jee_main → jee_archive', () => {
  assertEquals(mapSourceType('jee_main'), 'jee_archive');
});

Deno.test('mapSourceType: jee_advanced → jee_archive', () => {
  assertEquals(mapSourceType('jee_advanced'), 'jee_archive');
});

Deno.test('mapSourceType: neet → neet_archive', () => {
  assertEquals(mapSourceType('neet'), 'neet_archive');
});

Deno.test('mapSourceType: every olympiad_* family → olympiad', () => {
  for (const fam of [
    'olympiad_phy',
    'olympiad_chem',
    'olympiad_math',
    'olympiad_bio',
    'olympiad_astro',
    'olympiad_info',
  ]) {
    assertEquals(mapSourceType(fam), 'olympiad', `family=${fam}`);
  }
});

Deno.test('mapSourceType: cbse_board → board_paper', () => {
  assertEquals(mapSourceType('cbse_board'), 'board_paper');
});

Deno.test('mapSourceType: kvpy/nsep/nstse/ntse → pyq fallback', () => {
  for (const fam of ['kvpy', 'nsep', 'nsec', 'nsejs', 'nstse', 'nso', 'imo', 'ntse']) {
    assertEquals(mapSourceType(fam), 'pyq', `family=${fam}`);
  }
});

// ─── paper_code regex ────────────────────────────────────────────────────────

Deno.test('validatePaper rejects paper_code with spaces', () => {
  const result = validatePaper(validPaper({ paper_code: 'jee main 2024' }), 1);
  assert(!result.ok);
  assertEquals(result.field, 'paper.paper_code');
});

Deno.test('validatePaper rejects paper_code with uppercase letters', () => {
  const result = validatePaper(validPaper({ paper_code: 'JEE_MAIN_2024' }), 1);
  assert(!result.ok);
  assertEquals(result.field, 'paper.paper_code');
});

Deno.test('validatePaper rejects paper_code with special chars', () => {
  const result = validatePaper(validPaper({ paper_code: 'jee-main-2024' }), 1);
  assert(!result.ok);
  assertEquals(result.field, 'paper.paper_code');
});

Deno.test('validatePaper accepts paper_code with snake_case lowercase digits', () => {
  const result = validatePaper(validPaper({ paper_code: 'neet_2024_phase_1' }), 1);
  assert(result.ok);
});

// ─── Paper-level field rejections ────────────────────────────────────────────

Deno.test('validatePaper rejects unknown exam_family', () => {
  const result = validatePaper(validPaper({ exam_family: 'cat' }), 1);
  assert(!result.ok);
  assertEquals(result.field, 'paper.exam_family');
});

Deno.test('validatePaper rejects exam_year < 1990', () => {
  const result = validatePaper(validPaper({ exam_year: 1989 }), 1);
  assert(!result.ok);
  assertEquals(result.field, 'paper.exam_year');
});

Deno.test('validatePaper rejects exam_month = 13', () => {
  const result = validatePaper(validPaper({ exam_month: 13 }), 1);
  assert(!result.ok);
  assertEquals(result.field, 'paper.exam_month');
});

Deno.test('validatePaper rejects empty subject_scope', () => {
  const result = validatePaper(validPaper({ subject_scope: [] }), 1);
  assert(!result.ok);
  assertEquals(result.field, 'paper.subject_scope');
});

Deno.test('validatePaper warns when total_questions does not match questions.length', () => {
  const result = validatePaper(validPaper({ total_questions: 90 }), 1);
  assert(result.ok);
  assert(result.warnings.length === 1);
});

Deno.test('validatePaper rejects malformed marking_scheme.correct', () => {
  // deno-lint-ignore no-explicit-any
  const result = validatePaper(
    // deno-lint-ignore no-explicit-any
    { ...validPaper(), marking_scheme: { correct: 'four' as any, wrong: -1 } as any },
    1,
  );
  assert(!result.ok);
  assertEquals(result.field, 'paper.marking_scheme.correct');
});

// ─── Batch size ──────────────────────────────────────────────────────────────

Deno.test('validateBatchSize rejects empty array', () => {
  const result = validateBatchSize([]);
  assert(!result.ok);
});

Deno.test('validateBatchSize rejects > 200 items', () => {
  const result = validateBatchSize(new Array(201).fill({}));
  assert(!result.ok);
});

Deno.test('validateBatchSize accepts boundary sizes (1 and 200)', () => {
  const min = validateBatchSize(new Array(1).fill({}));
  assert(min.ok);
  const max = validateBatchSize(new Array(200).fill({}));
  assert(max.ok);
});

Deno.test('validateBatchSize rejects non-array input', () => {
  const result = validateBatchSize({} as unknown);
  assert(!result.ok);
});

// ─── Allowed exam-family / pattern constants are exported ────────────────────

Deno.test('exam_family allowlist includes all 18 families', () => {
  assertEquals(ALLOWED_EXAM_FAMILIES.length, 18);
});

Deno.test('paper_pattern allowlist includes all 8 patterns', () => {
  assertEquals(ALLOWED_PAPER_PATTERNS.length, 8);
});

Deno.test('ALLOWED_SUBJECTS_BY_EXAM_FAMILY has an entry for every exam_family', () => {
  for (const fam of ALLOWED_EXAM_FAMILIES) {
    assertExists(
      ALLOWED_SUBJECTS_BY_EXAM_FAMILY[fam],
      `missing subject allowlist for ${fam}`,
    );
  }
});
