'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

function LegacyExamRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/exam-prep'); }, [router]);
  return <div role="status">Opening exam preparation…</div>;
}

export default function ExamPlanPage() {
  return <LegacyExamRedirect />;
}
