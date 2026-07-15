'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

function LegacyReportsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/teacher/reports'); }, [router]);
  // Text-free redirect flash — language-neutral (P7), matches the portal's
  // warm-cream first-paint surface. Resolves to /teacher/reports immediately.
  return <div role="status" aria-busy="true" className="min-h-dvh" style={{ background: 'var(--bg)' }} />;
}

export default function TeacherInsightsPage() {
  return <LegacyReportsRedirect />;
}
