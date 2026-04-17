'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import type { AbstainReason, SuggestedAlternative } from '@/components/foxy/ChatBubble';

/* ═══════════════════════════════════════════════════════════════
   HardAbstainCard — shown above tutor bubbles when the grounded
   answer service returned groundingStatus="hard-abstain". Per
   spec §9.2. Replaces the Task 3.3 placeholder.

   Three visual variants based on `reason`:
     (a) chapter_not_ready → show scope + alternatives + request-content
     (b) upstream_error | circuit_open → retry button with auto-countdown
     (c) no_chunks_retrieved | no_supporting_chunks | low_similarity |
         scope_mismatch → generic "no NCERT-backed answer" + alternatives

   Bilingual (P7) via AuthContext.isHi.
   ═══════════════════════════════════════════════════════════════ */

export interface HardAbstainScope {
  grade: string;
  subject: string;
  chapter?: string;
}

export interface HardAbstainCardProps {
  reason: AbstainReason;
  alternatives?: SuggestedAlternative[];
  scope?: HardAbstainScope;
  /** Retry handler — invoked on upstream_error/circuit_open variants. */
  onRetry?: () => void;
  /** Alternative-picker — invoked when student taps an alternative chapter. */
  onPickAlternative?: (alt: SuggestedAlternative) => void;
  /** "Let us know you need this chapter" — invoked on chapter_not_ready. */
  onRequestContent?: () => void;
  /** Total ready chapters — if > alternatives.length, shows "See all" link. */
  totalReady?: number;
  /** "See all N ready chapters" handler. */
  onShowAllAlternatives?: () => void;
}

const UPSTREAM_REASONS: AbstainReason[] = ['upstream_error', 'circuit_open'];
const RETRY_COUNTDOWN_SECONDS = 5;

export function HardAbstainCard({
  reason,
  alternatives,
  scope,
  onRetry,
  onPickAlternative,
  onRequestContent,
  totalReady,
  onShowAllAlternatives,
}: HardAbstainCardProps) {
  const { isHi } = useAuth();
  const isUpstream = UPSTREAM_REASONS.includes(reason);
  const isChapterNotReady = reason === 'chapter_not_ready';

  // Auto-retry countdown for upstream variants
  const [countdown, setCountdown] = useState<number>(RETRY_COUNTDOWN_SECONDS);
  useEffect(() => {
    if (!isUpstream || !onRetry) return;
    setCountdown(RETRY_COUNTDOWN_SECONDS);
    const timer = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [isUpstream, onRetry, reason]);

  // Variant (b): upstream_error / circuit_open
  if (isUpstream) {
    return (
      <div
        data-testid="hard-abstain-card"
        role="status"
        className="mb-2 rounded-lg border border-orange-300 bg-orange-50 p-4"
      >
        <div className="flex items-start gap-3">
          <span aria-hidden className="text-2xl">🔄</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-orange-900">
              {isHi ? 'Foxy saans le raha hai' : 'Foxy is catching its breath'}
            </p>
            <p className="mt-1 text-xs text-orange-800">
              {isHi
                ? 'Service temporarily busy hai. Thode der mein try karein.'
                : 'Our tutor service is temporarily busy. Please try again in a moment.'}
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 inline-flex items-center gap-1 rounded-lg border border-orange-500 bg-white px-3 py-1.5 text-[11px] font-semibold text-orange-800 transition active:scale-95 hover:bg-orange-100"
              >
                {isHi ? 'Phir se try karein' : 'Try again'}
                {countdown > 0 && <span className="opacity-70">({countdown}s)</span>}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Variant (a): chapter_not_ready
  if (isChapterNotReady) {
    return (
      <div
        data-testid="hard-abstain-card"
        role="status"
        className="mb-2 rounded-lg border border-purple-300 bg-purple-50 p-4"
      >
        <div className="flex items-start gap-3">
          <span aria-hidden className="text-2xl">📚</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-purple-900">
              {isHi ? 'Yeh chapter abhi load nahi hua' : 'This chapter isn\u2019t loaded yet'}
            </p>
            {scope && (
              <p className="mt-1 text-xs text-purple-800">
                {isHi
                  ? `Aapka chapter: Class ${scope.grade} ${scope.subject}${scope.chapter ? ` — ${scope.chapter}` : ''}`
                  : `Your chapter: Class ${scope.grade} ${scope.subject}${scope.chapter ? ` — ${scope.chapter}` : ''}`}
              </p>
            )}
            <p className="mt-1 text-xs text-purple-800">
              {isHi
                ? 'Foxy abhi iska NCERT reference nahi dikhata. Koi aur chapter try karein:'
                : 'Foxy doesn\u2019t have NCERT reference material for it yet. Try one of these instead:'}
            </p>

            {alternatives && alternatives.length > 0 && (
              <ul className="mt-3 space-y-2">
                {alternatives.slice(0, 3).map((alt) => (
                  <li key={`${alt.subject_code}-${alt.chapter_number}`}>
                    <button
                      type="button"
                      onClick={() => onPickAlternative?.(alt)}
                      className="w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-left text-[11px] font-medium text-purple-900 transition active:scale-[0.98] hover:border-purple-400 hover:bg-purple-100"
                    >
                      <span className="font-semibold">Ch. {alt.chapter_number}</span>
                      <span className="mx-1">—</span>
                      <span>{alt.chapter_title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {typeof totalReady === 'number' && alternatives && totalReady > alternatives.length && onShowAllAlternatives && (
              <button
                type="button"
                onClick={onShowAllAlternatives}
                className="mt-2 text-[11px] font-semibold text-purple-700 underline underline-offset-2 hover:text-purple-900"
              >
                {isHi
                  ? `Saare ${totalReady} ready chapters dikhaiye →`
                  : `See all ${totalReady} ready chapters →`}
              </button>
            )}

            {onRequestContent && (
              <button
                type="button"
                onClick={onRequestContent}
                className="mt-3 inline-flex items-center gap-1 rounded-lg border border-purple-500 bg-white px-3 py-1.5 text-[11px] font-semibold text-purple-800 transition active:scale-95 hover:bg-purple-100"
              >
                {isHi ? 'Hume batayein ki aapko yeh chapter chahiye' : 'Let us know you need this chapter'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Variant (c): generic no-NCERT-answer
  return (
    <div
      data-testid="hard-abstain-card"
      role="status"
      className="mb-2 rounded-lg border border-amber-300 bg-amber-50 p-4"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-2xl">📖</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            {isHi ? 'Koi NCERT-based jawab nahi mila' : 'No NCERT-backed answer available'}
          </p>
          <p className="mt-1 text-xs text-amber-800">
            {isHi
              ? 'Foxy apki NCERT kitaab se is sawaal ka confident jawab nahi de saka. Koi specific NCERT chapter ka sawaal puchein.'
              : 'Foxy couldn\u2019t find confident NCERT material for this question. Try asking a specific question from an NCERT chapter.'}
          </p>

          {alternatives && alternatives.length > 0 && (
            <ul className="mt-3 space-y-2">
              {alternatives.slice(0, 3).map((alt) => (
                <li key={`${alt.subject_code}-${alt.chapter_number}`}>
                  <button
                    type="button"
                    onClick={() => onPickAlternative?.(alt)}
                    className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-left text-[11px] font-medium text-amber-900 transition active:scale-[0.98] hover:border-amber-400 hover:bg-amber-100"
                  >
                    <span className="font-semibold">Ch. {alt.chapter_number}</span>
                    <span className="mx-1">—</span>
                    <span>{alt.chapter_title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}