'use client';

import { DashboardSkeleton } from '@alfanumrik/ui/Skeleton';
import dynamic from 'next/dynamic';

const StudentOSDashboard = dynamic(() => import('./StudentOSDashboard'), {
  ssr: false,
  loading: () => <DashboardSkeleton />,
});

export default function Dashboard() {
  return <StudentOSDashboard />;
}
