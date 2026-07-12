'use client';

import ParentV3PageGate from '../_components/ParentV3PageGate';
import { ParentV3Plan } from '../_components/ParentV3Views';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function ParentPlanPage() {
  return <ParentV3PageGate legacy={<LegacyPlanRedirect />} v3={<ParentV3Plan />} />;
}

function LegacyPlanRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => { router.replace(`/parent/calendar?${params?.toString() ?? ''}`); }, [params, router]);
  return null;
}
