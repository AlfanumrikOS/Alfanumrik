'use client';

import { useExperienceV3 } from '@alfanumrik/lib/use-experience-v3';
import { DataState } from '@alfanumrik/ui/v3';
import SchoolAdminShell from './SchoolAdminShell';
import SchoolAdminV3Shell from './SchoolAdminV3Shell';

export default function SchoolAdminV3LayoutGate({ children }: { children: React.ReactNode }) {
  const { enabled, loading, manifest, routeMapped, routeAllowed, scope, legacyAllowed, denied } = useExperienceV3('school-admin');
  if (loading) return <div className="flex min-h-dvh items-center justify-center" role="status">Loading school portal…</div>;
  if (legacyAllowed) return <SchoolAdminShell>{children}</SchoolAdminShell>;
  if (denied || !enabled || !manifest) return <DataState state="permission" title="This school destination is unavailable" />;
  if (!routeMapped) return <SchoolAdminShell>{children}</SchoolAdminShell>;
  if (!routeAllowed) return <DataState state="permission" title="This school destination is unavailable" />;
  return <SchoolAdminV3Shell manifest={manifest} authoritativeScope={scope}>{children}</SchoolAdminV3Shell>;
}
