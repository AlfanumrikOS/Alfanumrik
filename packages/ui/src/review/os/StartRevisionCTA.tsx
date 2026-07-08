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
 * Phase 8 rebuild: presentation now rides the canonical Button primitive
 * (primary = AA warm-gradient CTA when there's work, secondary when caught up).
 * The routing target, click handler, loading gate and copy are unchanged.
 * A11y: Button gives a >= 48px target + focus-visible ring + reduced-motion.
 */

import { useRouter } from 'next/navigation';
import { Button } from '@alfanumrik/ui/ui/primitives';

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
    <Button
      variant={hasWork ? 'primary' : 'secondary'}
      size="lg"
      fullWidth
      loading={isLoading}
      onClick={() => router.push(FLASHCARD_SESSION)}
      trailingIcon={<span className="text-fluid-lg">→</span>}
      aria-label={`${primaryLabel}${subLabel ? ` — ${subLabel}` : ''}`}
      className="justify-between"
    >
      <span className="flex flex-col items-start text-start">
        <span className="font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {primaryLabel}
        </span>
        {subLabel && (
          <span className="text-fluid-xs font-medium tabular-nums opacity-90">{subLabel}</span>
        )}
      </span>
    </Button>
  );
}
