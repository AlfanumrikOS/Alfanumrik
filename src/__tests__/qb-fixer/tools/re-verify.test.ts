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

import { reVerifyTool, hashCandidate } from '@/lib/ai/agents/agents/fix-failed-questions/tools/re-verify';

const candidate = {
  question: 'Q?', options: ['a','b','c','d'] as [string,string,string,string],
  correct_answer_index: 1 as 0|1|2|3, explanation: 'E',
};
function mockBankRow() {
  return {
    select: () => ({
      eq: () => ({ single: async () => ({ data: { grade: '6', subject: 'math', chapter_title: 'Numbers' }, error: null }) }),
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
      answer: JSON.stringify({ verified: true, correct_option_index: 1, supporting_chunk_ids: ['c1'], reason: 'OK' }),
      abstain_reason: null,
    });
    const ctx = { userId: null, meta: {} as Record<string, unknown> };
    const out = await reVerifyTool.handler({ question_id: 'q1', candidate }, ctx);
    expect(out.verified).toBe(true);
    const expectedKey = `verified_q1_${hashCandidate(candidate)}`;
    expect(ctx.meta[expectedKey]).toBe(true);
  });

  it('on verified=false does NOT stamp ctx.meta', async () => {
    callGroundedAnswerMock.mockResolvedValueOnce({
      answer: JSON.stringify({ verified: false, correct_option_index: 2, supporting_chunk_ids: [], reason: 'wrong' }),
      abstain_reason: null,
    });
    const ctx = { userId: null, meta: {} as Record<string, unknown> };
    const out = await reVerifyTool.handler({ question_id: 'q1', candidate }, ctx);
    expect(out.verified).toBe(false);
    expect(Object.keys(ctx.meta)).toHaveLength(0);
  });

  it('on verified=true but mismatched index, does NOT stamp (verified must agree on index)', async () => {
    callGroundedAnswerMock.mockResolvedValueOnce({
      answer: JSON.stringify({ verified: true, correct_option_index: 3, supporting_chunk_ids: [], reason: 'index off' }),
      abstain_reason: null,
    });
    const ctx = { userId: null, meta: {} as Record<string, unknown> };
    const out = await reVerifyTool.handler({ question_id: 'q1', candidate }, ctx);
    expect(out.verified).toBe(false); // tool downgrades to false on index mismatch
    expect(Object.keys(ctx.meta)).toHaveLength(0);
  });

  it('throws on abstain', async () => {
    callGroundedAnswerMock.mockResolvedValueOnce({ answer: '', abstain_reason: 'circuit_open' });
    const ctx = { userId: null, meta: {} as Record<string, unknown> };
    await expect(reVerifyTool.handler({ question_id: 'q1', candidate }, ctx))
      .rejects.toThrow(/abstain|circuit_open/i);
  });
});
