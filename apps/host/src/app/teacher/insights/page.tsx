'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TeacherInsightsV3, TeacherPageGate } from '../_components/TeacherV3Pages';

function LegacyReportsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/teacher/reports'); }, [router]);
  return <div role="status">Opening reports…</div>;
}

export default function TeacherInsightsPage() {
  return <TeacherPageGate legacy={<LegacyReportsRedirect />} v3={<TeacherInsightsV3 />} />;
}
