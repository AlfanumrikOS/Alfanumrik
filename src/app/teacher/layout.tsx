import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Teacher Dashboard',
  description: 'Alfanumrik teacher portal. Track class performance, create assignments, and monitor student mastery.',
};

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return children;
}
