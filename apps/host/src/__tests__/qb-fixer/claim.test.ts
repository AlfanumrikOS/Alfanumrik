import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));
vi.mock('@alfanumrik/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { claimFailedBatch } from '@alfanumrik/lib/qb-fixer/claim';

beforeEach(() => rpcMock.mockReset());

describe('claimFailedBatch', () => {
  it('calls claim_fix_batch RPC with batch_size, claimed_by, ttl_seconds', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    await claimFailedBatch({ batchSize: 20, claimedBy: 'sweep-abc', ttlSeconds: 600 });
    expect(rpcMock).toHaveBeenCalledWith('claim_fix_batch', {
      p_batch_size: 20, p_claimed_by: 'sweep-abc', p_ttl_seconds: 600,
    });
  });

  it('maps RPC rows into FailedQuestion shape (verifier fields default null)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{
        id: 'q1', question_text: 'What is 2+2?', options: ['3','4','5','6'],
        correct_answer_index: 1, explanation: 'Because.',
        grade: '6', subject: 'mathematics', chapter_number: 1, chapter_title: 'Numbers',
      }],
      error: null,
    });
    const rows = await claimFailedBatch({ batchSize: 20, claimedBy: 'x', ttlSeconds: 600 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'q1',
      claimed_correct_index: 1,
      last_verifier_reason: null,
      last_verifier_correct_index: null,
    });
  });

  it('returns empty array on RPC error and logs', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const rows = await claimFailedBatch({ batchSize: 20, claimedBy: 'x', ttlSeconds: 600 });
    expect(rows).toEqual([]);
  });
});
