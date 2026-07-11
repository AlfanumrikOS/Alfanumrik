'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import StudentV3Gate from '../../_components/StudentV3Gate';
import { StudentExamV3 } from '../../_components/StudentV3Pages';

function LegacyExamRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/exam-prep'); }, [router]);
  return <div role="status">Opening exam preparation…</div>;
}

export default function ExamPlanPage() {
  return <StudentV3Gate legacy={<LegacyExamRedirect />} v3={<StudentExamV3 />} />;
}
