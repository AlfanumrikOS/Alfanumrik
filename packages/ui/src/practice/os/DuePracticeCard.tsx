'use client';

/**
 * DuePracticeCard — the "due for practice" count for the Alfa OS Practice
 * Center (ff_practice_os_v1, Tier 1+ / presentation-only).
 *
 * Reads `stats.dueReviewCount` from GET /api/practice/history (server-computed
 * spaced-repetition signal) and re-presents it as an actionable nudge. No
 * scoring/XP here. When there is due work it offers a handoff to the EXISTING
 * /quiz engine (generic setup — /quiz has no per-topic "due" deep-link param).
 *
 * The count is encoded number + glyph (never colour alone).
 *
 * States: loading (skeleton), error (distinct from empty), empty (nothing due →
 * a positive "all caught up" zero-state, NOT an error).
 */

import { useRouter } from 'next/navigation';
import { Skeleton } from '@alfanumrik/ui/ui';
import type { PracticeStats } from './usePracticeHistory';

interface DuePracticeCardProps {
  stats: PracticeStats | undefined;
  isLoading: boolean;
  error: unknown;
  isHi: boolean;
}

export default function DuePracticeCard({ stats, isLoading, error, isHi }: DuePracticeCardProps) {
  const router = useRouter();

  if (isLoading && !stats) {
    return <Skeleton height={96} rounded="rounded-2xl" />;
  }

  if (error && !stats) {
    return (
      <div
        className="rounded-2xl p-4 text-sm"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--orange)' }}
        role="status"
      >
        {isHi
          ? 'अभ्यास के लिए बकाया विषय अभी लोड नहीं हो पाए।'
          : "Couldn't load what's due for practice right now."}
      </div>
    );
  }

  const due = stats?.dueReviewCount ?? 0;

  if (due === 0) {
    return (
      <div
        className="rounded-2xl p-4 flex items-center gap-3"
        style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}
      >
        <span aria-hidden="true" className="text-xl" style={{ color: 'var(--green, #16A34A)' }}>
          ✓
        </span>
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'अभी अभ्यास के लिए कुछ बकाया नहीं — बढ़िया!'
            : 'Nothing due for practice right now — nice!'}
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => router.push('/quiz')}
      className="group w-full rounded-2xl px-5 py-4 text-left flex items-center justify-between gap-3 transition-transform duration-150 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{
        minHeight: 48,
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}
      aria-label={
        isHi
          ? `${due} विषय अभ्यास के लिए बकाया — अभ्यास शुरू करो`
          : `${due} topic${due === 1 ? '' : 's'} due for practice — start practising`
      }
    >
      <span className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex items-center justify-center rounded-full"
          style={{
            width: 44,
            height: 44,
            background: 'var(--surface-2)',
            color: 'var(--orange, #E8581C)',
            fontSize: 18,
            fontWeight: 800,
            fontVariantNumeric: 'tabular-nums',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {due}
        </span>
        <span className="flex flex-col">
          <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
            <span aria-hidden="true" className="mr-1">⏳</span>
            {isHi ? 'अभ्यास के लिए बकाया' : 'Due for practice'}
          </span>
          <span className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
            {isHi
              ? `${due} विषय दोहराने का समय है`
              : `${due} topic${due === 1 ? '' : 's'} ready to revisit`}
          </span>
        </span>
      </span>
      <span
        aria-hidden="true"
        className="text-xl transition-transform duration-150 motion-safe:group-hover:translate-x-0.5"
        style={{ color: 'var(--orange, #E8581C)' }}
      >
        →
      </span>
    </button>
  );
}
