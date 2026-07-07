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
 * Phase 8 rebuild: Card container + Badge counts + Alert error state; impact
 * hues come from the tokenised revision-labels helper — zero raw hex/rgb.
 *
 * States: loading (skeleton), error (distinct from empty), empty (nothing due).
 */

import { useMemo } from 'react';
import { Card, Badge, Alert, Skeleton } from '@alfanumrik/ui/ui/primitives';
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
    <h2 className="mb-3 text-fluid-xs font-bold uppercase tracking-wider text-muted-foreground">
      {isHi ? 'विषयवार दोहराव' : 'By subject'}
    </h2>
  );

  if (isLoading) {
    return (
      <Card variant="flat" className="p-4">
        {heading}
        <div className="flex flex-col gap-2">
          <Skeleton radius="lg" className="h-10 w-full" />
          <Skeleton radius="lg" className="h-10 w-full" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert tone="danger" title={isHi ? 'विषयवार दोहराव' : 'By subject'}>
        {isHi ? 'विषयवार सूची लोड नहीं हो पाई।' : "Couldn't load the per-subject view."}
      </Alert>
    );
  }

  return (
    <Card
      variant="flat"
      className="p-4"
      aria-label={isHi ? 'विषयवार दोहराव भार' : 'Revision load by subject'}
    >
      {heading}

      {subjects.length === 0 ? (
        <p className="text-fluid-xs text-muted-foreground">
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
                className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5"
                style={{ minHeight: 48 }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Badge
                    tone="neutral"
                    variant="soft"
                    className="shrink-0 tabular-nums"
                    aria-label={isHi ? `${s.dueCount} विषय` : `${s.dueCount} due`}
                  >
                    {s.dueCount}
                  </Badge>
                  <span className="truncate text-fluid-sm font-medium text-foreground">
                    {formatSubject(s.subject)}
                  </span>
                </span>
                <span
                  className="inline-flex shrink-0 items-center gap-1 text-fluid-xs font-semibold"
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
    </Card>
  );
}
