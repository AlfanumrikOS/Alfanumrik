'use client';

import { useExperienceV3 } from '@alfanumrik/lib/use-experience-v3';
import { useParentAuth } from './useParentAuth';

export default function ParentV3PageGate({ legacy, v3 }: { legacy: React.ReactNode; v3: React.ReactNode }) {
  const { enabled, loading, manifest, routeAllowed } = useExperienceV3('parent');
  const parentAuth = useParentAuth();
  if (loading || parentAuth.loading) return null;
  if (!enabled || parentAuth.mode !== 'guardian') return <>{legacy}</>;
  if (!manifest || !routeAllowed) return null;
  return <>{v3}</>;
}
