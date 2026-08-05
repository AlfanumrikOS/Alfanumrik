import { describe, it, expect } from 'vitest';
import { validateDraftQuestion } from '@alfanumrik/lib/teacher/draft-question-validator';

const good = {
  id: 'q',
  question_text: 'What is 2+2?',
  options: ['3', '4', '5', '6'],
  correct_answer_index: 1,
};

describe('validateDraftQuestion (K5 UX-only hint)', () => {
  it('accepts a well-formed question', () => {
    expect(validateDraftQuestion(good)).toBeNull();
  });
  it('rejects empty text', () => {
    expect(validateDraftQuestion({ ...good, question_text: '' })).toMatch(/empty/i);
  });
  it('rejects unfilled placeholders', () => {
    expect(validateDraftQuestion({ ...good, question_text: 'Fill {{x}}' })).toMatch(
      /placeholder/i,
    );
  });
  it('rejects wrong option count', () => {
    expect(validateDraftQuestion({ ...good, options: ['a', 'b', 'c'] })).toMatch(/4/);
  });
  it('rejects empty option', () => {
    expect(validateDraftQuestion({ ...good, options: ['a', 'b', '', 'd'] })).toMatch(
      /empty/i,
    );
  });
  it('rejects duplicate options', () => {
    expect(validateDraftQuestion({ ...good, options: ['a', 'a', 'b', 'c'] })).toMatch(
      /distinct/i,
    );
  });
  it('rejects out-of-range correct index', () => {
    expect(
      validateDraftQuestion({ ...good, correct_answer_index: 4 }),
    ).toMatch(/index/i);
  });
});
