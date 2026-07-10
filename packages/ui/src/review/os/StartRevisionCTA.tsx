'use client';

/**
 * StartRevisionCTA — the single primary action of the Alfa OS Revision Center
 * (ff_revision_os_v1, Tier 1 / presentation-only).
 *
 * Hands off to the EXISTING flashcard session at /refresh?tab=flashcards — the
 * real spaced-repetition session today. We do NOT invent a new session route.
 * The label is shaped by the due-now count + estimated minutes the overview
 * already computed; no scoring/XP here.
 *
 * A11y: 48px+ target, focus-visible ring, CSS-only hover/press motion gated by
 * prefers-reduced-motion.
 */

import { useRouter } from 'next/navigation';

interface StartRevisionCTAProps {
  dueNow: number;
  estimatedMinutes: number;
  isLoading: boolean;
  isHi: boolean;
}

const FLASHCARD_SESSION = '/refresh?tab=flashcards';

export default function StartRevisionCTA({
  dueNow,
  estimatedMinutes,
  isLoading,
  isHi,
}: StartRevisionCTAProps) {
  const router = useRouter();

  const hasWork = dueNow > 0;
  const primaryLabel = isLoading
    ? isHi
      ? 'लोड हो रहा है…'
      : 'Loading…'
    : hasWork
      ? isHi
        ? 'दोहराव शुरू करो'
        : 'Start revising'
      : isHi
        ? 'फिर भी दोहराओ'
        : 'Revise anyway';

  const subLabel = isLoading
    ? null
    : hasWork
      ? isHi
        ? `${dueNow} विषय · ~${estimatedMinutes} मिनट`
        : `${dueNow} topic${dueNow === 1 ? '' : 's'} · ~${estimatedMinutes} min`
      : isHi
        ? 'अभी कुछ बाकी नहीं — चाहो तो अभ्यास करो'
        : 'Nothing due — practise if you like';

  return (
    <button
      type="button"
      onClick={() => router.push(FLASHCARD_SESSION)}
      disabled={isLoading}
      className="group w-full rounded-2xl px-5 py-4 text-left transition-transform duration-150 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-default"
      style={{
        minHeight: 48,
        background: hasWork
          ? 'linear-gradient(135deg, var(--orange, #E8581C), var(--purple, #7C3AED))'
          : 'var(--surface-2)',
        color: hasWork ? '#fff' : 'var(--text-1)',
        boxShadow: hasWork ? 'var(--shadow-md)' : 'none',
        border: hasWork ? 'none' : '1px solid var(--border)',
      }}
      aria-label={`${primaryLabel}${subLabel ? ` — ${subLabel}` : ''}`}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span
            className="text-base font-bold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {primaryLabel}
          </span>
          {subLabel && (
            <span
              className="text-xs mt-0.5"
              style={{ opacity: 0.85, fontVariantNumeric: 'tabular-nums' }}
            >
              {subLabel}
            </span>
          )}
        </span>
        <span
          aria-hidden="true"
          className="text-xl transition-transform duration-150 motion-safe:group-hover:translate-x-0.5"
        >
          →
        </span>
      </span>
    </button>
  );
}
