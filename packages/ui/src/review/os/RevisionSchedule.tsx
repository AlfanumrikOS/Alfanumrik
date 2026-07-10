'use client';

/**
 * RevisionSchedule — a 7-day strip of the Alfa OS Revision Center
 * (ff_revision_os_v1, Tier 1 / presentation-only), built from
 * overview.upcoming.byDay (one entry per day, today+1 .. today+7).
 *
 * Each day shows weekday + date + a due count. Counts are encoded number +
 * bar height (not colour alone, WCAG 1.4.1). No scoring/XP.
 *
 * States: loading (skeleton), error (distinct from empty), empty (no upcoming).
 */

import { Skeleton } from '@alfanumrik/ui/ui';
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
    <h2
      className="text-sm font-bold uppercase tracking-wider mb-3"
      style={{ color: 'var(--text-3)' }}
    >
      {isHi ? 'अगले 7 दिन' : 'Next 7 days'}
    </h2>
  );

  if (isLoading) {
    return (
      <section
        className="rounded-2xl p-4"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        {heading}
        <Skeleton height={72} rounded="rounded-xl" />
      </section>
    );
  }

  if (error) {
    return (
      <section
        className="rounded-2xl p-4"
        style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid var(--red, #DC2626)' }}
        role="status"
      >
        {heading}
        <p className="text-sm flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
          <span aria-hidden="true" style={{ color: 'var(--red, #DC2626)' }}>⚠</span>
          {isHi ? 'शेड्यूल लोड नहीं हो पाया।' : "Couldn't load your schedule."}
        </p>
      </section>
    );
  }

  const total = byDay.reduce((s, d) => s + d.count, 0);
  const max = Math.max(1, ...byDay.map((d) => d.count));

  return (
    <section
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      aria-label={isHi ? 'अगले 7 दिन का दोहराव शेड्यूल' : 'Next 7 days revision schedule'}
    >
      {heading}

      {total === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
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
                className="flex-1 flex flex-col items-center gap-1"
                title={`${isoLabel}: ${d.count}`}
              >
                <span
                  className="text-xs font-bold"
                  style={{
                    color: d.count > 0 ? 'var(--text-1)' : 'var(--text-3)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                  aria-hidden="true"
                >
                  {d.count}
                </span>
                <span
                  className="w-full rounded-md transition-[height] duration-300"
                  style={{
                    height: Math.max(4, Math.round((barPct / 100) * 40)),
                    background:
                      d.count > 0 ? 'var(--orange, #E8581C)' : 'var(--surface-2)',
                    opacity: d.count > 0 ? 0.85 : 1,
                  }}
                  aria-hidden="true"
                />
                <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                  {weekday}
                </span>
                <span
                  className="text-[10px]"
                  style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {day}
                </span>
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
    </section>
  );
}
