'use client';

import { useAuth } from '@/lib/AuthContext';
import type { SuggestedAlternative } from '@/components/foxy/ChatBubble';

/* ═══════════════════════════════════════════════════════════════
   AlternativesGrid — grid of up-to-3 suggested NCERT chapters.

   The server has already picked the semantic top-3 (per spec §6),
   so this component just renders them and offers a "See all N
   ready chapters →" link when `totalReady` exceeds the visible
   count.

   Responsive: 3-col on desktop (sm breakpoint and up),
   1-col on mobile.
   ═══════════════════════════════════════════════════════════════ */

export interface AlternativesGridProps {
  alternatives: SuggestedAlternative[];
  /** Total chapters currently ready for this grade+subject. */
  totalReady?: number;
  /** Invoked when a student taps a chapter card. */
  onPick: (alt: SuggestedAlternative) => void;
  /** Invoked when the "See all N ready chapters" link is clicked. */
  onShowAll?: () => void;
  /** Accent color scheme — matches the parent card context. */
  tone?: 'amber' | 'purple';
}

const TONE_STYLES = {
  amber: {
    card: 'border-amber-200 bg-white text-amber-900 hover:border-amber-400 hover:bg-amber-50',
    link: 'text-amber-700 hover:text-amber-900',
  },
  purple: {
    card: 'border-purple-200 bg-white text-purple-900 hover:border-purple-400 hover:bg-purple-50',
    link: 'text-purple-700 hover:text-purple-900',
  },
} as const;

export function AlternativesGrid({
  alternatives,
  totalReady,
  onPick,
  onShowAll,
  tone = 'purple',
}: AlternativesGridProps) {
  const { isHi } = useAuth();

  if (!alternatives || alternatives.length === 0) return null;

  const visible = alternatives.slice(0, 3);
  const styles = TONE_STYLES[tone];
  const showSeeAll =
    typeof totalReady === 'number' && totalReady > visible.length && Boolean(onShowAll);

  return (
    <div data-testid="alternatives-grid">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {visible.map((alt) => (
          <li key={`${alt.subject_code}-${alt.chapter_number}`}>
            <button
              type="button"
              onClick={() => onPick(alt)}
              className={`w-full rounded-lg border px-3 py-2 text-left text-[11px] font-medium transition active:scale-[0.98] ${styles.card}`}
            >
              <span className="block font-semibold">
                {isHi ? `Adhyay ${alt.chapter_number}` : `Ch. ${alt.chapter_number}`}
              </span>
              <span className="mt-0.5 block">{alt.chapter_title}</span>
            </button>
          </li>
        ))}
      </ul>

      {showSeeAll && onShowAll && (
        <button
          type="button"
          onClick={onShowAll}
          className={`mt-2 text-[11px] font-semibold underline underline-offset-2 ${styles.link}`}
        >
          {isHi
            ? `Saare ${totalReady} ready chapters dikhaiye →`
            : `See all ${totalReady} ready chapters →`}
        </button>
      )}
    </div>
  );
}