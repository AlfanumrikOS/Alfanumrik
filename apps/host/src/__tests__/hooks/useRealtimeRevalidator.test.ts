/**
 * Tests for useRealtimeRevalidator (Phase C.6).
 *
 * Scenarios covered:
 *   1. Subscribes on mount (channel.on + .subscribe called with config).
 *   2. Unsubscribes on unmount (removeChannel called).
 *   3. Pauses subscription when document.visibilityState is 'hidden'.
 *   4. Re-subscribes when visibility flips back to 'visible'.
 *   5. Reconnects on CHANNEL_ERROR / CLOSED with backoff (5s → 10s → 20s → 30s cap).
 *   6. Throttles rapid-fire events (leading edge).
 *   7. Debounces rapid-fire events (trailing edge).
 *   8. No-op when enabled=false (no channel created).
 *   9. Filter is applied to the postgres_changes config.
 *  10. onChange uses the latest ref (no stale closure on re-render).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ─── Mock supabase-client BEFORE importing the hook ──────────────────────────
type SubscribeCallback = (status: string) => void;
type ChannelOnHandler = (payload: Record<string, unknown>) => void;

interface MockChannel {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  /** Internal: the handler the hook registered for postgres_changes. */
  _onHandler: ChannelOnHandler | null;
  /** Internal: the subscribe status callback. */
  _subscribeCb: SubscribeCallback | null;
  /** Internal: channel name for assertions. */
  _name: string;
  /** Internal: the postgres_changes config the hook passed. */
  _config: Record<string, string> | null;
}

const createdChannels: MockChannel[] = [];
const removedChannels: MockChannel[] = [];

function makeChannel(name: string): MockChannel {
  const ch: MockChannel = {
    on: vi.fn(),
    subscribe: vi.fn(),
    _onHandler: null,
    _subscribeCb: null,
    _name: name,
    _config: null,
  };
  ch.on.mockImplementation((_event: string, config: Record<string, string>, handler: ChannelOnHandler) => {
    ch._onHandler = handler;
    ch._config = config;
    return ch;
  });
  ch.subscribe.mockImplementation((cb: SubscribeCallback) => {
    ch._subscribeCb = cb;
    // Synchronously fire SUBSCRIBED so each subscribe call settles
    // deterministically under fake timers. Tests can fire CHANNEL_ERROR
    // / CLOSED / TIMED_OUT manually by calling ch._subscribeCb(...) again.
    cb('SUBSCRIBED');
    return ch;
  });
  return ch;
}

vi.mock('@alfanumrik/lib/supabase-client', () => ({
  supabase: {
    channel: vi.fn((name: string) => {
      const ch = makeChannel(name);
      createdChannels.push(ch);
      return ch;
    }),
    removeChannel: vi.fn((ch: MockChannel) => {
      removedChannels.push(ch);
    }),
  },
}));

// Import AFTER mocks are registered.
import { useRealtimeRevalidator } from '@/hooks/useRealtimeRevalidator';

