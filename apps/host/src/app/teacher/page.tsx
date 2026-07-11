'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { TeacherPageGate, TeacherTodayV3 } from './_components/TeacherV3Pages';

const CommandCenter = dynamic(() => import('./CommandCenter'), { ssr: false });

export default function TeacherPage() {
  return <TeacherPageGate legacy={<CommandCenter />} v3={<CanonicalTeacherToday />} />;
}

function CanonicalTeacherToday() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (pathname === '/teacher') router.replace('/teacher/today');
  }, [pathname, router]);
  return <TeacherTodayV3 />;
}
