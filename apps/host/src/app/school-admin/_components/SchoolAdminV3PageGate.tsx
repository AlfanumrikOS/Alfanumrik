'use client';

import { useExperienceV3 } from '@alfanumrik/lib/use-experience-v3';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DataState } from '@alfanumrik/ui/v3';

export default function SchoolAdminV3PageGate({ legacy, v3 }: { legacy: React.ReactNode; v3: React.ReactNode }) {
  const { enabled, loading, manifest, routeMapped, routeAllowed, legacyAllowed, denied } = useExperienceV3('school-admin');
  if (loading) return null;
  if (legacyAllowed) return <>{legacy}</>;
  if (denied || !enabled || !manifest) return <DataState state="permission" title="This school destination is unavailable" />;
  if (!routeMapped) return <>{legacy}</>;
  if (!routeAllowed) return <DataState state="permission" title="This school destination is unavailable" />;
  return <>{v3}</>;
}

export function SchoolLegacyRedirect({ href }: { href: string }) {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => { router.replace(`${href}?${params?.toString() ?? ''}`); }, [href, params, router]);
  return null;
}
