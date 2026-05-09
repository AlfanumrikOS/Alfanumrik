import type { Metadata } from 'next';
import TeacherShell from './_components/TeacherShell';

export const metadata: Metadata = {
  title: 'Teacher Dashboard',
  description: 'Alfanumrik teacher portal. Track class performance, create assignments, and monitor student mastery.',
};

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return <TeacherShell>{children}</TeacherShell>;
}
