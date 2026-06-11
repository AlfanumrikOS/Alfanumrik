'use client';

/**
 * /revision — the Alfa OS Revision Center (ff_revision_os_v1, Tier 1 /
 * presentation-only). NEW route; it does not exist today.
 *
 * Additive contract: when the flag is OFF the route must behave as if it never
 * existed. The flag is read client-side, so this page resolves it and:
 *
 *   • flag PENDING (first paint, async DB read not yet settled) → skeleton.
 *     We do NOT 404 prematurely, or a legitimately-ON user would flash a 404.
 *   • flag OFF (resolved)                                       → notFound().
 *   • flag ON  (resolved)                                       → RevisionCenter.
 *
 * Auth is required (student surface). The Revision Center consumes the existing
 * GET /api/revision/overview endpoint (backend-owned). No schema/scoring/XP
 * change here — presentation only.
 */

import { notFound } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useRevisionOsFlag } from '@/lib/use-revision-os-flag';
import { LoadingFoxy } from '@/components/ui';

// Lazy-load the hub so the flag-OFF/404 path never fetches this bundle.
const RevisionCenter = dynamic(() => import('@/components/review/os/RevisionCenter'), {
  ssr: false,
  loading: () => <LoadingFoxy />,
});

export default function RevisionPage() {
  const { isReady, student, isHi } = useRequireAuth();
  const flag = useRevisionOsFlag();

  // Resolved OFF → the route does not exist. (PENDING falls through to a
  // skeleton so we never 404 a legitimately-ON user on first paint.)
  if (flag === 'off') {
    notFound();
  }

  // Still resolving the flag, or auth not ready yet → neutral loading.
  if (flag === 'pending' || !isReady) {
    return <LoadingFoxy />;
  }

  // flag === 'on' and auth ready → render the Revision Center.
  return <RevisionCenter studentId={student?.id} isHi={isHi} />;
}
