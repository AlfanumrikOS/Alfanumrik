'use client';

/**
 * SubjectRevisionLoad — per-subject revision load for the Alfa OS Revision
 * Center (ff_revision_os_v1, Tier 1 / presentation-only).
 *
 * Shows each subject's due count (from overview.subjects) plus a QUALITATIVE
 * mastery-impact label derived from the masteryProbability of that subject's
 * due items (overdue + dueToday). Low mastery ⇒ "high impact". The probability
 * is NEVER rendered as a number — it is not a quiz score. No scoring/XP here.
 *
 * Counts are encoded number + glyph (not colour alone, WCAG 1.4.1).
 *
 * States: loading (skeleton), error (distinct from empty), empty (nothing due).
 */

import { useMemo } from 'react';
import { Skeleton } from '@alfanumrik/ui/ui';
import type { RevisionItem, RevisionSubjectLoad } from './useRevisionOverview';
import { formatSubject, averageImpact, impactMeta } from './revision-labels';

interface SubjectRevisionLoadProps {
  subjects: RevisionSubjectLoad[];
  /** Due-now items (overdue + dueToday) used to derive per-subject impact. */
  dueItems: RevisionItem[];
  isLoading: boolean;
  error: unknown;
  isHi: boolean;
}

export default function SubjectRevisionLoad({
  subjects,
  dueItems,
  isLoading,
  error,
  isHi,
}: SubjectRevisionLoadProps) {
  // Map subject code → list of masteryProbabilities among its due-now items.
  const probsBySubject = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const item of dueItems) {
      const arr = map.get(item.subject) ?? [];
      arr.push(item.masteryProbability);
      map.set(item.subject, arr);
    }
    return map;
  }, [dueItems]);

  const heading = (
    <h2
      className="text-sm font-bold uppercase tracking-wider mb-3"
      style={{ color: 'var(--text-3)' }}
    >
      {isHi ? 'विषयवार दोहराव' : 'By subject'}
    </h2>
  );

  if (isLoading) {
    return (
      <section
        className="rounded-2xl p-4"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        {heading}
        <div className="flex flex-col gap-2">
          <Skeleton height={40} rounded="rounded-xl" />
          <Skeleton height={40} rounded="rounded-xl" />
        </div>
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
          {isHi ? 'विषयवार सूची लोड नहीं हो पाई।' : "Couldn't load the per-subject view."}
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      aria-label={isHi ? 'विषयवार दोहराव भार' : 'Revision load by subject'}
    >
      {heading}

      {subjects.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'अभी किसी विषय में दोहराव बाकी नहीं।'
            : 'No subject has revision due right now.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {subjects.map((s) => {
            const impact = impactMeta(averageImpact(probsBySubject.get(s.subject) ?? []), isHi);
            return (
              <li
                key={s.subject}
                className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
                style={{ background: 'var(--surface-2)', minHeight: 48 }}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{
                      background: 'var(--surface-1)',
                      color: 'var(--text-1)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                    aria-label={isHi ? `${s.dueCount} विषय` : `${s.dueCount} due`}
                  >
                    {s.dueCount}
                  </span>
                  <span className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>
                    {formatSubject(s.subject)}
                  </span>
                </span>
                <span
                  className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold"
                  style={{ color: impact.color }}
                >
                  <span aria-hidden="true">{impact.glyph}</span>
                  <span>{impact.label}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
