import type { Metadata } from 'next';
import { Suspense } from 'react';
import ParentV3LayoutGate from './_components/ParentV3LayoutGate';

export const metadata: Metadata = {
  title: 'Parent Portal',
  description: 'Alfanumrik parent portal. Monitor your child\'s learning progress, view reports, and stay connected.',
};

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="parent-portal">
      <Suspense fallback={<div className="min-h-dvh bg-[#FFF8F0]" aria-busy="true" />}>
        <ParentV3LayoutGate>{children}</ParentV3LayoutGate>
      </Suspense>
    </div>
  );
}
