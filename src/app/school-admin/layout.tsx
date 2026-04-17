import type { Metadata } from 'next';
import SchoolAdminShell from './_components/SchoolAdminShell';

export const metadata: Metadata = {
  title: 'School Admin Portal — Alfanumrik',
  description: 'Alfanumrik school admin portal. Manage teachers, students, classes, and invite codes for your school.',
};

export default function SchoolAdminLayout({ children }: { children: React.ReactNode }) {
  return <SchoolAdminShell>{children}</SchoolAdminShell>;
}
