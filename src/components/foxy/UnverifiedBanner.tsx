'use client';

import { useAuth } from '@/lib/AuthContext';

/* ═══════════════════════════════════════════════════════════════
   UnverifiedBanner — shown above tutor bubbles when the grounded
   answer service returned groundingStatus="unverified" (low
   confidence). Per spec §9.1. Replaces the Task 3.3 placeholder.

   Visual: amber caution strip with a ⚠ icon, bilingual copy, and
   an optional secondary action that surfaces NCERT chapters ready
   for grounded answers.
   ═══════════════════════════════════════════════════════════════ */

export interface UnverifiedBannerProps {
  /** Trace id surfaced in the title tooltip for support/debugging. */
  traceId?: string;
  /** Invoked when the student clicks the "Show me NCERT chapters" action. */
  onShowChapters?: () => void;
}

export function UnverifiedBanner({ traceId, onShowChapters }: UnverifiedBannerProps) {
  const { isHi } = useAuth();

  const message = isHi
    ? '⚠ Yeh jawab aapki NCERT kitaab se nahi hai — apni kitaab se check karein, ya NCERT se koi specific sawaal poochein.'
    : '⚠ This answer isn\u2019t from your NCERT textbook — please verify with your book, or ask a specific NCERT question for a grounded answer.';

  const actionLabel = isHi
    ? 'Mujhe dikhaiye kaun se NCERT chapters available hain'
    : 'Show me NCERT chapters I can ask about';

  return (
    <div
      data-testid="unverified-banner"
      role="status"
      title={traceId ? `trace: ${traceId}` : undefined}
      className="mb-2 rounded-lg border border-amber-400 bg-amber-50 p-4 text-amber-900"
    >
      <p className="text-xs leading-relaxed">{message}</p>
      {onShowChapters && (
        <button
          type="button"
          onClick={onShowChapters}
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-amber-500 bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-800 transition active:scale-95 hover:bg-amber-100"
        >
          {actionLabel}
          <span aria-hidden>→</span>
        </button>
      )}
    </div>
  );
}