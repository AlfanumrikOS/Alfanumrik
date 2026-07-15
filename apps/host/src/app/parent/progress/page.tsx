'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function ParentProgressPage() {
  return <LegacyProgressRedirect />;
}

function LegacyProgressRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => { router.replace(`/parent/reports?${params?.toString() ?? ''}`); }, [params, router]);
  return null;
}
