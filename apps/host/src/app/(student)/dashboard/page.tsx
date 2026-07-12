'use client';

import { useEffect } from 'react';
import { DashboardSkeleton } from '@alfanumrik/ui/Skeleton';
import { DataState } from '@alfanumrik/ui/v3';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { resolveExperienceV3Landing } from '@alfanumrik/lib/experience-v3';
import { useExperienceV3 } from '@alfanumrik/lib/use-experience-v3';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

const StudentOSDashboard = dynamic(() => import('./StudentOSDashboard'), {
  ssr: false,
  loading: () => <DashboardSkeleton />,
});

export default function Dashboard() {
  const router = useRouter();
  const { activeRole, isLoading: authLoading } = useAuth();
  const v3 = useExperienceV3('student');

  const decision = v3.loading || authLoading
    ? null
    : v3.legacyAllowed
      ? { kind: 'legacy' as const }
      : v3.denied || !v3.enabled || !v3.manifest
        ? { kind: 'denied' as const }
        : activeRole !== 'student'
          ? { kind: 'denied' as const }
          : !v3.routeMapped
            ? { kind: 'legacy' as const }
            : !v3.routeAllowed
            ? { kind: 'denied' as const }
            : resolveExperienceV3Landing({
                enabled: v3.enabled,
                manifest: v3.manifest,
                legacyPath: '/dashboard',
              });

  const redirectHref = decision?.kind === 'redirect' ? decision.href : null;
  useEffect(() => {
    if (redirectHref) router.replace(redirectHref);
  }, [redirectHref, router]);

  if (!decision || decision.kind === 'redirect') return <DashboardSkeleton />;
  if (decision.kind === 'denied') {
    return <DataState state="permission" title="This learning destination is unavailable" />;
  }
  return <StudentOSDashboard />;
}
