'use client';

import { useExperienceV3 } from '@alfanumrik/lib/use-experience-v3';
import { DataState } from '@alfanumrik/ui/v3';
import ParentShell from './ParentShell';
import ParentV3Shell from './ParentV3Shell';

export default function ParentV3LayoutGate({ children }: { children: React.ReactNode }) {
  const { enabled, loading, manifest, routeMapped, routeAllowed, scope, legacyAllowed, denied } = useExperienceV3('parent');
  if (loading) return <div className="flex min-h-dvh items-center justify-center" role="status">Loading parent portal…</div>;
  if (legacyAllowed) return <ParentShell>{children}</ParentShell>;
  if (denied || !enabled || !manifest) return <DataState state="permission" title="This parent destination is unavailable" />;
  if (!routeMapped) return <ParentShell>{children}</ParentShell>;
  if (!routeAllowed) return <DataState state="permission" title="This parent destination is unavailable" />;
  return <ParentV3Shell manifest={manifest} authoritativeChildId={scope?.childId ?? null}>{children}</ParentV3Shell>;
}
