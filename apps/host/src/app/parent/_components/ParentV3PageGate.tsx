'use client';

import { useExperienceV3 } from '@alfanumrik/lib/use-experience-v3';
import { DataState } from '@alfanumrik/ui/v3';
import { useParentAuth } from './useParentAuth';

export default function ParentV3PageGate({ legacy, v3 }: { legacy: React.ReactNode; v3: React.ReactNode }) {
  const { enabled, loading, manifest, routeMapped, routeAllowed, legacyAllowed, denied } = useExperienceV3('parent');
  const parentAuth = useParentAuth();
  if (loading || parentAuth.loading) return null;
  if (legacyAllowed) return <>{legacy}</>;
  if (denied || !enabled || parentAuth.mode !== 'guardian' || !manifest) return <DataState state="permission" title="This parent destination is unavailable" />;
  if (!routeMapped) return <>{legacy}</>;
  if (!routeAllowed) return <DataState state="permission" title="This parent destination is unavailable" />;
  return <>{v3}</>;
}
