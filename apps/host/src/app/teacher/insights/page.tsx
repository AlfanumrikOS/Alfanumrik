'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

function LegacyReportsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/teacher/reports'); }, [router]);
  return <div role="status">Opening reports…</div>;
}

export default function TeacherInsightsPage() {
  return <LegacyReportsRedirect />;
}
