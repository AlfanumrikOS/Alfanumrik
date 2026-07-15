import type { Metadata } from 'next';
import { Suspense } from 'react';
import ParentShell from './_components/ParentShell';

export const metadata: Metadata = {
  title: 'Parent Portal',
  description: 'Alfanumrik parent portal. Monitor your child\'s learning progress, view reports, and stay connected.',
};

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="parent-portal">
      <Suspense fallback={<div className="min-h-dvh bg-[var(--bg)]" aria-busy="true" />}>
        <ParentShell>{children}</ParentShell>
      </Suspense>
    </div>
  );
}
