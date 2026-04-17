import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Alfanumrik — What if your child walked into every exam prepared?',
  description:
    'Alfanumrik is a structured learning system for CBSE students in Grades 6–12. Replaces guesswork with real concept clarity, targeted practice, and daily progress tracking — in Hindi and English.',
  keywords:
    'CBSE learning platform, adaptive learning India, exam preparation CBSE, concept clarity students, parent dashboard education, AI tutor Hindi English, structured learning system, board exam preparation, NCERT aligned platform, online education India',
  openGraph: {
    title: 'Alfanumrik — What if your child walked into every exam prepared?',
    description:
      'Structured learning that replaces guesswork with concept clarity. CBSE Grades 6–12 in Hindi & English. Free to start.',
    url: 'https://alfanumrik.com/welcome',
    locale: 'en_IN',
    type: 'website',
    siteName: 'Alfanumrik',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Alfanumrik — Structured Learning for CBSE Students',
    description:
      'What if your child walked into every exam prepared? Concept clarity, targeted practice, daily progress. Grades 6–12.',
  },
  alternates: { canonical: 'https://alfanumrik.com/welcome' },
};

export default function WelcomeLayout({ children }: { children: ReactNode }) {
  return children;
}
