import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (t: string) => fromMock(t) },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { readFailedQuestionTool } from '@/lib/ai/agents/agents/fix-failed-questions/tools/read-failed-question';

const ctx = { userId: null, meta: {} };

beforeEach(() => fromMock.mockReset());

function mockBankRow(row: unknown) {
  return {
    select: () => ({
      eq: () => ({
        single: async () => ({ data: row, error: null }),
      }),
    }),
  };
}

describe('readFailedQuestionTool.handler', () => {
  it('returns row data with verifier_failure_reason from question_bank', async () => {
    fromMock.mockImplementationOnce((t: string) => {
      expect(t).toBe('question_bank');
      return mockBankRow({
        id: 'q1', question_text: 'Q?', options: ['a','b','c','d'],
        correct_answer_index: 1, explanation: 'E', grade: '6', subject: 'math',
        chapter_number: 2, chapter_title: 'Ch2',
        verifier_failure_reason: 'Correct answer is option C (index 2)',
      });
    });

    const out = await readFailedQuestionTool.handler({ question_id: 'q1' }, ctx);
    expect(out).toMatchObject({
      id: 'q1',
      claimed_correct_index: 1,
      last_verifier_reason: 'Correct answer is option C (index 2)',
      last_verifier_correct_index: null, // not structurally stored
    });
  });

  it('returns null verifier_reason when verifier_failure_reason is null', async () => {
    fromMock.mockImplementationOnce(() => mockBankRow({
      id: 'q1', question_text: 'Q?', options: ['a','b','c','d'],
      correct_answer_index: 0, explanation: 'E', grade: '7', subject: 'science',
      chapter_number: null, chapter_title: null,
      verifier_failure_reason: null,
    }));

    const out = await readFailedQuestionTool.handler({ question_id: 'q1' }, ctx);
    expect(out.last_verifier_reason).toBeNull();
    expect(out.last_verifier_correct_index).toBeNull();
  });

  it('throws when question_bank row is missing', async () => {
    fromMock.mockImplementationOnce(() => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'not found' } }) }) }),
    }));
    await expect(readFailedQuestionTool.handler({ question_id: 'qX' }, ctx))
      .rejects.toThrow(/not found|missing/i);
  });
});
