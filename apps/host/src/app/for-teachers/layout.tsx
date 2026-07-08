import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'For Teachers — Alfanumrik',
  description:
    "Walk into Monday's class already knowing which student needs help. Bloom's-level dashboards by section, automated parent reports, and worksheet generation in 90 seconds. CBSE Grades 6–12.",
  openGraph: {
    title: 'For Teachers — Alfanumrik',
    description:
      "See who read the chapter before the bell rings. Bloom's diagnostics, automated reports, 90-second worksheets. Free for teachers to try.",
    url: 'https://alfanumrik.com/for-teachers',
    siteName: 'Alfanumrik',
    locale: 'en_IN',
    alternateLocale: ['hi_IN'],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'For Teachers — Alfanumrik',
    description:
      "Bloom's-level class diagnostics every Monday morning. Automated parent reports. 90-second worksheets. Built for Indian CBSE teachers.",
  },
  alternates: {
    canonical: 'https://alfanumrik.com/for-teachers',
    languages: {
      'en-IN': 'https://alfanumrik.com/for-teachers',
      'hi-IN': 'https://alfanumrik.com/for-teachers?lang=hi',
      'x-default': 'https://alfanumrik.com/for-teachers',
    },
  },
};

export default function ForTeachersLayout({ children }: { children: ReactNode }) {
  return children;
}
