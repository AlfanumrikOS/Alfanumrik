import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'For Schools — Alfanumrik School Intelligence OS',
  description:
    'Transform your school with AI-powered adaptive learning. Real-time student analytics, reduced teacher workload, and board exam readiness tracking for CBSE schools.',
};

export default function ForSchoolsLayout({ children }: { children: ReactNode }) {
  return children;
}
