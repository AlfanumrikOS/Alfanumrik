import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Pricing — Alfanumrik Adaptive Learning OS',
  description:
    'Simple, transparent pricing for every learner. Start free with Foxy, upgrade when you need more chats, quizzes, and subjects.',
  openGraph: {
    title: 'Pricing — Alfanumrik Adaptive Learning OS',
    description:
      'Start free, upgrade when you\'re ready. Plans for students, schools, and institutions.',
    url: 'https://alfanumrik.com/pricing',
    siteName: 'Alfanumrik',
    type: 'website',
    locale: 'en_IN',
  },
  alternates: { canonical: 'https://alfanumrik.com/pricing' },
};

export default function PricingLayout({ children }: { children: ReactNode }) {
  return children;
}
