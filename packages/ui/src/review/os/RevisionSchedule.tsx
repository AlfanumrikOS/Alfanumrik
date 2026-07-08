'use client';

/**
 * RevisionSchedule — a 7-day strip of the Alfa OS Revision Center
 * (ff_revision_os_v1, Tier 1 / presentation-only), built from
 * overview.upcoming.byDay (one entry per day, today+1 .. today+7).
 *
 * Each day shows weekday + date + a due count. Counts are encoded number +
 * bar height (not colour alone, WCAG 1.4.1). No scoring/XP.
 *
 * Phase 8 rebuild: Card container + Alert error state; bar fills and text use
 * semantic tokens only (primary / surface-2 / foreground) — zero raw hex/rgb.
 *
 * States: loading (skeleton), error (distinct from empty), empty (no upcoming).
 */

import { Card, Alert, Skeleton } from '@alfanumrik/ui/ui/primitives';
import { formatShortDay } from './revision-labels';

interface RevisionScheduleProps {
  byDay: { date: string; count: number }[];
  isLoading: boolean;
  error: unknown;
  isHi: boolean;
}

export default function RevisionSchedule({
  byDay,
  isLoading,
  error,
  isHi,
}: RevisionScheduleProps) {
  const heading = (
    <h2 className="mb-3 text-fluid-xs font-bold uppercase tracking-wider text-muted-foreground">
      {isHi ? 'अगले 7 दिन' : 'Next 7 days'}
    </h2>
  );

  if (isLoading) {
    return (
      <Card variant="flat" className="p-4">
        {heading}
        <Skeleton radius="lg" className="h-[72px] w-full" />
      </Card>
    );
  }

  if (error) {
    return (
      <Alert tone="danger" title={isHi ? 'अगले 7 दिन' : 'Next 7 days'}>
        {isHi ? 'शेड्यूल लोड नहीं हो पाया।' : "Couldn't load your schedule."}
      </Alert>
    );
  }

  const total = byDay.reduce((s, d) => s + d.count, 0);
  const max = Math.max(1, ...byDay.map((d) => d.count));

  return (
    <Card
      variant="flat"
      className="p-4"
      aria-label={isHi ? 'अगले 7 दिन का दोहराव शेड्यूल' : 'Next 7 days revision schedule'}
    >
      {heading}

      {total === 0 ? (
        <p className="text-fluid-xs text-muted-foreground">
          {isHi
            ? 'इस हफ़्ते कोई दोहराव तय नहीं — आगे बढ़ते रहो।'
            : 'Nothing scheduled this week — keep going.'}
        </p>
      ) : (
        <ul className="flex items-end justify-between gap-1">
          {byDay.map((d) => {
            const { weekday, day, isoLabel } = formatShortDay(d.date, isHi);
            const barPct = d.count === 0 ? 0 : Math.round((d.count / max) * 100);
            return (
              <li
                key={d.date}
                className="flex flex-1 flex-col items-center gap-1"
                title={`${isoLabel}: ${d.count}`}
              >
                <span
                  className="text-fluid-xs font-bold tabular-nums"
                  style={{ color: d.count > 0 ? 'var(--text-1)' : 'var(--text-3)' }}
                  aria-hidden="true"
                >
                  {d.count}
                </span>
                <span
                  className="w-full rounded-md transition-[height] duration-300 motion-reduce:transition-none"
                  style={{
                    height: Math.max(4, Math.round((barPct / 100) * 40)),
                    background: d.count > 0 ? 'var(--primary)' : 'var(--surface-2)',
                  }}
                  aria-hidden="true"
                />
                <span className="text-fluid-2xs text-muted-foreground">{weekday}</span>
                <span className="text-fluid-2xs tabular-nums text-muted-foreground">{day}</span>
                <span className="sr-only">
                  {isHi
                    ? `${isoLabel}: ${d.count} विषय`
                    : `${isoLabel}: ${d.count} topic${d.count === 1 ? '' : 's'}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
