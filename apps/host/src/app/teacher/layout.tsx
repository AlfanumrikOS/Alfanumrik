import type { Metadata } from 'next';
import { Suspense } from 'react';
import TeacherV3LayoutGate from './_components/TeacherV3LayoutGate';

export const metadata: Metadata = {
  title: 'Teacher Dashboard',
  description: 'Alfanumrik teacher portal. Track class performance, create assignments, and monitor student mastery.',
};

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div role="status">Loading teacher workspace…</div>}>
      <TeacherV3LayoutGate>{children}</TeacherV3LayoutGate>
    </Suspense>
  );
}
