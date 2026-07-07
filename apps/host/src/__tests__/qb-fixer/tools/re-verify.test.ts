import { describe, it, expect, vi, beforeEach } from 'vitest';

const callGroundedAnswerMock = vi.fn();
vi.mock('@alfanumrik/lib/ai/grounded-client', () => ({
  callGroundedAnswer: (...args: unknown[]) => callGroundedAnswerMock(...args),
}));
const fromMock = vi.fn();
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (t: string) => fromMock(t) },
}));
vi.mock('@alfanumrik/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { reVerifyTool, hashCandidate } from '@alfanumrik/lib/ai/agents/agents/fix-failed-questions/tools/re-verify';

const candidate = {
  question: 'Q?', options: ['a','b','c','d'] as [string,string,string,string],
  correct_answer_index: 1 as 0|1|2|3, explanation: 'E',
};
function mockBankRow() {
  return {
    select: () => ({
      eq: () => ({ single: async () => ({ data: { grade: '6', subject: 'math', chapter_number: 1, chapter_title: 'Numbers' }, error: null }) }),
    }),
  };
}

beforeEach(() => {
  callGroundedAnswerMock.mockReset();
  fromMock.mockReset();
  fromMock.mockImplementation(() => mockBankRow());
});

describe('reVerifyTool.handler', () => {
  it('on verified=true with matching index, stamps ctx.meta with verified hash', async () => {
    callGroundedAnswerMock.mockResolvedValueOnce({
      grounded: true,
      answer: JSON.stringify({ verified: true, correct_option_index: 1, supporting_chunk_ids: ['c1'], reason: 'OK' }),
      citations: [], confidence: 0.95, trace_id: 't1',
      meta: { claude_model: 'haiku', tokens_used: 100, latency_ms: 200 },
    });
    const ctx = { userId: null, meta: {} as Record<string, unknown> };
    const out = await reVerifyTool.handler({ question_id: 'q1', candidate }, ctx);
    expect(out.verified).toBe(true);
    const expectedKey = `verified_q1_${hashCandidate(candidate)}`;
    expect(ctx.meta[expectedKey]).toBe(true);

    const req = callGroundedAnswerMock.mock.calls[0][0];
    expect(req.generation.system_prompt_template).toBe('quiz_answer_verifier_v1');
    expect(req.generation.template_variables.question_json).toContain('"claimed_correct_index":1');
  });

  it('on verified=false does NOT stamp ctx.meta', async () => {
    callGroundedAnswerMock.mockResolvedValueOnce({
      grounded: true,
      answer: JSON.stringify({ verified: false, correct_option_index: 2, supporting_chunk_ids: [], reason: 'wrong' }),
      citations: [], confidence: 0.6, trace_id: 't1',
      meta: { claude_model: 'haiku', tokens_used: 100, latency_ms: 200 },
    });
    const ctx = { userId: null, meta: {} as Record<string, unknown> };
    const out = await reVerifyTool.handler({ question_id: 'q1', candidate }, ctx);
    expect(out.verified).toBe(false);
    expect(Object.keys(ctx.meta)).toHaveLength(0);
  });

  it('on verified=true but mismatched index, does NOT stamp', async () => {
    callGroundedAnswerMock.mockResolvedValueOnce({
      grounded: true,
      answer: JSON.stringify({ verified: true, correct_option_index: 3, supporting_chunk_ids: [], reason: 'index off' }),
      citations: [], confidence: 0.6, trace_id: 't1',
      meta: { claude_model: 'haiku', tokens_used: 100, latency_ms: 200 },
    });
    const ctx = { userId: null, meta: {} as Record<string, unknown> };
    const out = await reVerifyTool.handler({ question_id: 'q1', candidate }, ctx);
    expect(out.verified).toBe(false);
    expect(Object.keys(ctx.meta)).toHaveLength(0);
  });

  it('throws on abstain (grounded=false)', async () => {
    callGroundedAnswerMock.mockResolvedValueOnce({
      grounded: false, abstain_reason: 'circuit_open',
      suggested_alternatives: [], trace_id: 't1', meta: { latency_ms: 50 },
    });
    const ctx = { userId: null, meta: {} as Record<string, unknown> };
    await expect(reVerifyTool.handler({ question_id: 'q1', candidate }, ctx))
      .rejects.toThrow(/abstain|circuit_open/i);
  });
});
