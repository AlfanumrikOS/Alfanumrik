'use client';

/**
 * PracticeHeader — streak + sessions-this-week ring for the Alfa OS Practice
 * Center (ff_practice_os_v1, Tier 1+ / presentation-only).
 *
 * The ring is a presentation framing of `stats.last7Days` (sessions completed
 * this week) against a soft weekly target — NOT a score, NOT mastery. The big
 * number students read is the sessions-this-week count, encoded number + glyph
 * (never colour alone). Streak comes from the existing useStudentSnapshot
 * reader (server-authored `current_streak`); never client-counted.
 *
 * States: loading (skeleton), error (distinct from empty), empty (no sessions
 * yet this week → an encouraging zero-state, NOT an error).
 */

import { MasteryRing, Skeleton } from '@alfanumrik/ui/ui';
import { useStudentSnapshot } from '@alfanumrik/lib/swr';
import type { PracticeStats } from './usePracticeHistory';

interface PracticeHeaderProps {
  studentId: string | undefined;
  stats: PracticeStats | undefined;
  isLoading: boolean;
  error: unknown;
  isHi: boolean;
}

// Soft weekly target used ONLY to fill the ring visually. Not a goal the engine
// enforces; purely a presentation denominator so the ring has something to fill.
const WEEKLY_TARGET = 7;

export default function PracticeHeader({
  studentId,
  stats,
  isLoading,
  error,
  isHi,
}: PracticeHeaderProps) {
  const { data: snapshot } = useStudentSnapshot(studentId);
  const streak = snapshot?.current_streak ?? 0;

  if (isLoading && !stats) {
    return (
      <header
        className="flex items-center gap-4 rounded-2xl p-4"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        aria-busy="true"
      >
        <Skeleton width={72} height={72} rounded="rounded-full" />
        <div className="flex-1">
          <Skeleton width="55%" height={20} className="mb-2" />
          <Skeleton width="35%" height={12} />
        </div>
      </header>
    );
  }

  const thisWeek = stats?.last7Days ?? 0;
  const ringValue = Math.min(100, Math.round((thisWeek / WEEKLY_TARGET) * 100));
  const ringColor = thisWeek > 0 ? 'var(--orange, #E8581C)' : 'var(--text-3, #9CA3AF)';

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
        Here the ring means "practice sessions this week", not mastery — so we hide
        the misleading label from assistive tech and announce the real meaning via an
        adjacent sr-only element instead.
      */}
      <div aria-hidden="true">
        <MasteryRing value={ringValue} size={72} strokeWidth={7} color={ringColor}>
          <span
            className="text-xl font-bold"
            style={{
              color: 'var(--text-1)',
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {thisWeek}
          </span>
        </MasteryRing>
      </div>
      <span className="sr-only">
        {isHi
          ? `इस हफ़्ते ${thisWeek} अभ्यास सत्र पूरे`
          : `${thisWeek} practice session${thisWeek === 1 ? '' : 's'} this week`}
      </span>

      <div className="flex-1 min-w-0">
        <h1
          className="text-lg font-bold"
          style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}
        >
          {isHi ? 'अभ्यास केंद्र' : 'Practice Center'}
        </h1>

        {error && !stats ? (
          <p className="text-xs mt-0.5" style={{ color: 'var(--orange)' }} role="status">
            {isHi
              ? 'अभ्यास का सारांश अभी लोड नहीं हो पाया।'
              : "Couldn't load your practice summary right now."}
          </p>
        ) : thisWeek === 0 ? (
          <p
            className="text-xs mt-0.5 flex items-center gap-1.5"
            style={{ color: 'var(--text-3)' }}
          >
            <span aria-hidden="true">✨</span>
            <span>{isHi ? 'इस हफ़्ते अभ्यास शुरू करो' : 'Start practising this week'}</span>
          </p>
        ) : (
          <p
            className="text-xs mt-0.5 flex items-center gap-1.5"
            style={{ color: 'var(--text-3)' }}
          >
            <span aria-hidden="true" style={{ color: ringColor }}>
              ●
            </span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {isHi
                ? `इस हफ़्ते ${thisWeek} सत्र`
                : `${thisWeek} session${thisWeek === 1 ? '' : 's'} this week`}
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
