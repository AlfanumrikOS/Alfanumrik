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
    id: 'q1', question_text: 'What is force?', options: ['a','b','c','d'], correct_answer_index: 1,
    explanation: 'E', grade: '9', subject: 'science', chapter_number: 6, chapter_title: 'How Forces Affect Motion',
  }));
});

describe('regenerateQuestionTool.handler', () => {
  it('builds the proper GroundedRequest shape and returns the candidate', async () => {
    callGroundedAnswerMock.mockResolvedValueOnce({
      grounded: true,
      answer: JSON.stringify({
        question_text: 'New Q', options: ['w','x','y','z'],
        correct_answer_index: 2, explanation: 'New E',
      }),
      citations: [], confidence: 0.9, trace_id: 't1',
      meta: { claude_model: 'haiku', tokens_used: 100, latency_ms: 200 },
    });
    const out = await regenerateQuestionTool.handler(
      { question_id: 'q1', fix_strategy: 'full_regen' }, ctx,
    );
    expect(out).toEqual({
      question: 'New Q', options: ['w','x','y','z'],
      correct_answer_index: 2, explanation: 'New E',
    });
    const req = callGroundedAnswerMock.mock.calls[0][0];
    expect(req.caller).toBe('quiz-generator');
    expect(req.scope.grade).toBe('9');
    expect(req.scope.subject_code).toBe('science');
    expect(req.scope.chapter_number).toBe(6);
    expect(req.generation.system_prompt_template).toBe('quiz_question_generator_v1');
    expect(req.generation.template_variables).toMatchObject({
      grade: '9', subject: 'science',
    });
    expect(req.generation.template_variables.chapter_suffix).toContain('ch.6');
    expect(req.query).toBe('What is force?');
  });

  it('tolerates either question or question_text key in generator output', async () => {
    callGroundedAnswerMock.mockResolvedValueOnce({
      grounded: true,
      answer: JSON.stringify({
        question: 'Alt key', options: ['w','x','y','z'],
        correct_answer_index: 0, explanation: 'Exp',
      }),
      citations: [], confidence: 0.9, trace_id: 't1',
      meta: { claude_model: 'haiku', tokens_used: 100, latency_ms: 200 },
    });
    const out = await regenerateQuestionTool.handler(
      { question_id: 'q1', fix_strategy: 'full_regen' }, ctx,
    );
    expect(out.question).toBe('Alt key');
  });

  it('throws when grounded-answer abstains (grounded=false)', async () => {
    callGroundedAnswerMock.mockResolvedValueOnce({
      grounded: false, abstain_reason: 'no_chunks_retrieved',
      suggested_alternatives: [], trace_id: 't1', meta: { latency_ms: 50 },
    });
    await expect(
      regenerateQuestionTool.handler({ question_id: 'q1', fix_strategy: 'full_regen' }, ctx),
    ).rejects.toThrow(/abstain|no_chunks/i);
  });

  it('throws when generator returns insufficient_source', async () => {
    callGroundedAnswerMock.mockResolvedValueOnce({
      grounded: true,
      answer: JSON.stringify({ error: 'insufficient_source' }),
      citations: [], confidence: 0.5, trace_id: 't1',
      meta: { claude_model: 'haiku', tokens_used: 50, latency_ms: 100 },
    });
    await expect(
      regenerateQuestionTool.handler({ question_id: 'q1', fix_strategy: 'full_regen' }, ctx),
    ).rejects.toThrow(/insufficient_source/i);
  });

  it('throws when answer JSON is malformed', async () => {
    callGroundedAnswerMock.mockResolvedValueOnce({
      grounded: true, answer: 'not json at all',
      citations: [], confidence: 0.5, trace_id: 't1',
      meta: { claude_model: 'haiku', tokens_used: 50, latency_ms: 100 },
    });
    await expect(
      regenerateQuestionTool.handler({ question_id: 'q1', fix_strategy: 'full_regen' }, ctx),
    ).rejects.toThrow(/parse|JSON/i);
  });
});
