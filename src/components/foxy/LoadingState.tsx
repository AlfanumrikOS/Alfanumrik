'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';

/* ═══════════════════════════════════════════════════════════════
   LoadingState — in-chat "Foxy is thinking" indicator.

   Honest behavior per spec §6.7 / §9.6:
     - Bouncing dots spinner (unchanged visual language)
     - Elapsed seconds counter: "Foxy is thinking... 5s"
     - After 15s elapsed, append a "taking longer than usual" line

   Explicitly NOT added: fake "Checking NCERT references..." stage
   messages. The team decision is honesty-only — we show only what
   is true (that time is passing), never fabricated stages.
   ═══════════════════════════════════════════════════════════════ */

export interface LoadingStateProps {
  /** Optional override for the first line (e.g. image-OCR state). */
  primaryLabel?: string;
  /** Whether to show the elapsed counter. Default: true. */
  showElapsed?: boolean;
}

const LONG_WAIT_THRESHOLD_SECONDS = 15;

export function LoadingState({ primaryLabel, showElapsed = true }: LoadingStateProps) {
  const { isHi } = useAuth();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!showElapsed) return;
    const interval = setInterval(() => {
      setElapsed((e) => e + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [showElapsed]);

  const defaultLabel = isHi ? 'Foxy soch raha hai' : 'Foxy is thinking';
  const label = primaryLabel ?? defaultLabel;
  const isLongWait = elapsed >= LONG_WAIT_THRESHOLD_SECONDS;

  const longWaitMessage = isHi
    ? 'Thoda aur ruko — zyada samay lag raha hai'
    : 'This is taking longer than usual — hold on';

  return (
    <div
      data-testid="foxy-loading-state"
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 px-4 py-3"
    >
      <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
        <span className="text-lg animate-pulse" aria-hidden>🦊</span>
      </div>
      <div
        className="bg-orange-50 rounded-xl px-4 py-3 max-w-[80%]"
        style={{ border: '1px solid var(--border)' }}
      >
        <div className="flex gap-1.5" aria-hidden>
          <span
            className="w-2 h-2 bg-orange-400 rounded-full animate-bounce"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="w-2 h-2 bg-orange-400 rounded-full animate-bounce"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="w-2 h-2 bg-orange-400 rounded-full animate-bounce"
            style={{ animationDelay: '300ms' }}
          />
        </div>
        <p className="text-xs text-orange-700 mt-1.5" data-testid="foxy-loading-primary">
          {label}
          {showElapsed && <>... {elapsed}s</>}
        </p>
        {isLongWait && (
          <p
            className="text-[11px] text-orange-600 mt-1"
            data-testid="foxy-loading-long-wait"
          >
            {longWaitMessage}
          </p>
        )}
      </div>
    </div>
  );
}