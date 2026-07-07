import { describe, it, expect, beforeEach } from 'vitest';
import { readSubscriberOffset, writeSubscriberOffset } from '@alfanumrik/lib/state/runtime/offsets';
import { makeServiceSupabase } from '../_helpers/supabase-runtime';

describe('subscriber offsets', () => {
  const sb = makeServiceSupabase();

  beforeEach(async () => {
    // Clean offsets table for the test subscriber + seed a known row.
    await sb.from('subscriber_offsets').delete().eq('subscriber_name', 'test-sub');
    await sb.from('subscriber_offsets').insert({
      subscriber_name: 'test-sub',
      kind_filter: 'learner.mastery_changed',
      last_processed_occurred_at: '2026-05-12T00:00:00Z',
    });
  });

  it('readSubscriberOffset returns the row for a known subscriber', async () => {
    const offset = await readSubscriberOffset(sb, 'test-sub');
    expect(offset.lastEventId).toBeNull();
    expect(offset.lastOccurredAt.startsWith('2026-05-12T00:00:00')).toBe(true);
  });

  it('readSubscriberOffset returns sentinel for an unknown subscriber', async () => {
    const offset = await readSubscriberOffset(sb, 'does-not-exist');
    expect(offset).toEqual({
      lastEventId: null,
      lastOccurredAt: '1970-01-01T00:00:00Z',
    });
  });

  it('writeSubscriberOffset advances the watermark and updates counters', async () => {
    const eventId = '11111111-1111-1111-1111-111111111111';
    await writeSubscriberOffset(
      sb,
      'test-sub',
      {
        lastEventId: eventId,
        lastOccurredAt: '2026-05-13T00:00:00Z',
      },
      { processed: 3, deadLettered: 1 },
    );

    const offset = await readSubscriberOffset(sb, 'test-sub');
    expect(offset.lastEventId).toBe(eventId);
    expect(offset.lastOccurredAt.startsWith('2026-05-13T00:00:00')).toBe(true);

    const { data } = await sb
      .from('subscriber_offsets')
      .select('events_processed, events_dead_lettered')
      .eq('subscriber_name', 'test-sub')
      .single();
    expect(data?.events_processed).toBe(3);
    expect(data?.events_dead_lettered).toBe(1);
  });
});