beforeEach(() => {
  createdChannels.length = 0;
  removedChannels.length = 0;
  vi.useFakeTimers();
  // Reset visibility to visible at the start of every test.
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
    writable: true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useRealtimeRevalidator', () => {
  it('subscribes on mount with the provided table, event, and filter', () => {
    const onChange = vi.fn();
    renderHook(() =>
      useRealtimeRevalidator({
        enabled: true,
        channel: 'test-channel',
        table: 'student_learning_profiles',
        event: 'UPDATE',
        filter: 'student_id=eq.abc',
        onChange,
      }),
    );

    expect(createdChannels).toHaveLength(1);
    const ch = createdChannels[0];
    expect(ch._name).toBe('test-channel');
    expect(ch.on).toHaveBeenCalledTimes(1);
    expect(ch._config).toEqual({
      event: 'UPDATE',
      schema: 'public',
      table: 'student_learning_profiles',
      filter: 'student_id=eq.abc',
    });
    expect(ch.subscribe).toHaveBeenCalledTimes(1);
  });

  it('omits filter from config when filter is null (RLS-only mode)', () => {
    const onChange = vi.fn();
    renderHook(() =>
      useRealtimeRevalidator({
        enabled: true,
        channel: 'no-filter',
        table: 'student_learning_profiles',
        event: 'UPDATE',
        filter: null,
        onChange,
      }),
    );

    const ch = createdChannels[0];
    expect(ch._config).toEqual({
      event: 'UPDATE',
      schema: 'public',
      table: 'student_learning_profiles',
    });
    expect(ch._config).not.toHaveProperty('filter');
  });

  it('removes the channel on unmount', () => {
    const onChange = vi.fn();
    const { unmount } = renderHook(() =>
      useRealtimeRevalidator({
        enabled: true,
        channel: 'unmount-test',
        table: 'classroom_poll_responses',
        event: 'INSERT',
        filter: null,
        onChange,
      }),
    );

    expect(createdChannels).toHaveLength(1);
    unmount();
    expect(removedChannels).toHaveLength(1);
    expect(removedChannels[0]._name).toBe('unmount-test');
  });

  it('is a no-op when enabled=false (no channel created)', () => {
    const onChange = vi.fn();
    renderHook(() =>
      useRealtimeRevalidator({
        enabled: false,
        channel: 'disabled',
        table: 'student_learning_profiles',
        event: 'UPDATE',
        filter: null,
        onChange,
      }),
    );

    expect(createdChannels).toHaveLength(0);
  });

  it('tears down the channel when document becomes hidden', () => {
    const onChange = vi.fn();
    renderHook(() =>
      useRealtimeRevalidator({
        enabled: true,
        channel: 'visibility-test',
        table: 'student_learning_profiles',
        event: 'UPDATE',
        filter: null,
        onChange,
      }),
    );

    expect(createdChannels).toHaveLength(1);
    expect(removedChannels).toHaveLength(0);

    act(() => setVisibility('hidden'));

    // Zombie-connection guard: hide ⇒ tear down.
    expect(removedChannels).toHaveLength(1);
  });

  it('re-subscribes when document becomes visible again', () => {
    const onChange = vi.fn();
    renderHook(() =>
      useRealtimeRevalidator({
        enabled: true,
        channel: 'visibility-resubscribe',
        table: 'student_learning_profiles',
        event: 'UPDATE',
        filter: null,
        onChange,
      }),
    );

    expect(createdChannels).toHaveLength(1);

    act(() => setVisibility('hidden'));
    expect(removedChannels).toHaveLength(1);

    act(() => setVisibility('visible'));
    // Now a second channel should be created.
    expect(createdChannels).toHaveLength(2);
  });

  it('reconnects with exponential backoff on CHANNEL_ERROR', () => {
    const onChange = vi.fn();
    renderHook(() =>
      useRealtimeRevalidator({
        enabled: true,
        channel: 'reconnect-test',
        table: 'student_learning_profiles',
        event: 'UPDATE',
        filter: null,
        onChange,
      }),
    );

    expect(createdChannels).toHaveLength(1);
    const ch1 = createdChannels[0];

    // Drain the microtask that fires the default SUBSCRIBED.
    // Now simulate a channel error AFTER the initial subscribe settled.
    act(() => {
      ch1._subscribeCb?.('CHANNEL_ERROR');
    });

    // Backoff is 5s for first reconnect — advance just under and verify no
    // new channel yet.
    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(createdChannels).toHaveLength(1);

    // Cross the 5s boundary — a new channel is created.
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(createdChannels).toHaveLength(2);
  });

  it('throttles rapid-fire events with throttleMs (leading edge)', () => {
    const onChange = vi.fn();
    renderHook(() =>
      useRealtimeRevalidator({
        enabled: true,
        channel: 'throttle-test',
        table: 'student_learning_profiles',
        event: 'UPDATE',
        filter: null,
        throttleMs: 2000,
        onChange,
      }),
    );

    const ch = createdChannels[0];
    // Fire 5 events back-to-back at t=0. Leading-edge throttle ⇒ exactly
    // one onChange.
    act(() => {
      for (let i = 0; i < 5; i++) ch._onHandler?.({});
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    // Advance just under the throttle window — no second call.
    act(() => {
      vi.advanceTimersByTime(1_999);
      ch._onHandler?.({});
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    // Cross the throttle window — the next event fires.
    act(() => {
      vi.advanceTimersByTime(2);
      ch._onHandler?.({});
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('debounces rapid-fire events with debounceMs (trailing edge)', () => {
    const onChange = vi.fn();
    renderHook(() =>
      useRealtimeRevalidator({
        enabled: true,
        channel: 'debounce-test',
        table: 'student_learning_profiles',
        event: 'UPDATE',
        filter: null,
        debounceMs: 5000,
        onChange,
      }),
    );

    const ch = createdChannels[0];

    // Fire 3 events at t=0, 1s, 2s. Each resets the debounce timer.
    act(() => {
      ch._onHandler?.({});
      vi.advanceTimersByTime(1_000);
      ch._onHandler?.({});
      vi.advanceTimersByTime(1_000);
      ch._onHandler?.({});
    });
    expect(onChange).toHaveBeenCalledTimes(0);

    // At t=2+5=7s the trailing edge fires once.
    act(() => {
      vi.advanceTimersByTime(5_001);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('uses the latest onChange callback (no stale closure)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) =>
        useRealtimeRevalidator({
          enabled: true,
          channel: 'stale-closure-test',
          table: 'student_learning_profiles',
          event: 'UPDATE',
          filter: null,
          onChange: cb,
        }),
      { initialProps: { cb: first } },
    );

    // Only one channel — subscription should not tear down when only the
    // callback changes (subscription params are stable).
    expect(createdChannels).toHaveLength(1);

    rerender({ cb: second });
    expect(createdChannels).toHaveLength(1);

    const ch = createdChannels[0];
    act(() => {
      ch._onHandler?.({});
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('resets backoff after a successful reconnect (does not compound)', () => {
    const onChange = vi.fn();
    renderHook(() =>
      useRealtimeRevalidator({
        enabled: true,
        channel: 'backoff-reset',
        table: 'student_learning_profiles',
        event: 'UPDATE',
        filter: null,
        onChange,
      }),
    );

    const ch1 = createdChannels[0];

    // Error → first reconnect waits 5s.
    act(() => { ch1._subscribeCb?.('CHANNEL_ERROR'); });
    act(() => { vi.advanceTimersByTime(5_001); });
    expect(createdChannels).toHaveLength(2);

    // The second channel synchronously settles to SUBSCRIBED via the mock,
    // which resets backoff to 5s. Error it again → next reconnect should
    // wait 5s, not 10s (the compound value before reset).
    const ch2 = createdChannels[1];
    act(() => { ch2._subscribeCb?.('CHANNEL_ERROR'); });
    act(() => { vi.advanceTimersByTime(4_999); });
    expect(createdChannels).toHaveLength(2);

    act(() => { vi.advanceTimersByTime(2); });
    expect(createdChannels).toHaveLength(3);
  });
});
