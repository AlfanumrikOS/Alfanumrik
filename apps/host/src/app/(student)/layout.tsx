'use client';

import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useExperienceV3 } from '@alfanumrik/lib/use-experience-v3';
import { DataState } from '@alfanumrik/ui/v3';
import { StudentV3Shell } from './_components/StudentV3Gate';

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const { enabled, loading, manifest, routeAllowed } = useExperienceV3('student');
  const { activeRole, isLoading: authLoading } = useAuth();
  if (loading || authLoading) return <DataState state="loading" title="Loading learning workspace…" />;
  if (!enabled || !routeAllowed || !manifest || activeRole !== 'student') return <>{children}</>;
  return <StudentV3Shell manifest={manifest}>{children}</StudentV3Shell>;
}
