import type { Metadata } from 'next';
import ParentV3LayoutGate from './_components/ParentV3LayoutGate';

export const metadata: Metadata = {
  title: 'Parent Portal',
  description: 'Alfanumrik parent portal. Monitor your child\'s learning progress, view reports, and stay connected.',
};

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="parent-portal">
      <ParentV3LayoutGate>{children}</ParentV3LayoutGate>
    </div>
  );
}
