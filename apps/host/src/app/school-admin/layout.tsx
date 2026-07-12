import type { Metadata } from 'next';
import SchoolAdminV3LayoutGate from './_components/SchoolAdminV3LayoutGate';

export const metadata: Metadata = {
  title: 'School Admin Portal — Alfanumrik',
  description: 'Alfanumrik school admin portal. Manage teachers, students, classes, and invite codes for your school.',
};

export default function SchoolAdminLayout({ children }: { children: React.ReactNode }) {
  return <SchoolAdminV3LayoutGate>{children}</SchoolAdminV3LayoutGate>;
}
