'use client';

/**
 * /practice — the Alfa OS Practice Center (ff_practice_os_v1, Tier 1+ /
 * presentation-only). NEW route; it does not exist today.
 *
 * Additive contract: when the flag is OFF the route behaves as a non-route —
 * students are redirected to the existing /quiz engine (the pre-launch
 * equivalent), never stranded on a 404. The flag is read client-side, so this
 * page resolves it and:
 *
 *   • flag PENDING (first paint, async DB read not yet settled) → skeleton.
 *     We do NOT redirect prematurely, or a legitimately-ON user would flash away.
 *   • flag OFF (resolved)                                       → redirect to /quiz.
 *   • flag ON  (resolved)                                       → PracticeCenter.
 *
 * Auth is required (student surface). The Practice Center consumes the existing
 * GET /api/practice/history endpoint (backend-owned) plus the existing
 * useMasteryOverview / useStudentSnapshot readers. No schema/scoring/XP change
 * here — presentation only. The single Quick-Start CTA hands off to the
 * EXISTING /quiz engine; the quiz engine itself is never modified.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useRequireAuth } from '@alfanumrik/lib/useRequireAuth';
import { usePracticeOsFlag } from '@alfanumrik/lib/use-practice-os-flag';
import { Skeleton } from '@alfanumrik/ui/ui';

// Keep the pending state within the same content column as PracticeCenter.
// A full-viewport fallback moves the persistent student navigation and causes
// a large layout shift when the flag/auth state and lazy chunk resolve.
function PracticeCenterSkeleton() {
  return (
    <main
      className="mx-auto w-full max-w-2xl px-4 py-5 flex flex-col gap-5"
      aria-busy="true"
      aria-label="Loading practice center"
    >
      <Skeleton height={112} rounded="rounded-2xl" />
      <Skeleton height={156} rounded="rounded-2xl" />
      <Skeleton height={112} rounded="rounded-2xl" />
      <Skeleton height={120} rounded="rounded-2xl" />
      <Skeleton height={120} rounded="rounded-2xl" />
    </main>
  );
}

// Lazy-load the hub so the flag-OFF path never fetches this bundle.
const PracticeCenter = dynamic(() => import('@alfanumrik/ui/practice/os/PracticeCenter'), {
  ssr: false,
  loading: () => <PracticeCenterSkeleton />,
});

function LegacyPracticePage() {
  const { isReady, student, isHi } = useRequireAuth();
  const flag = usePracticeOsFlag();
  const router = useRouter();

  useEffect(() => {
    if (flag === 'off') router.replace('/quiz');
  }, [flag, router]);

  // Resolved OFF → the route does not exist. (PENDING falls through to a
  // skeleton so we never 404 a legitimately-ON user on first paint.)
  if (flag === 'off') {
    return <PracticeCenterSkeleton />;
  }

  // Still resolving the flag, or auth not ready yet → preserve final layout.
  if (flag === 'pending' || !isReady) {
    return <PracticeCenterSkeleton />;
  }

  // flag === 'on' and auth ready → render the Practice Center.
  return <PracticeCenter studentId={student?.id} grade={student?.grade} isHi={isHi} />;
}

export default function PracticePage() {
  return <LegacyPracticePage />;
}
