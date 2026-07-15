'use client';

import dynamic from 'next/dynamic';
import { TeacherDashboardSkeleton } from '@alfanumrik/ui/Skeleton';

// Warm-cream dashboard-shaped skeleton while the (client-only) CommandCenter
// chunk loads — avoids a blank flash between mount and hydration. The visual is
// text-free (language-neutral), so it's bilingual-safe (P7) without needing the
// client language here; CommandCenter itself supplies the bilingual sr-only
// status label once it takes over.
const CommandCenter = dynamic(() => import('./CommandCenter'), {
  ssr: false,
  loading: () => <TeacherDashboardSkeleton />,
});

export default function TeacherPage() {
  return <CommandCenter />;
}
