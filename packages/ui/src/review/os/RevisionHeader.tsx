'use client';

/**
 * RevisionHeader — total-due ring + streak for the Alfa OS Revision Center
 * (ff_revision_os_v1, Tier 1 / presentation-only).
 *
 * The ring fills toward "all caught up": value = (cleared / scheduled) where
 * scheduled = overdue + dueToday + upcoming and cleared = scheduled − due-now.
 * This is a presentation framing of counts the engine already produced — NO
 * mastery/scoring computation. The big number students read is the actionable
 * due-now count (overdue + dueToday), encoded number + glyph (not colour alone).
 *
 * Streak comes from the existing useStudentSnapshot reader (server-authored
 * `current_streak`); never client-counted.
 *
 * States: loading (skeleton), error (distinct from empty), empty (all caught up).
 */

import { MasteryRing, Skeleton } from '@alfanumrik/ui/ui';
import { useStudentSnapshot } from '@alfanumrik/lib/swr';
import type { RevisionOverview } from './useRevisionOverview';

interface RevisionHeaderProps {
  studentId: string | undefined;
  overview: RevisionOverview | undefined;
  isLoading: boolean;
  error: unknown;
  isHi: boolean;
}

export default function RevisionHeader({
  studentId,
  overview,
  isLoading,
  error,
  isHi,
}: RevisionHeaderProps) {
  const { data: snapshot } = useStudentSnapshot(studentId);
  const streak = snapshot?.current_streak ?? 0;

  if (isLoading && !overview) {
    return (
      <header
        className="flex items-center gap-4 rounded-2xl p-4"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        <Skeleton width={72} height={72} rounded="rounded-full" />
        <div className="flex-1">
          <Skeleton width="55%" height={20} className="mb-2" />
          <Skeleton width="35%" height={12} />
        </div>
      </header>
    );
  }

  const dueNow = overview ? overview.overdue.count + overview.dueToday.count : 0;
  const scheduled = overview
    ? overview.overdue.count + overview.dueToday.count + overview.upcoming.count
    : 0;
  // Ring fills toward "caught up". With nothing scheduled the ring is full.
  const cleared = Math.max(0, scheduled - dueNow);
  const ringValue = scheduled === 0 ? 100 : Math.round((cleared / scheduled) * 100);
  const ringColor = dueNow === 0 ? 'var(--green, #16A34A)' : 'var(--orange, #E8581C)';

  return (
    <header
      className="flex items-center gap-4 rounded-2xl p-4"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {/*
        The shared MasteryRing primitive hardcodes role="img" + aria-label="Mastery: X%".
        Here the ring means "% caught up on revision", not mastery — so we hide the
        misleading label from assistive tech and announce the actionable due-now count
        (and caught-up %) via an adjacent sr-only element instead.
      */}
      <div aria-hidden="true">
        <MasteryRing value={ringValue} size={72} strokeWidth={7} color={ringColor}>
          <span
            className="text-xl font-bold"
            style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}
          >
            {dueNow}
          </span>
        </MasteryRing>
      </div>
      <span className="sr-only">
        {dueNow === 0
          ? isHi
            ? `सब दोहराव पूरे — ${ringValue}% तैयार`
            : `All caught up — ${ringValue}% complete`
          : isHi
            ? `अभी ${dueNow} रिवीजन बाकी — ${ringValue}% पूरे`
            : `${dueNow} review${dueNow === 1 ? '' : 's'} due now — ${ringValue}% caught up`}
      </span>

      <div className="flex-1 min-w-0">
        <h1
          className="text-lg font-bold"
          style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}
        >
          {isHi ? 'दोहराव केंद्र' : 'Revision Center'}
        </h1>

        {error && !overview ? (
          <p className="text-xs mt-0.5" style={{ color: 'var(--orange)' }} role="status">
            {isHi
              ? 'दोहराव की सूची अभी लोड नहीं हो पाई।'
              : "Couldn't load your revision list right now."}
          </p>
        ) : dueNow === 0 ? (
          <p
            className="text-xs mt-0.5 flex items-center gap-1.5"
            style={{ color: 'var(--text-3)' }}
          >
            <span aria-hidden="true" style={{ color: 'var(--green, #16A34A)' }}>
              ✓
            </span>
            <span>{isHi ? 'सब दोहराव पूरे — शाबाश!' : 'All caught up — nice work!'}</span>
          </p>
        ) : (
          <p
            className="text-xs mt-0.5 flex items-center gap-1.5"
            style={{ color: 'var(--text-3)' }}
          >
            <span aria-hidden="true" style={{ color: ringColor }}>
              ●
            </span>
            <span>
              {isHi
                ? `${dueNow} विषय आज दोहराने हैं`
                : `${dueNow} topic${dueNow === 1 ? '' : 's'} to revise now`}
            </span>
          </p>
        )}

        {streak > 0 && (
          <p
            className="text-xs mt-1 flex items-center gap-1.5"
            style={{ color: 'var(--text-3)' }}
          >
            <span aria-hidden="true">🔥</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {isHi ? `${streak} दिन की लय` : `${streak}-day streak`}
            </span>
          </p>
        )}
      </div>
    </header>
  );
}
