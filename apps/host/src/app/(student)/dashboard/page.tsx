'use client';

import { DashboardSkeleton } from '@alfanumrik/ui/Skeleton';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import dynamic from 'next/dynamic';

const StudentOSDashboard = dynamic(() => import('./StudentOSDashboard'), {
  ssr: false,
  loading: () => <DashboardSkeleton />,
});

export default function Dashboard() {
  const { isLoading: authLoading } = useAuth();
  if (authLoading) return <DashboardSkeleton />;
  return <StudentOSDashboard />;
}
