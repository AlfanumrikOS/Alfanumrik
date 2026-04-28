/**
 * Unit tests for scripts/audit-question-quality.ts.
 *
 * Asserts:
 *   - the question_bank query shape (P13: only the columns we audit)
 *   - auditQuestion() flags every quality gate the docstring promises
 *   - findDuplicates() detects same-text duplicates
 *   - generateReport() produces the expected high-level shape
 *
 * Live-DB exercise is left to the nightly content-quality workflow.
 */
import { describe, it, expect } from 'vitest';
import {
  auditQuestion,
  findDuplicates,
  generateReport,
  QUERY_SHAPES,
  type QuestionRow,
} from '../../scripts/audit-question-quality';

function makeQuestion(overrides: Partial<QuestionRow> = {}): QuestionRow {
  return {
    id: 'q-1',
    subject: 'math',
    grade: '10',
    chapter_number: 1,
    chapter_title: 'Real Numbers',
    topic: 'HCF',
    question_text: 'What is the HCF of 12 and 18 using the Euclidean algorithm?',
    question_hi: 'यूक्लिडियन एल्गोरिथम का उपयोग करके 12 और 18 का HCF क्या है?',
    question_type: 'mcq',
    options: ['6', '12', '18', '36'],
    correct_answer_index: 0,
    explanation: 'Apply the Euclidean algorithm: 18 = 12*1 + 6, then 12 = 6*2 + 0. HCF is 6.',
    explanation_hi: null,
    hint: null,
    difficulty: 2,
    bloom_level: 'apply',
    is_active: true,
    source: 'NCERT',
    board_year: null,
    topic_id: null,
    content_status: 'published',
    ...overrides,
  };
}

describe('audit-question-quality — query shape', () => {
  it('reads from question_bank with the documented column set', () => {
    expect(QUERY_SHAPES.question_bank.table).toBe('question_bank');
    expect(QUERY_SHAPES.question_bank.select).toContain('id');
    expect(QUERY_SHAPES.question_bank.select).toContain('correct_answer_index');
    expect(QUERY_SHAPES.question_bank.select).toContain('options');
    expect(QUERY_SHAPES.question_bank.select).toContain('bloom_level');
    expect(QUERY_SHAPES.question_bank.select).toContain('difficulty');
    expect(QUERY_SHAPES.question_bank.select).toContain('explanation');
  });

  it('does not select PII-bearing columns (P13)', () => {
    const sel = QUERY_SHAPES.question_bank.select;
    expect(sel).not.toMatch(/student_id|user_id|email|phone|name\b/i);
  });
});

describe('auditQuestion — quality gates', () => {
  it('passes a clean question with no failure reasons', () => {
    expect(auditQuestion(makeQuestion())).toEqual([]);
  });

  it('flags correct_answer_index outside 0..3', () => {
    expect(auditQuestion(makeQuestion({ correct_answer_index: 4 }))).toContain(
      'invalid_answer_index',
    );
    expect(auditQuestion(makeQuestion({ correct_answer_index: -1 }))).toContain(
      'invalid_answer_index',
    );
  });

  it('flags duplicate options within same question', () => {
    const reasons = auditQuestion(
      makeQuestion({ options: ['6', '6', '6', '36'] }),
    );
    expect(reasons).toContain('fewer_than_3_distinct_options');
  });

  it('flags missing bloom_level via empty bloom_level (informational, not a failure)', () => {
    // Spec note: bloom_level is checked for VALIDITY, not presence — null is allowed.
    // We assert that an unknown value is flagged.
    expect(auditQuestion(makeQuestion({ bloom_level: 'memorize' }))).toContain(
      'invalid_bloom_level',
    );
  });

  it('flags explanation length < 20 chars', () => {
    const reasons = auditQuestion(makeQuestion({ explanation: 'short.' }));
    expect(reasons).toContain('short_explanation');
  });

  it('flags missing explanation', () => {
    const reasons = auditQuestion(makeQuestion({ explanation: null }));
    expect(reasons).toContain('missing_explanation');
  });

  it('flags wrong number of options', () => {
    const reasons = auditQuestion(
      makeQuestion({ options: ['a', 'b', 'c'] }),
    );
    expect(reasons).toContain('not_four_options');
  });

  it('flags template markers in question_text', () => {
    expect(
      auditQuestion(makeQuestion({ question_text: 'What is {{topic}}?' })),
    ).toContain('template_marker');
  });

  it('flags out-of-range difficulty', () => {
    expect(auditQuestion(makeQuestion({ difficulty: 5 }))).toContain(
      'invalid_difficulty',
    );
  });
});

describe('findDuplicates', () => {
  it('returns empty map when all questions are unique', () => {
    const qs = [
      makeQuestion({ id: '1', question_text: 'What is 2+2?' }),
      makeQuestion({ id: '2', question_text: 'What is 3+3?' }),
    ];
    expect(findDuplicates(qs).size).toBe(0);
  });

  it('groups questions with identical text (case + whitespace insensitive)', () => {
    const qs = [
      makeQuestion({ id: '1', question_text: 'What is the HCF of 12 and 18?' }),
      makeQuestion({ id: '2', question_text: '  what is the hcf of 12 and 18? ' }),
      makeQuestion({ id: '3', question_text: 'WHAT IS THE HCF OF 12 AND 18?' }),
      makeQuestion({ id: '4', question_text: 'Different question entirely?' }),
    ];
    const dupes = findDuplicates(qs);
    expect(dupes.size).toBe(1);
    const ids = Array.from(dupes.values())[0];
    expect(ids).toHaveLength(3);
    expect(ids).toEqual(expect.arrayContaining(['1', '2', '3']));
  });
});

describe('generateReport', () => {
  it('returns zeroed report for empty input (dry-run mode)', () => {
    const r = generateReport([]);
    expect(r.total).toBe(0);
    expect(r.passAll).toBe(0);
    expect(r.passRate).toBe(0);
    expect(Object.keys(r.coverageByGrade)).toHaveLength(0);
  });

  it('counts active vs inactive questions', () => {
    const r = generateReport([
      makeQuestion({ id: 'a', is_active: true }),
      makeQuestion({ id: 'b', is_active: false }),
    ]);
    expect(r.active).toBe(1);
    expect(r.inactive).toBe(1);
    expect(r.total).toBe(2);
  });

  it('reports passRate=100 when all questions are clean', () => {
    const r = generateReport([
      makeQuestion({ id: 'a' }),
      makeQuestion({ id: 'b', question_text: 'What is 5 multiplied by 7 in arithmetic?' }),
    ]);
    expect(r.passAll).toBe(2);
    expect(r.passRate).toBe(100);
  });
});
