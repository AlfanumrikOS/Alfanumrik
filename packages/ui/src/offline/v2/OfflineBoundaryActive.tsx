'use client';

/**
 * OfflineBoundaryActive — the real offline-detection logic.
 *
 * Split out of OfflineBoundary.tsx (2026-08-02, P10 shared-JS fix — see that
 * file's header for the full story). This component is loaded ONLY via
 * `next/dynamic({ ssr: false })` from OfflineBoundary.tsx, and ONLY once
 * `flags.ff_offline_v2 === true`. That is what keeps useOfflineState() and
 * its transitive import of packages/lib/src/offline/store.ts (the IndexedDB
 * open/eviction/write-queue/replay module) out of the always-on shared
 * bundle for the (today: 100%) flag-off population.
 *
 * ssr:false is safe HERE specifically because a logged-in student who
 * already has `ff_offline_v2` on is, by definition, past hydration and
 * client-interactive by the time this branch is ever reached — the parent
 * shell (OfflineBoundary.tsx) only constructs this component after
 * useFeatureFlags() has resolved truthy, which can only happen client-side,
 * strictly after the first paint. So there is no server-rendered content for
 * ssr:false to suppress here, unlike a hypothetical ssr:false directly on
 * OfflineBoundary itself, which would have suppressed real page content
 * (this component's `children`) from SSR HTML for every logged-in student
 * page regardless of flag state — that's the mistake this split avoids.
 *
 * `isOffline` (from useOfflineState) itself only ever flips inside a
 * client-only useEffect, so even on this component's own first render it
 * always takes the `children` branch below — nothing here can produce a
 * flash of the offline screen that wasn't already true a moment earlier.
 *
 * `OfflineState` (the heavy full-screen replacement UI: chapter list, queue
 * banner, saved-explanations, Foxy-disabled card) is dynamically imported
 * with its own ssr:false, same as before the split — it is only reachable
 * once `isOffline` is already true, so it never suppresses real content
 * either, and its markup stays out of the bundle for students who never go
 * offline.
 */

import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useOfflineState } from '@alfanumrik/lib/offline/use-offline-state';
import { touchChapter } from '@alfanumrik/lib/offline/store';

const OfflineState = dynamic(() => import('./OfflineState'), { ssr: false });

export default function OfflineBoundaryActive({
  children,
  isHi,
}: {
  children: React.ReactNode;
  isHi: boolean;
}) {
  const router = useRouter();
  const { isOffline, chapters, pending, savedExplanations } = useOfflineState();

  if (!isOffline) return <>{children}</>;

  const answerCount = pending.filter((p) => p.kind === 'quiz_answer').length;
  const sessionCount = pending.filter((p) => p.kind === 'quiz_session').length;

  return (
    <OfflineState
      isHi={isHi}
      chapters={chapters.map((c) => ({
        id: c.id,
        title: c.title,
        subjectCode: c.subjectCode,
        summary: isHi
          ? 'पूरा अध्याय + ' + c.questionCount + ' प्रश्न'
          : 'Full chapter + ' + c.questionCount + ' questions',
      }))}
      queue={{ answerCount, sessionCount }}
      savedExplanationCount={savedExplanations.length}
      onOpenChapter={(c) => {
        void touchChapter(c.id);
        router.push('/learn/' + c.subjectCode);
      }}
      onOpenSavedExplanations={() => router.push('/foxy?saved=1')}
    />
  );
}
