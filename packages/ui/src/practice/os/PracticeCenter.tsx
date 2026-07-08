'use client';

/**
 * PracticeCenter — the Alfa OS Practice Center hub (ff_practice_os_v1, Tier 1+ /
 * presentation-only), mounted at the NEW /practice route. Renders ONLY when the
 * flag resolves ON (the page gates this; OFF → notFound()).
 *
 * Composition over reuse — the data sections read the existing GET
 * /api/practice/history contract (via usePracticeHistory) plus the existing
 * useMasteryOverview / useStudentSnapshot readers. No DB schema, no new RPC, no
 * scoring/XP/anti-cheat change. Cosmic-LIGHT + data-role="student" is activated
 * via useCosmicLightSurface while mounted. Bilingual via isHi.
 *
 *   1. PracticeHeader     → sessions-this-week ring + streak
 *   2. QuickStartCTA      → single primary handoff to the existing /quiz engine
 *   3. DuePracticeCard    → stats.dueReviewCount nudge
 *   4. WeakTopicLauncher  → weakest started topics → scoped /quiz deep-links
 *   5. PracticeHistory    → recent completed sessions (score verbatim)
 *   6. PracticeInsights   → avg quiz score + error-type + Bloom's bars
 *
 * Below-the-fold sections (4-6) are lazy-loaded (P10) so the first paint stays
 * light. The flag-OFF path never mounts this, so none of this bundle ships there.
 */

import dynamic from 'next/dynamic';
import { useCosmicLightSurface } from '@alfanumrik/lib/use-cosmic-light-surface';
import { Skeleton } from '@alfanumrik/ui/ui';
import PracticeHeader from './PracticeHeader';
import QuickStartCTA from './QuickStartCTA';
import DuePracticeCard from './DuePracticeCard';
import { usePracticeHistory } from './usePracticeHistory';

const sectionLoading = () => <Skeleton height={120} rounded="rounded-2xl" />;
const WeakTopicLauncher = dynamic(() => import('./WeakTopicLauncher'), {
  ssr: false,
  loading: sectionLoading,
});
const PracticeHistory = dynamic(() => import('./PracticeHistory'), {
  ssr: false,
  loading: sectionLoading,
});
const PracticeInsights = dynamic(() => import('./PracticeInsights'), {
  ssr: false,
  loading: sectionLoading,
});

interface PracticeCenterProps {
  studentId: string | undefined;
  grade: string | undefined;
  isHi: boolean;
}

export default function PracticeCenter({ studentId, isHi }: PracticeCenterProps) {
  // Activate Cosmic-LIGHT + student palette while mounted; restores on unmount.
  useCosmicLightSurface(true);

  const { data, isLoading, error } = usePracticeHistory(true);
  const hasData = !!data;

  return (
    <main
      className="mx-auto w-full max-w-2xl px-4 py-5 flex flex-col gap-5"
      style={{ background: 'var(--bg, transparent)' }}
    >
      <PracticeHeader
        studentId={studentId}
        stats={data?.stats}
        isLoading={isLoading}
        error={error}
        isHi={isHi}
      />

      <QuickStartCTA isHi={isHi} />

      <DuePracticeCard
        stats={data?.stats}
        isLoading={isLoading}
        error={error}
        isHi={isHi}
      />

      <WeakTopicLauncher studentId={studentId} isHi={isHi} />

      <PracticeHistory
        sessions={data?.sessions ?? []}
        isLoading={isLoading}
        error={error}
        isHi={isHi}
      />

      <PracticeInsights
        avgScore={data?.stats.avgScore}
        errorPatterns={data?.errorPatterns ?? []}
        bloomDistribution={data?.bloomDistribution ?? []}
        isLoading={isLoading}
        error={error}
        hasData={hasData}
        isHi={isHi}
      />
    </main>
  );
}
