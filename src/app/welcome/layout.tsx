import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Alfanumrik — Adaptive Learning Platform for CBSE Students India',
  description:
    'Alfanumrik is a structured learning system for CBSE students in Grades 6–12. Improve concept clarity, retention, and exam performance with personalized practice and progress tracking.',
  keywords:
    'adaptive learning platform India, personalized learning for students, CBSE learning platform, improve student performance, online learning system for schools, exam preparation platform India, concept-based learning, structured learning system, student progress tracking, practice and revision system',
  openGraph: {
    title: 'Alfanumrik — Structured Learning That Actually Works',
    description:
      'A personalized learning platform for CBSE students. Clear concepts, smart practice, real progress. Grades 6–12 in Hindi & English.',
    url: 'https://alfanumrik.com/welcome',
    locale: 'en_IN',
    type: 'website',
    siteName: 'Alfanumrik',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Alfanumrik — Improve Student Performance in CBSE',
    description: 'Structured learning, smart practice, real progress tracking. CBSE Grades 6–12.',
  },
  alternates: { canonical: 'https://alfanumrik.com/welcome' },
};

export default function WelcomeLayout({ children }: { children: ReactNode }) {
  return children;
}
