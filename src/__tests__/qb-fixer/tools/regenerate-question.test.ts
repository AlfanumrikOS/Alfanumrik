import { describe, it, expect, vi, beforeEach } from 'vitest';

const callGroundedAnswerMock = vi.fn();
vi.mock('@/lib/ai/grounded-client', () => ({
  callGroundedAnswer: (...args: unknown[]) => callGroundedAnswerMock(...args),
}));
const fromMock = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (t: string) => fromMock(t) },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { regenerateQuestionTool } from '@/lib/ai/agents/agents/fix-failed-questions/tools/regenerate-question';

const ctx = { userId: null, meta: {} };

function mockQuestionBankRow(row: unknown) {
  return { select: () => ({ eq: () => ({ single: async () => ({ data: row, error: null }) }) }) };
}

beforeEach(() => {
  callGroundedAnswerMock.mockReset();
  fromMock.mockReset();
  fromMock.mockImplementation(() => mockQuestionBankRow({
    id: 'q1', question_text: 'Q', options: ['a','b','c','d'], correct_answer_index: 1,
    explanation: 'E', grade: '6', subject: 'mathematics', chapter_number: 2, chapter_title: 'Numbers',
  }));
});

describe('regenerateQuestionTool.handler', () => {
  it('passes the strategy and hint into a structured prompt', async () => {
    callGroundedAnswerMock.mockResolvedValueOnce({
      answer: JSON.stringify({
        question: 'New Q', options: ['w','x','y','z'],
        correct_answer_index: 2, explanation: 'New E',
      }),
      abstain_reason: null,
    });
    const out = await regenerateQuestionTool.handler(
      { question_id: 'q1', fix_strategy: 'index_correction', hint: '2' }, ctx,
    );
    expect(out).toEqual({
      question: 'New Q', options: ['w','x','y','z'],
      correct_answer_index: 2, explanation: 'New E',
    });
    const call = callGroundedAnswerMock.mock.calls[0][0];
    expect(call.template).toBe('quiz_question_generator_v1');
    expect(call.query).toContain('index_correction');
    expect(call.query).toContain('2');
  });

  it('throws when grounded-answer abstains', async () => {
    callGroundedAnswerMock.mockResolvedValueOnce({
      answer: '', abstain_reason: 'no_chunks_retrieved',
    });
    await expect(
      regenerateQuestionTool.handler({ question_id: 'q1', fix_strategy: 'full_regen' }, ctx),
    ).rejects.toThrow(/abstain|no_chunks/i);
  });

  it('throws when answer JSON is malformed', async () => {
    callGroundedAnswerMock.mockResolvedValueOnce({
      answer: 'not json at all', abstain_reason: null,
    });
    await expect(
      regenerateQuestionTool.handler({ question_id: 'q1', fix_strategy: 'full_regen' }, ctx),
    ).rejects.toThrow(/parse|JSON/i);
  });
});
