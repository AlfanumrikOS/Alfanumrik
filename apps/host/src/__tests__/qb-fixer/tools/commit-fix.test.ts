import { describe, it, expect, vi, beforeEach } from 'vitest';

const validateCandidateMock = vi.fn();
vi.mock('@alfanumrik/lib/ai/validation/quiz-oracle', () => ({
  validateCandidate: (...args: unknown[]) => validateCandidateMock(...args),
}));
const fromMock = vi.fn();
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (t: string) => fromMock(t) },
}));
vi.mock('@alfanumrik/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { commitFixTool } from '@alfanumrik/lib/ai/agents/agents/fix-failed-questions/tools/commit-fix';
import { hashCandidate } from '@alfanumrik/lib/ai/agents/agents/fix-failed-questions/tools/re-verify';

const fixed = {
  question: 'Q', options: ['a','b','c','d'] as [string,string,string,string],
  correct_answer_index: 2 as 0|1|2|3, explanation: 'E',
};

const updates: unknown[] = [];
const inserts: unknown[] = [];
function setupMocks() {
  fromMock.mockImplementation((t: string) => {
    if (t === 'question_bank') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: {
              question_text: 'Old', options: ['o1','o2','o3','o4'],
              correct_answer_index: 1, explanation: 'OldE',
              verifier_failure_reason: 'Wrong index — should be 2',
            }, error: null }),
          }),
        }),
        update: (patch: unknown) => ({
          eq: () => { updates.push(patch); return Promise.resolve({ error: null }); },
        }),
      };
    }
    if (t === 'question_bank_fix_history') {
      return { insert: async (row: unknown) => { inserts.push(row); return { error: null }; } };
    }
    throw new Error('unexpected ' + t);
  });
}

beforeEach(() => {
  validateCandidateMock.mockReset();
  fromMock.mockReset();
  updates.length = 0;
  inserts.length = 0;
  setupMocks();
});

describe('commitFixTool.handler', () => {
  it('rejects when ctx.meta has no matching verified hash', async () => {
    validateCandidateMock.mockResolvedValueOnce({ ok: true, llm_calls: 0 });
    const ctx = { userId: null, meta: {} as Record<string, unknown> };
    await expect(
      commitFixTool.handler({ question_id: 'q1', fixed_question: fixed, fix_strategy: 'index_correction' }, ctx),
    ).rejects.toThrow(/re_verify|precondition|not.*verified/i);
  });

  it('rejects when validateCandidate returns ok=false (P11)', async () => {
    validateCandidateMock.mockResolvedValueOnce({ ok: false, category: 'p6_options_not_distinct', reason: 'dup', llm_calls: 0 });
    const ctx = { userId: null, meta: { [`verified_q1_${hashCandidate(fixed)}`]: true } as Record<string, unknown> };
    await expect(
      commitFixTool.handler({ question_id: 'q1', fixed_question: fixed, fix_strategy: 'full_regen' }, ctx),
    ).rejects.toThrow(/oracle|p6_|distinct/i);
  });

  it('on success: UPDATE row + INSERT history with prior values from question_bank.verifier_failure_reason', async () => {
    validateCandidateMock.mockResolvedValueOnce({ ok: true, llm_calls: 0 });
    const ctx = { userId: null, meta: { [`verified_q1_${hashCandidate(fixed)}`]: true } as Record<string, unknown> };
    const out = await commitFixTool.handler(
      { question_id: 'q1', fixed_question: fixed, fix_strategy: 'index_correction' }, ctx,
    );
    expect(out).toEqual({ ok: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      question_text: 'Q',
      correct_answer_index: 2,
      verification_state: 'verified',
      verified_against_ncert: true,
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      question_id: 'q1',
      fix_strategy: 'index_correction',
      prior_question_text: 'Old',
      prior_correct_answer_index: 1,
      prior_verifier_reason: 'Wrong index — should be 2',
      outcome: 'verified',
    });
  });
});
