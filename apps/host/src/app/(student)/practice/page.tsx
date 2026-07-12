'use client';

/**
 * /practice — the Alfa OS Practice Center (ff_practice_os_v1, Tier 1+ /
 * presentation-only). NEW route; it does not exist today.
 *
 * Additive contract: when the flag is OFF the route must behave as if it never
 * existed. The flag is read client-side, so this page resolves it and:
 *
 *   • flag PENDING (first paint, async DB read not yet settled) → skeleton.
 *     We do NOT 404 prematurely, or a legitimately-ON user would flash a 404.
 *   • flag OFF (resolved)                                       → notFound().
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
import { LoadingFoxy } from '@alfanumrik/ui/ui';
import StudentV3Gate from '../_components/StudentV3Gate';
import { StudentPracticeV3 } from '../_components/StudentV3Pages';

// Lazy-load the hub so the flag-OFF/404 path never fetches this bundle.
const PracticeCenter = dynamic(() => import('@alfanumrik/ui/practice/os/PracticeCenter'), {
  ssr: false,
  loading: () => <LoadingFoxy />,
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
    return <LoadingFoxy />;
  }

  // Still resolving the flag, or auth not ready yet → neutral loading.
  if (flag === 'pending' || !isReady) {
    return <LoadingFoxy />;
  }

  // flag === 'on' and auth ready → render the Practice Center.
  return <PracticeCenter studentId={student?.id} grade={student?.grade} isHi={isHi} />;
}

export default function PracticePage() {
  return <StudentV3Gate legacy={<LegacyPracticePage />} v3={<StudentPracticeV3 />} />;
}
