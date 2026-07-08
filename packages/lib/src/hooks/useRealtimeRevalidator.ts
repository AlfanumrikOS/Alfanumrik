/**
 * useRealtimeRevalidator — Supabase Realtime subscription hook
 * with reconnect backoff, visibility-aware pause, and throttle/debounce.
 *
 * Phase C.6 (prod-readiness): teacher dashboards (heatmap, polls) and parent
 * dashboards (child progress) relied on stale fetches (polling every N seconds
 * via useEffect/useCallback). This hook layers Supabase Realtime postgres_changes
 * subscriptions on top: when the DB row changes, the caller's `onChange`
 * callback fires, which the caller can use to trigger their existing data
 * refetch (load(), SWR mutate, etc.).
 *
 * Design notes
 * ────────────
 * 1. RECONNECT WITH EXPONENTIAL BACKOFF
 *    Supabase channels can close on transient network errors. We reconnect
 *    with 5s → 10s → 20s → 30s cap. Reset on first successful subscription.
 *
 * 2. VISIBILITY-AWARE PAUSE (zombie-connection prevention)
 *    When document.visibilityState === 'hidden', we tear down the channel
 *    and re-subscribe on visibilitychange → 'visible'. Background tabs
 *    holding open WebSocket connections to Supabase Realtime is a known
 *    leak vector (each tab = one connection slot on the project quota).
 *
 * 3. THROTTLE / DEBOUNCE
 *    Heatmap subscribers see dozens of student_learning_profiles UPDATEs
 *    per minute for a large class — calling load() on every event would
 *    pummel the teacher-dashboard Edge Function. The caller passes a
 *    `throttleMs` (leading edge) or `debounceMs` (trailing edge) to
 *    coalesce events. Defaults to 0 (no throttle).
 *
 * 4. NO NEW DEPENDENCIES
 *    Uses only React + @supabase/supabase-js (already a peer dep).
 *
 * Usage
 * ─────
 *   useRealtimeRevalidator({
 *     enabled: flag,
 *     channel: `teacher-heatmap-${classId}`,
 *     table: 'student_learning_profiles',
 *     event: 'UPDATE',
 *     filter: `student_id=in.(${ids.join(',')})`,
 *     throttleMs: 2000,
 *     onChange: () => load(),
 *   });
 */

import { useEffect, useRef } from 'react';
import { supabase } from '@alfanumrik/lib/supabase-client';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type PostgresChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export interface UseRealtimeRevalidatorOptions {
  /** Master switch — when false, the hook is a no-op. Use for feature flags. */
  enabled: boolean;
  /** Stable channel name. Used by Supabase to multiplex subscriptions. */
  channel: string;
  /** Public-schema table to watch. */
  table: string;
  /** Postgres change event. '*' matches all. */
  event: PostgresChangeEvent;
  /** Postgres-rest filter expression, e.g. 'student_id=eq.<uuid>' or 'student_id=in.(<id1>,<id2>)'. Pass null to subscribe to all rows (RLS-gated). */
  filter: string | null;
  /** Called once per coalesced event. Caller decides what to refetch. */
  onChange: () => void;
  /**
   * Leading-edge throttle in ms. At most one onChange per window. Use when
   * events are dense and you want immediate-first-then-cool-down. Mutually
   * exclusive with debounceMs (throttle wins if both set).
   */
  throttleMs?: number;
  /**
   * Trailing-edge debounce in ms. Coalesce a burst into a single onChange
   * fired `debounceMs` after the last event. Use when you only care about
   * the final state, not intermediate ticks.
   */
  debounceMs?: number;
}

const BACKOFF_START_MS = 5_000;
const BACKOFF_CAP_MS = 30_000;

/**
 * Subscribe to a Supabase postgres_changes channel and revalidate caller
 * data on change. Handles visibility, reconnects, and throttling.
 *
 * Returns nothing; the side-effect IS the subscription. Caller manages
 * what to do in `onChange` (typically: refetch via load() or SWR mutate).
 */
export function useRealtimeRevalidator(opts: UseRealtimeRevalidatorOptions): void {
  const {
    enabled,
    channel: channelName,
    table,
    event,
    filter,
    onChange,
    throttleMs = 0,
    debounceMs = 0,
  } = opts;

  // Keep the latest onChange in a ref so the effect dep array stays stable.
  // Without this, every parent re-render with a fresh closure would tear
  // down + recreate the channel — that's the Supabase Realtime gotcha that
  // makes "subscribe in useEffect" leak connections in practice.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;

    let channel: RealtimeChannel | null = null;
    let backoff = BACKOFF_START_MS;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let throttleBlockedUntil = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let teardown = false;

    /**
     * Fire onChange with throttle/debounce semantics.
     * - throttleMs wins if both throttleMs and debounceMs are set.
     * - throttleMs=0 + debounceMs=0 ⇒ fire immediately.
     */
    function fire() {
      if (teardown) return;
      const now = Date.now();

      if (throttleMs > 0) {
        if (now < throttleBlockedUntil) return; // dropped — leading-edge throttle
        throttleBlockedUntil = now + throttleMs;
        onChangeRef.current();
        return;
      }

      if (debounceMs > 0) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (!teardown) onChangeRef.current();
        }, debounceMs);
        return;
      }

      onChangeRef.current();
    }

    function teardownChannel() {
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {
          // best-effort cleanup
        }
        channel = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    }

    function subscribe() {
      if (teardown) return;

      // Don't open a connection if the tab is hidden — wait for visibility.
      // This is the zombie-connection guard.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      teardownChannel();

      const config: Record<string, string> = { event, schema: 'public', table };
      if (filter) config.filter = filter;

      channel = supabase.channel(channelName);
      // Supabase channel typing requires literal event strings; cast for
      // dynamic config built from the hook arguments. The runtime accepts
      // the same shape (postgres_changes is the canonical event name).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (channel as any)
        .on('postgres_changes', config, () => fire())
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            // Successful subscription resets backoff so future drops start
            // at the floor again. Without this reset, a single morning
            // disconnect would compound to 30s waits all day.
            backoff = BACKOFF_START_MS;
          } else if (
            status === 'CHANNEL_ERROR' ||
            status === 'CLOSED' ||
            status === 'TIMED_OUT'
          ) {
            // Reconnect with exponential backoff capped at 30s.
            if (reconnectTimer || teardown) return;
            const wait = backoff;
            backoff = Math.min(backoff * 2, BACKOFF_CAP_MS);
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              subscribe();
            }, wait);
          }
        });
    }

    function onVisibilityChange() {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') {
        // Tear down to avoid the zombie-connection leak. SWR/load() will
        // refetch on focus when the user comes back (existing parent-page
        // pattern), and we re-subscribe below on 'visible'.
        teardownChannel();
      } else {
        // Re-subscribe immediately on tab focus.
        backoff = BACKOFF_START_MS;
        subscribe();
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    subscribe();

    return () => {
      teardown = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      teardownChannel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChangeRef is stable; intentionally re-subscribe only when subscription parameters change
  }, [enabled, channelName, table, event, filter, throttleMs, debounceMs]);
}
