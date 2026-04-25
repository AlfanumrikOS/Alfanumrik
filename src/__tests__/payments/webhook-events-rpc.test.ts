import { describe, it, expect, vi } from 'vitest';

// Helper under test (added in Task 3 to webhook route as a local fn).
// For Task 2 we test the RPC contract via a mock — the migration is the
// real source of truth, asserted in the integration test (Task 7).
async function recordWebhookEvent(
  admin: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> },
  args: { account_id: string; event_id: string; event_type: string; raw_payload: Record<string, unknown> },
): Promise<'inserted' | 'duplicate'> {
  const { data, error } = await admin.rpc('record_webhook_event', {
    p_account_id: args.account_id,
    p_event_id: args.event_id,
    p_event_type: args.event_type,
    p_raw_payload: args.raw_payload,
  });
  if (error) throw new Error(error.message);
  return (data as { is_new: boolean }).is_new ? 'inserted' : 'duplicate';
}

describe('record_webhook_event RPC contract', () => {
  it('returns "inserted" on first call', async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data: { is_new: true }, error: null }) };
    const result = await recordWebhookEvent(admin, {
      account_id: 'acc_1', event_id: 'evt_abc', event_type: 'payment.captured', raw_payload: {},
    });
    expect(result).toBe('inserted');
    expect(admin.rpc).toHaveBeenCalledWith('record_webhook_event', expect.objectContaining({
      p_account_id: 'acc_1', p_event_id: 'evt_abc', p_event_type: 'payment.captured',
    }));
  });

  it('returns "duplicate" when RPC reports is_new=false (ON CONFLICT path)', async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data: { is_new: false }, error: null }) };
    const result = await recordWebhookEvent(admin, {
      account_id: 'acc_1', event_id: 'evt_abc', event_type: 'payment.captured', raw_payload: {},
    });
    expect(result).toBe('duplicate');
  });

  it('throws on RPC error so caller can 5xx', async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }) };
    await expect(recordWebhookEvent(admin, {
      account_id: 'acc_1', event_id: 'evt_abc', event_type: 'payment.captured', raw_payload: {},
    })).rejects.toThrow('boom');
  });
});
