'use client';

/**
 * RevisionCenter — the Alfa OS Revision Center hub (ff_revision_os_v1, Tier 1 /
 * presentation-only), mounted at the NEW /revision route. Renders ONLY when the
 * flag resolves ON (the page gates this; OFF → notFound()).
 *
 * Composition over reuse — every section reads the existing
 * GET /api/revision/overview contract (via useRevisionOverview) plus the
 * existing useStudentSnapshot for streak. No DB schema, no new RPC, no
 * scoring/XP/mastery formula. Cosmic-LIGHT + data-role="student" is activated
 * via useCosmicLightSurface while mounted. Bilingual via isHi.
 *
 *   1. RevisionHeader      → total-due ring + streak
 *   2. StartRevisionCTA    → handoff to existing /refresh?tab=flashcards session
 *   3. DueBuckets          → overdue / due-today / upcoming (expandable)
 *   4. RevisionSchedule    → 7-day strip from upcoming.byDay
 *   5. SubjectRevisionLoad → per-subject due count + qualitative impact
 *
 * Below-the-fold sections (3-5) are lazy-loaded (P10) so the first paint stays
 * light. The flag-OFF path never mounts this, so none of this bundle ships there.
 */

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useCosmicLightSurface } from '@alfanumrik/lib/use-cosmic-light-surface';
import { Skeleton } from '@alfanumrik/ui/ui/primitives';
import RevisionHeader from './RevisionHeader';
import StartRevisionCTA from './StartRevisionCTA';
import { useRevisionOverview } from './useRevisionOverview';

const sectionLoading = () => <Skeleton radius="lg" className="h-[120px] w-full" />;
const DueBuckets = dynamic(() => import('./DueBuckets'), { ssr: false, loading: sectionLoading });
const RevisionSchedule = dynamic(() => import('./RevisionSchedule'), {
  ssr: false,
  loading: sectionLoading,
});
const SubjectRevisionLoad = dynamic(() => import('./SubjectRevisionLoad'), {
  ssr: false,
  loading: sectionLoading,
});

interface RevisionCenterProps {
  studentId: string | undefined;
  isHi: boolean;
}

export default function RevisionCenter({ studentId, isHi }: RevisionCenterProps) {
  // Activate Cosmic-LIGHT + student palette while mounted; restores on unmount.
  useCosmicLightSurface(true);

  const { data: overview, isLoading, error } = useRevisionOverview(true);

  const dueNow = overview ? overview.overdue.count + overview.dueToday.count : 0;

  // Due-now items power the per-subject qualitative impact derivation.
  const dueItems = useMemo(
    () =>
      overview ? [...overview.overdue.items, ...overview.dueToday.items] : [],
    [overview]
  );

  return (
    <main
      className="mx-auto w-full max-w-2xl px-4 py-5 flex flex-col gap-5"
      style={{ background: 'var(--bg, transparent)' }}
    >
      <RevisionHeader
        studentId={studentId}
        overview={overview}
        isLoading={isLoading}
        error={error}
        isHi={isHi}
      />

      <StartRevisionCTA
        dueNow={dueNow}
        estimatedMinutes={overview?.estimatedMinutes ?? 0}
        isLoading={isLoading && !overview}
        isHi={isHi}
      />

      <DueBuckets
        overdue={{ kind: 'overdue', count: overview?.overdue.count ?? 0, items: overview?.overdue.items ?? [] }}
        dueToday={{ kind: 'dueToday', count: overview?.dueToday.count ?? 0, items: overview?.dueToday.items ?? [] }}
        upcoming={{ kind: 'upcoming', count: overview?.upcoming.count ?? 0, items: overview?.upcoming.items ?? [] }}
        isLoading={isLoading && !overview}
        error={error}
        isHi={isHi}
      />

      <RevisionSchedule
        byDay={overview?.upcoming.byDay ?? []}
        isLoading={isLoading && !overview}
        error={error}
        isHi={isHi}
      />

      <SubjectRevisionLoad
        subjects={overview?.subjects ?? []}
        dueItems={dueItems}
        isLoading={isLoading && !overview}
        error={error}
        isHi={isHi}
      />
    </main>
  );
}
