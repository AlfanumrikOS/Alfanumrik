'use client';

/**
 * StartRevisionCTA — the single primary action of the Alfa OS Revision Center
 * (ff_revision_os_v1, Tier 1 / presentation-only).
 *
 * TOPIC-SCOPED (fixed 2026-08, defect #7). This button used to push a constant
 * `/refresh?tab=flashcards` no matter which topics were due — the student was
 * told "3 topics · ~5 min" and then handed a generic flashcard screen backed by
 * `spaced_repetition_cards`, which no quiz writes, so it read "Nothing to
 * refresh right now". It now opens the FIRST overdue topic (falling back to the
 * first due-today topic) in Foxy revise mode via `reviseTopicHref`, carrying the
 * topic id + canonical subject code.
 *
 * The unscoped flashcard session remains the destination ONLY for the
 * "Revise anyway" case, where by definition there is no due topic to name.
 * The label is shaped by the due-now count + estimated minutes the overview
 * already computed; no scoring/XP here.
 *
 * A11y: 48px+ target, focus-visible ring, CSS-only hover/press motion gated by
 * prefers-reduced-motion.
 */

import { useRouter } from 'next/navigation';
import { reviseTopicHref } from './revision-labels';
import type { RevisionItem } from './useRevisionOverview';

interface StartRevisionCTAProps {
  dueNow: number;
  estimatedMinutes: number;
  isLoading: boolean;
  isHi: boolean;
  /**
   * The topic this CTA promises to open — the first overdue item, or the first
   * due-today item when nothing is overdue. Undefined ⇒ nothing is due, so the
   * button degrades to the unscoped flashcard session.
   */
  nextTopic?: RevisionItem | null;
}

const FLASHCARD_SESSION = '/refresh?tab=flashcards';

export default function StartRevisionCTA({
  dueNow,
  estimatedMinutes,
  isLoading,
  isHi,
  nextTopic,
}: StartRevisionCTAProps) {
  const router = useRouter();

  const hasWork = dueNow > 0;
  // Land on the topic we just named. Only fall back to the unscoped session
  // when there is genuinely no topic to open.
  const destination = nextTopic
    ? reviseTopicHref({ topicId: nextTopic.topicId, subject: nextTopic.subject })
    : FLASHCARD_SESSION;
  const topicTitle = nextTopic
    ? (isHi && nextTopic.titleHi) || nextTopic.title || null
    : null;
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

  // Name the topic the button will actually open, so the promise and the
  // destination are the same thing the student can read.
  const subLabel = isLoading
    ? null
    : hasWork
      ? isHi
        ? `${topicTitle ? `${topicTitle} · ` : ''}${dueNow} विषय · ~${estimatedMinutes} मिनट`
        : `${topicTitle ? `${topicTitle} · ` : ''}${dueNow} topic${dueNow === 1 ? '' : 's'} · ~${estimatedMinutes} min`
      : isHi
        ? 'अभी कुछ बाकी नहीं — चाहो तो अभ्यास करो'
        : 'Nothing due — practise if you like';

  return (
    <button
      type="button"
      onClick={() => router.push(destination)}
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
