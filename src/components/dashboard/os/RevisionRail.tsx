'use client';

/**
 * RevisionRail — the SECONDARY spaced-repetition surface of the Alfa OS
 * dashboard (ff_student_os_v1).
 *
 * Reuses the existing <ReviewsDueCard> (which fetches /api/dashboard/reviews-due
 * and self-suppresses to null when nothing is due) plus a lightweight count of
 * topics flagged due_for_review from useReviewCards. No new data contracts —
 * this is a quieter, decision-secondary framing of work the engine already
 * scheduled. Bilingual via isHi.
 */

import dynamic from 'next/dynamic';
import { useReviewCards } from '@/lib/swr';

const ReviewsDueCard = dynamic(() => import('@/components/dashboard/ReviewsDueCard'), {
  ssr: false,
  loading: () => null,
});

interface RevisionRailProps {
  isHi: boolean;
  studentId: string | undefined;
}

export default function RevisionRail({ isHi, studentId }: RevisionRailProps) {
  // useReviewCards is the existing spaced-repetition reader; we use only its
  // length for a glanceable count. ReviewsDueCard owns the primary CTA.
  const { data: reviewCards, isLoading, error } = useReviewCards(studentId, 20);
  const dueCount = Array.isArray(reviewCards) ? reviewCards.length : 0;

  return (
    <section
      className="rounded-3xl p-4"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      aria-label={isHi ? 'दोहराव' : 'Revision'}
    >
      <div className="flex items-center justify-between mb-3">
        <h2
          className="text-sm font-bold uppercase tracking-wider"
          style={{ color: 'var(--text-3)' }}
        >
          {isHi ? 'दोहराव' : 'Revision'}
        </h2>
        {dueCount > 0 && (
          <span
            className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{
              background: 'rgba(232,88,28,0.1)',
              color: 'var(--orange, #E8581C)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {dueCount}
          </span>
        )}
      </div>

      {error && !isLoading ? (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }} role="status">
          {isHi
            ? 'अभी लोड नहीं हो पाया — रीफ़्रेश करके फिर देखो।'
            : "Couldn't load right now — pull to refresh."}
        </p>
      ) : (
        <>
          {/* ReviewsDueCard renders the CTA or null (when 0 due). */}
          <ReviewsDueCard />

          {dueCount === 0 && (
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
              {isHi
                ? 'अभी कोई दोहराव बाकी नहीं — बढ़िया! नए पाठ पर ध्यान दो।'
                : 'Nothing due right now — nice work. Focus on a fresh lesson.'}
            </p>
          )}
        </>
      )}
    </section>
  );
}