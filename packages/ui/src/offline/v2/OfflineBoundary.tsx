'use client';

/**
 * OfflineBoundary — mounts the offline screen over the student surface when
 * the device drops connection.
 *
 * MOUNT POINT (fixed 2026-08-02 during review): the original handoff called
 * mounting this in `apps/host/src/app/(student)/layout.tsx` a one-liner, but
 * that layout does not wrap `/today`, `/foxy`, or `/review` — all top-level
 * routes outside the `(student)` route group — so it would never have
 * protected the pages this feature exists for. It is mounted instead in
 * `packages/ui/src/navigation/GlobalAppLayout.tsx`, which already wraps every
 * route from the root layout, scoped there to the logged-in student surface
 * (see the comment at that call site for why it is scoped, and why it is
 * NOT ssr:false there).
 *
 * Flag: ff_offline_v2. When the flag is off, or the device is online, this
 * renders `children` untouched — the route behaves exactly as it does today.
 * `isOffline` (from useOfflineState) can only ever become true inside a
 * client-only `useEffect`, so this component always takes the `children`
 * branch during SSR regardless of flag state — nothing here can change
 * server-rendered output.
 *
 * `OfflineState` (the heavy full-screen replacement UI: chapter list, queue
 * banner, saved-explanations, Foxy-disabled card) is dynamically imported
 * with ssr:false. That is safe specifically because the branch that renders
 * it is only reachable once `isOffline` has already flipped true — which, per
 * the paragraph above, never happens during SSR — so it never suppresses
 * real content the way ssr:false on THIS wrapper would. This keeps its markup
 * out of the shared bundle every route (including ones that never go
 * offline) would otherwise pay for.
 */

import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useFeatureFlags } from '@alfanumrik/lib/swr';
import { useOfflineState } from '@alfanumrik/lib/offline/use-offline-state';
import { touchChapter } from '@alfanumrik/lib/offline/store';

const OfflineState = dynamic(() => import('./OfflineState'), { ssr: false });

export default function OfflineBoundary({
  children,
  isHi,
}: {
  children: React.ReactNode;
  isHi: boolean;
}) {
  const router = useRouter();
  const { data: flags } = useFeatureFlags();
  const { isOffline, chapters, pending, savedExplanations } = useOfflineState();

  if (flags?.ff_offline_v2 !== true || !isOffline) return <>{children}</>;

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
