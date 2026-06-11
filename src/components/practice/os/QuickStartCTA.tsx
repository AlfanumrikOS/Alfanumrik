'use client';

/**
 * QuickStartCTA — the single primary action of the Alfa OS Practice Center
 * (ff_practice_os_v1, Tier 1+ / presentation-only).
 *
 * Hands off to the EXISTING /quiz engine. We do NOT modify the quiz page.
 *
 * /quiz reads these URL query params to pre-configure a session (verified in
 * src/app/quiz/page.tsx, ~line 305): `subject`, `mode` (accepts only
 * 'cognitive' | 'exam'), `count`, `chapter`. There is NO `mode=practice` value
 * and NO `difficulty` param. This generic Quick-Start deliberately deep-links
 * to /quiz with NO params, landing the student on the standard setup screen so
 * they pick subject/chapter/difficulty there. Scoped launches (subject+chapter)
 * are handled by WeakTopicLauncher.
 *
 * A11y: 48px+ target, focus-visible ring, CSS-only hover/press motion gated by
 * prefers-reduced-motion.
 */

import { useRouter } from 'next/navigation';

interface QuickStartCTAProps {
  isHi: boolean;
}

export default function QuickStartCTA({ isHi }: QuickStartCTAProps) {
  const router = useRouter();

  const primaryLabel = isHi ? 'अभ्यास शुरू करो' : 'Start a practice quiz';
  const subLabel = isHi ? 'विषय और अध्याय चुनो' : 'Pick a subject & chapter';

  return (
    <button
      type="button"
      onClick={() => router.push('/quiz')}
      className="group w-full rounded-2xl px-5 py-4 text-left transition-transform duration-150 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{
        minHeight: 48,
        background: 'linear-gradient(135deg, var(--orange, #E8581C), var(--purple, #7C3AED))',
        color: '#fff',
        boxShadow: 'var(--shadow-md)',
      }}
      aria-label={`${primaryLabel} — ${subLabel}`}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {primaryLabel}
          </span>
          <span className="text-xs mt-0.5" style={{ opacity: 0.85 }}>
            {subLabel}
          </span>
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
