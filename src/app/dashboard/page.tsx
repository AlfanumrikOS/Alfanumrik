'use client';

import dynamic from 'next/dynamic';
import AtlasDashboard from './AtlasDashboard';
import { useStudentOsFlag } from '@/lib/use-student-os-flag';
import { DashboardSkeleton } from '@/components/Skeleton';

// Alfa OS flagship redesign — lazy-loaded so its bundle is fetched ONLY when
// ff_student_os_v1 resolves ON. When the flag is OFF (production default) this
// chunk is never requested, keeping the OFF path byte-identical to today and
// protecting the P10 page budget.
const StudentOSDashboard = dynamic(() => import('./StudentOSDashboard'), {
  ssr: false,
  loading: () => <DashboardSkeleton />,
});

export default function Dashboard() {
  // `ff_student_os_v1` defaults OFF (and resolves OFF on first paint when
  // uncached), so the legacy AtlasDashboard renders unchanged until the flag
  // is explicitly enabled.
  const osEnabled = useStudentOsFlag();
  if (osEnabled) return <StudentOSDashboard />;
  return <AtlasDashboard />;
}
