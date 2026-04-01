import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'For Teachers — Alfanumrik',
  description:
    'Teach smarter with AI-powered tools. Automated grading, real-time mastery data, adaptive assignments, and automated parent reports.',
};

export default function ForTeachersLayout({ children }: { children: ReactNode }) {
  return children;
}
