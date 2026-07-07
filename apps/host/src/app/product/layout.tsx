import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Product — Alfanumrik Adaptive Learning OS',
  description:
    'Explore the complete Alfanumrik platform: AI tutoring, adaptive quizzes, teacher dashboards, parent reports, and school intelligence — all in one place.',
  openGraph: {
    title: 'Product — Alfanumrik Adaptive Learning OS',
    description:
      'The complete school intelligence OS. For students, teachers, parents, and schools.',
    url: 'https://alfanumrik.com/product',
    siteName: 'Alfanumrik',
    type: 'website',
    locale: 'en_IN',
  },
  alternates: { canonical: 'https://alfanumrik.com/product' },
};

export default function ProductLayout({ children }: { children: ReactNode }) {
  return children;
}
