'use client';

import ParentV3PageGate from '../_components/ParentV3PageGate';
import { ParentV3Progress } from '../_components/ParentV3Views';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function ParentProgressPage() {
  return <ParentV3PageGate legacy={<LegacyProgressRedirect />} v3={<ParentV3Progress />} />;
}

function LegacyProgressRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => { router.replace(`/parent/reports?${params?.toString() ?? ''}`); }, [params, router]);
  return null;
}
