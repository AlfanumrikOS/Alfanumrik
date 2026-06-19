'use client';

import { DashboardSkeleton } from '@/components/Skeleton';
import dynamic from 'next/dynamic';

const StudentOSDashboard = dynamic(() => import('./StudentOSDashboard'), {
  ssr: false,
  loading: () => <DashboardSkeleton />,
});

export default function Dashboard() {
  return <StudentOSDashboard />;
}
