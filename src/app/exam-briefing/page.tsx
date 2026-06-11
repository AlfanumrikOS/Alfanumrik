'use client';

/**
 * /exam-briefing — the Alfa OS pre-test BRIEFING hub (ff_test_os_v1, Tier 1 /
 * presentation-only). NEW route; it does not exist today.
 *
 * NOTE: this is NOT /exam-prep — that is a LIVE production surface (Study Menu
 * v2 "Exam Sprint", REG-69) and is untouched. This is a separate, additive
 * route whose OFF path behaves as if it never existed.
 *
 * Additive contract: when the flag is OFF the route must behave as if it never
 * existed. The flag is read client-side, so this page resolves it and:
 *
 *   • flag PENDING (first paint, async DB read not yet settled) → skeleton.
 *     We do NOT 404 prematurely, or a legitimately-ON user would flash a 404.
 *   • flag OFF (resolved)                                       → notFound().
 *   • flag ON  (resolved)                                       → ExamBriefingHub.
 *
 * Auth is required (student surface). The hub re-presents the existing client
 * read of exam_configs + exam_chapters (RLS-scoped to the student) plus the
 * existing subject/chapter readiness readers. No schema/scoring/XP/exam-timing
 * change here — presentation only. The Start CTA hands off to the EXISTING exam
 * runtime (/exams/mock/[paperId] or /quiz?mode=exam&exam_id=...); the engines
 * themselves are never modified.
 */

import { notFound } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { useTestOsFlag } from '@/lib/use-test-os-flag';
import { LoadingFoxy } from '@/components/ui';

// Lazy-load the hub so the flag-OFF/404 path never fetches this bundle.
const ExamBriefingHub = dynamic(() => import('@/components/exam-briefing/os/ExamBriefingHub'), {
  ssr: false,
  loading: () => <LoadingFoxy />,
});

export default function ExamBriefingPage() {
  const { isReady, student, isHi } = useRequireAuth();
  const flag = useTestOsFlag();

  // Resolved OFF → the route does not exist. (PENDING falls through to a
  // skeleton so we never 404 a legitimately-ON user on first paint.)
  if (flag === 'off') {
    notFound();
  }

  // Still resolving the flag, or auth not ready yet → neutral loading.
  if (flag === 'pending' || !isReady) {
    return <LoadingFoxy />;
  }

  // flag === 'on' and auth ready → render the briefing hub.
  return <ExamBriefingHub studentId={student?.id} grade={student?.grade} isHi={isHi} />;
}
