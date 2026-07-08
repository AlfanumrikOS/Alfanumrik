'use client';

/**
 * QueueFromScanButton — the "Add to my queue" CTA shown on the scan
 * result UI. Phase 5 follow-on of ADR-001.
 *
 * Calls POST /api/learner/queue-from-scan { scanId }, which is gated by
 * ff_scan_to_queue_v1. When the flag is OFF the endpoint 404s and the
 * button renders nothing (the hook below short-circuits via the
 * useFeatureFlags check).
 *
 * State machine:
 *   idle      → button reads "🔁 Add to my queue"; click → POSTing
 *   POSTing   → button disabled, reads "Adding…"
 *   added     → button reads "✓ Added to your queue", disabled
 *   exists    → button reads "✓ Already in your queue", disabled
 *   error     → red text under the button + restored to idle so the
 *               student can retry
 *
 * Idempotent — the server returns { created: false } when a card for
 * this scanId already exists; we surface that as the "already in your
 * queue" state rather than showing two different success messages.
 */

import { useState } from 'react';
import { useFeatureFlags } from '@alfanumrik/lib/swr';

type ButtonState = 'idle' | 'posting' | 'added' | 'exists' | 'error';

export interface QueueFromScanButtonProps {
  scanId: string;
  isHi: boolean;
  /** Optional callback fired after a successful POST (created or exists). */
  onQueued?: (args: { cardId: string; created: boolean }) => void;
}

interface QueueFromScanResponse {
  ok: boolean;
  cardId?: string;
  created?: boolean;
  error?: string;
}

/** Pure: derive the visible label per state + locale. Exported for testing. */
export function queueButtonLabel(state: ButtonState, isHi: boolean): string {
  switch (state) {
    case 'idle':
      return isHi ? '🔁 मेरी कतार में जोड़ो' : '🔁 Add to my queue';
    case 'posting':
      return isHi ? 'जोड़ रहे हैं…' : 'Adding…';
    case 'added':
      return isHi ? '✓ कतार में जोड़ा गया' : '✓ Added to your queue';
    case 'exists':
      return isHi ? '✓ पहले से कतार में है' : '✓ Already in your queue';
    case 'error':
      return isHi ? '🔁 दोबारा कोशिश करें' : '🔁 Try again';
  }
}

export function queueButtonAriaBusy(state: ButtonState): boolean {
  return state === 'posting';
}

export function queueButtonDisabled(state: ButtonState): boolean {
  return state === 'posting' || state === 'added' || state === 'exists';
}

export default function QueueFromScanButton({
  scanId,
  isHi,
  onQueued,
}: QueueFromScanButtonProps) {
  const { data: flags } = useFeatureFlags();
  const [state, setState] = useState<ButtonState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Flag gate. Rendering nothing is correct: when the route is dark, the
  // button has no destination and shouldn't tease a feature that does
  // nothing.
  if (flags?.ff_scan_to_queue_v1 !== true) return null;

  const handleClick = async () => {
    if (queueButtonDisabled(state)) return;
    setState('posting');
    setErrorMessage(null);
    try {
      const res = await fetch('/api/learner/queue-from-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ scanId }),
      });
      const body: QueueFromScanResponse = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !body.ok || !body.cardId) {
        setState('error');
        setErrorMessage(
          body.error
            ? isHi
              ? 'कतार में जोड़ नहीं पाए — फिर कोशिश करें'
              : "Couldn't add to your queue — try again"
            : isHi
              ? 'कुछ गलत हुआ — फिर कोशिश करें'
              : 'Something went wrong — try again',
        );
        return;
      }
      setState(body.created === true ? 'added' : 'exists');
      onQueued?.({ cardId: body.cardId, created: body.created === true });
    } catch {
      setState('error');
      setErrorMessage(
        isHi
          ? 'नेटवर्क समस्या — फिर कोशिश करें'
          : 'Network issue — try again',
      );
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={queueButtonDisabled(state)}
        aria-busy={queueButtonAriaBusy(state) || undefined}
        data-testid="queue-from-scan-button"
        data-state={state}
        className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
        style={{
          background:
            state === 'added' || state === 'exists'
              ? 'var(--teal, #0891B2)'
              : 'var(--orange, #E8581C)',
        }}
      >
        {queueButtonLabel(state, isHi)}
      </button>
      {state === 'error' && errorMessage && (
        <p
          className="mt-1 text-[11px]"
          style={{ color: 'var(--danger, #EF4444)' }}
          role="alert"
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}
