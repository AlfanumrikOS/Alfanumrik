/**
 * awardXpCapped helper — the never-throwing wrapper around the
 * service-role-only `award_xp_capped` RPC (Foxy North-Star Phase 3).
 *
 * Pins:
 *   - exact RPC name + p_* parameter mapping (architect FIXED contract)
 *   - returns the effective amount the RPC reports
 *   - never throws / rejects: RPC error → null, thrown error → null
 *   - default metadata {} when none passed
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { awardXpCapped } from '@alfanumrik/lib/xp-award';
import { logger } from '@alfanumrik/lib/logger';

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const rpcMock = vi.fn();
const client = { rpc: rpcMock } as unknown as SupabaseClient;

const OPTS = {
  studentId: '00000000-0000-0000-0000-000000000001',
  source: 'review_graded',
  amount: 2,
  dailyCap: 20,
  dailyCategory: 'retention',
  referenceId: 'review_card-1_5',
  metadata: { quality: 4 },
};

beforeEach(() => {
  rpcMock.mockReset();
  vi.mocked(logger.warn).mockClear();
});

describe('awardXpCapped', () => {
  it('calls award_xp_capped with the exact p_* parameter contract', async () => {
    rpcMock.mockResolvedValue({ data: 2, error: null });
    const effective = await awardXpCapped(client, OPTS);
    expect(effective).toBe(2);
    expect(rpcMock).toHaveBeenCalledExactlyOnceWith('award_xp_capped', {
      p_student_id: OPTS.studentId,
      p_source: 'review_graded',
      p_amount: 2,
      p_daily_cap: 20,
      p_daily_category: 'retention',
      p_reference_id: 'review_card-1_5',
      p_metadata: { quality: 4 },
    });
  });

  it('passes the caller-supplied cap through untouched (RPC owns the clamp)', async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });
    const effective = await awardXpCapped(client, { ...OPTS, dailyCap: 16, amount: 8 });
    // Cap exhausted → RPC reports 0 effective; helper reports it verbatim.
    expect(effective).toBe(0);
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_amount: 8, p_daily_cap: 16 });
  });

  it('defaults metadata to {} when omitted', async () => {
    rpcMock.mockResolvedValue({ data: 5, error: null });
    const { metadata: _m, ...rest } = OPTS;
    await awardXpCapped(client, rest);
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_metadata: {} });
  });

  it('resolves null (never rejects) on an RPC error, and warn-logs source + reference only', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(awardXpCapped(client, OPTS)).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalled();
    const [, meta] = vi.mocked(logger.warn).mock.calls[0];
    expect(meta).toMatchObject({ source: 'review_graded', referenceId: 'review_card-1_5' });
  });

  it('resolves null (never rejects) when the client throws', async () => {
    rpcMock.mockRejectedValue(new Error('socket hang up'));
    await expect(awardXpCapped(client, OPTS)).resolves.toBeNull();
  });

  it('resolves null on a malformed (non-numeric) RPC return', async () => {
    rpcMock.mockResolvedValue({ data: 'weird', error: null });
    await expect(awardXpCapped(client, OPTS)).resolves.toBeNull();
  });
});
