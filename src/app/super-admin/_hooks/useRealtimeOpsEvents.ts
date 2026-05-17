'use client';

/**
 * Phase H.3 (Super-Admin Production-Readiness Plan, 2026-05-17)
 *
 * React hook for subscribing to Supabase Realtime updates on ops-relevant
 * tables (ops_events, quiz_sessions). Replaces the Control Room's 30s
 * polling loop with push-based updates, gated behind ff_realtime_subscriptions_v1
 * (default OFF — caller passes `enabled` after evaluating the flag).
 *
 * Why a hook, not a wholesale Control Room rewrite:
 *   - Control Room polls 8 endpoints. Replacing every one with realtime
 *     requires a different shape per endpoint. Better to start with the
 *     2 most-changed tables (ops_events, quiz_sessions) and a "you have N
 *     new events, click to refresh" UX, then expand once the flag has
 *     baked.
 *   - This hook is reusable by /super-admin/observability and other pages
 *     that surface ops_events.
 *
 * Usage:
 *
 *   const { newEventCount, ackEvents } = useRealtimeOpsEvents({
 *     enabled: flags.ff_realtime_subscriptions_v1 === true,
 *     supabase,
 *   });
 *
 *   {newEventCount > 0 && (
 *     <button onClick={() => { refetch(); ackEvents(); }}>
 *       {newEventCount} new event{newEventCount === 1 ? '' : 's'}
 *     </button>
 *   )}
 *
 * The hook does NOT call refetch itself — operator-controlled refresh
 * avoids surprise re-renders while the operator is reading a row.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface RealtimeOpsOptions {
  enabled: boolean;
  supabase: SupabaseClient;
  /** Which tables to subscribe to. Defaults to ops + quiz. */
  tables?: Array<'ops_events' | 'quiz_sessions' | 'student_learning_profiles'>;
}

export interface RealtimeOpsResult {
  /** Count of inserts/updates seen since the last `ackEvents()` call. */
  newEventCount: number;
  /** Reset the counter — call this after the operator triggers a refetch. */
  ackEvents: () => void;
  /** Subscription status: 'idle' before mount, 'subscribed' when active. */
  status: 'idle' | 'subscribing' | 'subscribed' | 'disabled' | 'error';
  /** Last error if status='error'. */
  error: string | null;
}

const DEFAULT_TABLES: NonNullable<RealtimeOpsOptions['tables']> = [
  'ops_events',
  'quiz_sessions',
];

export function useRealtimeOpsEvents({
  enabled,
  supabase,
  tables = DEFAULT_TABLES,
}: RealtimeOpsOptions): RealtimeOpsResult {
  const [newEventCount, setNewEventCount] = useState(0);
  const [status, setStatus] = useState<RealtimeOpsResult['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  // Refs let the cleanup function see the latest channel reference without
  // re-subscribing every render.
  const channelRef = useRef<ReturnType<SupabaseClient['channel']> | null>(null);

  const ackEvents = useCallback(() => {
    setNewEventCount(0);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus('disabled');
      return;
    }

    setStatus('subscribing');
    setError(null);

    let channel: ReturnType<SupabaseClient['channel']> | null = null;
    try {
      channel = supabase.channel('super-admin-ops');
      for (const table of tables) {
        // postgres_changes is Supabase Realtime's row-level subscription;
        // we listen for INSERTs (new events / new sessions). UPDATEs on
        // student_learning_profiles signal mastery changes — also worth
        // bumping the counter when subscribed to that table.
        channel = channel.on(
          // The Supabase SDK types `postgres_changes` as a string literal.
          'postgres_changes' as never,
          { event: '*', schema: 'public', table },
          () => {
            setNewEventCount((c) => c + 1);
          },
        );
      }
      channel.subscribe((subStatus: string) => {
        if (subStatus === 'SUBSCRIBED') setStatus('subscribed');
        else if (subStatus === 'CHANNEL_ERROR' || subStatus === 'TIMED_OUT') {
          setStatus('error');
          setError(subStatus);
        }
      });
      channelRef.current = channel;
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }

    return () => {
      const ch = channelRef.current;
      if (ch) {
        supabase.removeChannel(ch);
        channelRef.current = null;
      }
    };
    // We intentionally only re-subscribe when `enabled` flips or `supabase`
    // changes — `tables` is read once at subscribe time. Callers should
    // pass a stable array (defined at module scope or memoized) to avoid
    // unwanted re-subscribes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, supabase]);

  return { newEventCount, ackEvents, status, error };
}
