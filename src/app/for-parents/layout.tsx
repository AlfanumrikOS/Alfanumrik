import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'For Parents — Alfanumrik',
  description:
    'Know exactly how your child is learning. Weekly parent letters every Sunday, subject-wise mastery tracking, and honest answers to "are they actually improving?" CBSE Grades 6–12 in Hindi & English.',
  openGraph: {
    title: 'For Parents — Alfanumrik',
    description:
      'The Sunday letter tells you what your child learned, what slipped, and what to talk about tonight. CBSE Grades 6–12. Free to start.',
    url: 'https://alfanumrik.com/for-parents',
    siteName: 'Alfanumrik',
    locale: 'en_IN',
    alternateLocale: ['hi_IN'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'For Parents — Alfanumrik',
    description:
      'Weekly mastery letters. Subject-wise progress. Finally know what your child knows — and what they need.',
  },
  alternates: {
    canonical: 'https://alfanumrik.com/for-parents',
    languages: {
      'en-IN': 'https://alfanumrik.com/for-parents',
      'hi-IN': 'https://alfanumrik.com/for-parents?lang=hi',
      'x-default': 'https://alfanumrik.com/for-parents',
    },
  },
};

export default function ForParentsLayout({ children }: { children: ReactNode }) {
  return children;
}
