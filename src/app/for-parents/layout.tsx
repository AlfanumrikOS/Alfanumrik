import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'For Parents — Alfanumrik',
  description:
    'Know exactly how your child is learning. Weekly progress reports, subject-wise mastery tracking, study time monitoring, and exam readiness scores.',
};

export default function ForParentsLayout({ children }: { children: ReactNode }) {
  return children;
}
