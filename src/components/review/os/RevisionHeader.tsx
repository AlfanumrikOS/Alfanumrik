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
 * Phase 8 rebuild: rides the canonical ProgressRing (a GENERIC caught-up
 * progress ring — deliberately NOT MasteryRing, since this % is neither an
 * accuracy score nor a BKT mastery reading) + Card + Badge primitives. The ring
 * tone (success when caught up, brand otherwise) is the reinforcement; the
 * caught-up % + due-now count carried in the aria-label is the real signal.
 *
 * Streak comes from the existing useStudentSnapshot reader (server-authored
 * `current_streak`); never client-counted.
 *
 * States: loading (skeleton), error (distinct from empty), empty (all caught up).
 */

import { Card, ProgressRing, Badge, Skeleton } from '@/components/ui/primitives';
import { useStudentSnapshot } from '@/lib/swr';
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
      <Card variant="flat" className="flex items-center gap-4 p-4">
        <Skeleton radius="full" className="h-[72px] w-[72px]" />
        <div className="flex-1">
          <Skeleton className="mb-2 h-5 w-[55%]" />
          <Skeleton className="h-3 w-[35%]" />
        </div>
      </Card>
    );
  }

  const dueNow = overview ? overview.overdue.count + overview.dueToday.count : 0;
  const scheduled = overview
    ? overview.overdue.count + overview.dueToday.count + overview.upcoming.count
    : 0;
  // Ring fills toward "caught up". With nothing scheduled the ring is full.
  const cleared = Math.max(0, scheduled - dueNow);
  const ringValue = scheduled === 0 ? 100 : Math.round((cleared / scheduled) * 100);
  const caughtUp = dueNow === 0;

  const ringAria = caughtUp
    ? isHi
      ? `सब दोहराव पूरे — ${ringValue}% तैयार`
      : `All caught up — ${ringValue}% complete`
    : isHi
      ? `अभी ${dueNow} रिवीजन बाकी — ${ringValue}% पूरे`
      : `${dueNow} review${dueNow === 1 ? '' : 's'} due now — ${ringValue}% caught up`;

  return (
    <Card variant="flat" className="flex items-center gap-4 p-4">
      {/*
        Generic caught-up ProgressRing — the tone (success/brand) reinforces the
        state, the centred due-now count is the encoded non-colour signal, and
        the full caught-up sentence rides on the ring's aria-label.
      */}
      <ProgressRing
        value={ringValue}
        size={72}
        strokeWidth={7}
        tone={caughtUp ? 'success' : 'brand'}
        ariaLabel={ringAria}
      >
        <span
          className="text-fluid-lg font-bold tabular-nums text-foreground"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {dueNow}
        </span>
      </ProgressRing>

      <div className="min-w-0 flex-1">
        <h1
          className="text-fluid-lg font-bold text-foreground"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {isHi ? 'दोहराव केंद्र' : 'Revision Center'}
        </h1>

        {error && !overview ? (
          <p className="mt-0.5 text-fluid-xs text-muted-foreground" role="status">
            {isHi
              ? 'दोहराव की सूची अभी लोड नहीं हो पाई।'
              : "Couldn't load your revision list right now."}
          </p>
        ) : caughtUp ? (
          <p className="mt-0.5 flex items-center gap-1.5 text-fluid-xs text-muted-foreground">
            <span aria-hidden="true" style={{ color: 'var(--success)' }}>
              ✓
            </span>
            <span>{isHi ? 'सब दोहराव पूरे — शाबाश!' : 'All caught up — nice work!'}</span>
          </p>
        ) : (
          <p className="mt-0.5 flex items-center gap-1.5 text-fluid-xs text-muted-foreground">
            <span aria-hidden="true" style={{ color: 'var(--primary)' }}>
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
          <Badge tone="warning" variant="soft" icon={<span>🔥</span>} className="mt-1.5 tabular-nums">
            {isHi ? `${streak} दिन की लय` : `${streak}-day streak`}
          </Badge>
        )}
      </div>
    </Card>
  );
}
