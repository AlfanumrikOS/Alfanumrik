'use client';

import { useExperienceV3 } from '@alfanumrik/lib/use-experience-v3';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function SchoolAdminV3PageGate({ legacy, v3 }: { legacy: React.ReactNode; v3: React.ReactNode }) {
  const { enabled, loading, manifest, routeAllowed } = useExperienceV3('school-admin');
  if (loading) return null;
  return <>{!enabled ? legacy : manifest && routeAllowed ? v3 : null}</>;
}

export function SchoolLegacyRedirect({ href }: { href: string }) {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => { router.replace(`${href}?${params?.toString() ?? ''}`); }, [href, params, router]);
  return null;
}
