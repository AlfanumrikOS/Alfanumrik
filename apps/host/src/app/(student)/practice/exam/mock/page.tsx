'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function MockExamAliasPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/mock-exam'); }, [router]);
  return <div role="status">Opening mock exams…</div>;
}
