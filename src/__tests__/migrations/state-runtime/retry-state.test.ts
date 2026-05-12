import { describe, it, expect, beforeEach } from 'vitest';
import {
  readRetryCount, upsertRetryState, clearRetryState, insertDeadLetter,
} from '@/lib/state/runtime/retry-state';
import { makeServiceSupabase } from '../_helpers/supabase-runtime';

const sb = makeServiceSupabase();
const EVENT_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(async () => {
  await sb.from('subscriber_retry_state').delete().eq('event_id', EVENT_ID);
  await sb.from('subscriber_dead_letters').delete().eq('event_id', EVENT_ID);
});

describe('retry state', () => {
  it('readRetryCount returns 0 for a new (event, subscriber)', async () => {
    const n = await readRetryCount(sb, EVENT_ID, 'test-sub');
    expect(n).toBe(0);
  });

  it('upsertRetryState inserts then increments', async () => {
    await upsertRetryState(sb, EVENT_ID, 'test-sub', 1, 'first error');
    expect(await readRetryCount(sb, EVENT_ID, 'test-sub')).toBe(1);
    await upsertRetryState(sb, EVENT_ID, 'test-sub', 2, 'second error');
    expect(await readRetryCount(sb, EVENT_ID, 'test-sub')).toBe(2);
    const { data } = await sb
      .from('subscriber_retry_state')
      .select('last_error, first_attempted_at, last_attempted_at')
      .eq('event_id', EVENT_ID).eq('subscriber_name', 'test-sub').single();
    expect(data?.last_error).toBe('second error');
    expect(data!.last_attempted_at >= data!.first_attempted_at).toBe(true);
  });

  it('clearRetryState removes the row', async () => {
    await upsertRetryState(sb, EVENT_ID, 'test-sub', 1, 'err');
    await clearRetryState(sb, EVENT_ID, 'test-sub');
    expect(await readRetryCount(sb, EVENT_ID, 'test-sub')).toBe(0);
  });
});

describe('dead letters', () => {
  it('insertDeadLetter records the terminal failure', async () => {
    await insertDeadLetter(sb, EVENT_ID, 'test-sub', 3, 'final error');
    const { data } = await sb
      .from('subscriber_dead_letters')
      .select('*')
      .eq('event_id', EVENT_ID).eq('subscriber_name', 'test-sub').single();
    expect(data?.attempt_count).toBe(3);
    expect(data?.last_error).toBe('final error');
    expect(data?.resolved_at).toBeNull();
  });

  it('insertDeadLetter is idempotent (UNIQUE upsert)', async () => {
    await insertDeadLetter(sb, EVENT_ID, 'test-sub', 3, 'err 1');
    await insertDeadLetter(sb, EVENT_ID, 'test-sub', 3, 'err 2');
    const { count } = await sb
      .from('subscriber_dead_letters')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', EVENT_ID).eq('subscriber_name', 'test-sub');
    expect(count).toBe(1);
  });
});
