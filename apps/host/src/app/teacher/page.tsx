'use client';

import dynamic from 'next/dynamic';

const CommandCenter = dynamic(() => import('./CommandCenter'), { ssr: false });

export default function TeacherPage() {
  return <CommandCenter />;
}
