'use client';

import { usePathname } from 'next/navigation';
import { useExperienceV3 } from '@alfanumrik/lib/use-experience-v3';
import type { RoleManifest } from '@alfanumrik/lib/experience-v3';
import { DataState, ExperienceV3Root, RoleShell } from '@alfanumrik/ui/v3';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import './student-v3.css';

export function StudentV3Shell({ children, manifest }: { children: React.ReactNode; manifest: RoleManifest }) {
  const pathname = usePathname() ?? manifest.homeHref;
  return (
    <ExperienceV3Root role="student">
      <RoleShell role="student" navigation={manifest.desktop} mobileMoreItems={manifest.more} activeHref={pathname} brand={{ name: 'Alfanumrik' }}>
        {children}
      </RoleShell>
    </ExperienceV3Root>
  );
}

export default function StudentV3Gate({ legacy, v3, withShell = false }: { legacy: React.ReactNode; v3: React.ReactNode; withShell?: boolean }) {
  const { enabled, loading, manifest, routeAllowed, legacyAllowed, denied } = useExperienceV3('student');
  const { activeRole, isLoading: authLoading } = useAuth();

  if (loading || authLoading) {
    return <DataState state="loading" title="Loading Alfanumrik…" />;
  }

  if (legacyAllowed) return <>{legacy}</>;
  if (denied || !enabled || !routeAllowed || !manifest || activeRole !== 'student') {
    return <DataState state="permission" title="This learning destination is unavailable" />;
  }

  return withShell ? <StudentV3Shell manifest={manifest}>{v3}</StudentV3Shell> : <>{v3}</>;
}
