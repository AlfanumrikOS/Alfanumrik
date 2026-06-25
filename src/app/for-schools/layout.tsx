import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'For Schools — Alfanumrik School Intelligence OS',
  description:
    'AI-powered adaptive learning for CBSE schools. Real-time student analytics, Bloom\'s-level diagnostics, NEP-aligned reporting, and ISO 27001 certified data security. 30–3,000 seats.',
  openGraph: {
    title: 'For Schools — Alfanumrik School Intelligence OS',
    description:
      'Principal-level dashboards, teacher diagnostics, and NEP-aligned reporting — for schools from 30 to 3,000 seats. ISO 27001 certified. India-hosted.',
    url: 'https://alfanumrik.com/for-schools',
    siteName: 'Alfanumrik',
    locale: 'en_IN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'For Schools — Alfanumrik School Intelligence OS',
    description:
      'Real-time mastery data for every student. NEP-aligned. ISO 27001 certified. Bilingual support. 30–3,000 seats.',
  },
  alternates: {
    canonical: 'https://alfanumrik.com/for-schools',
  },
};

export default function ForSchoolsLayout({ children }: { children: ReactNode }) {
  return children;
}
