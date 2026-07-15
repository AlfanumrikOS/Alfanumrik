import type { Metadata } from 'next';
import { Suspense } from 'react';
import TeacherShell from './_components/TeacherShell';
import { TeacherDashboardSkeleton } from '@alfanumrik/ui/Skeleton';

export const metadata: Metadata = {
  title: 'Teacher Dashboard',
  description: 'Alfanumrik teacher portal. Track class performance, create assignments, and monitor student mastery.',
};

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<TeacherDashboardSkeleton />}>
      <TeacherShell>{children}</TeacherShell>
    </Suspense>
  );
}
