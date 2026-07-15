'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function ParentPlanPage() {
  return <LegacyPlanRedirect />;
}

function LegacyPlanRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => { router.replace(`/parent/calendar?${params?.toString() ?? ''}`); }, [params, router]);
  return null;
}
