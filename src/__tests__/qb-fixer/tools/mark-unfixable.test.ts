import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (t: string) => fromMock(t) },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { markUnfixableTool } from '@/lib/ai/agents/agents/fix-failed-questions/tools/mark-unfixable';

const updates: unknown[] = [];
const inserts: unknown[] = [];
function setup() {
  fromMock.mockImplementation((t: string) => {
    if (t === 'question_bank') {
      return { update: (p: unknown) => ({ eq: () => { updates.push(p); return Promise.resolve({ error: null }); } }) };
    }
    if (t === 'question_bank_fix_history') {
      return { insert: async (r: unknown) => { inserts.push(r); return { error: null }; } };
    }
    throw new Error('unexpected ' + t);
  });
}

beforeEach(() => {
  fromMock.mockReset();
  updates.length = 0;
  inserts.length = 0;
  setup();
});

describe('markUnfixableTool.handler', () => {
  it('UPDATEs verification_state to failed_unfixable and clears claim', async () => {
    const ctx = { userId: null, meta: {} as Record<string, unknown> };
    const out = await markUnfixableTool.handler({ question_id: 'q1', reason: 'no_chunks' }, ctx);
    expect(out).toEqual({ ok: true });
    expect(updates[0]).toMatchObject({
      verification_state: 'failed_unfixable',
      verification_claimed_by: null,
      verification_claim_expires_at: null,
    });
  });

  it('INSERTs history row with outcome=marked_unfixable and fix_strategy=unfixable', async () => {
    const ctx = { userId: null, meta: { regen_attempts: 2 } as Record<string, unknown> };
    await markUnfixableTool.handler({ question_id: 'q1', reason: 'regen_loop_exhausted' }, ctx);
    expect(inserts[0]).toMatchObject({
      question_id: 'q1',
      fix_strategy: 'unfixable',
      outcome: 'marked_unfixable',
      attempts: 2,
      prior_verifier_reason: 'regen_loop_exhausted',
    });
  });
});
