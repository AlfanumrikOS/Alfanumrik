import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * SEO metadata for /welcome (public landing page)
 * Server Component — rendered in <head> for search engine indexing.
 */
export const metadata: Metadata = {
  title: 'Alfanumrik — AI-Powered CBSE Learning Platform for Grades 6–12',
  description:
    "India's most structured adaptive learning platform for CBSE students. 8,000+ NCERT-aligned questions, 542 chapters, AI tutor in Hindi & English. Improve grades, master concepts, ace board exams. Free to start.",

  keywords: [
    'CBSE adaptive learning platform',
    'NCERT learning app India',
    'AI tutor for CBSE students',
    'Class 6 to 12 study app',
    'board exam preparation India',
    'online learning platform for CBSE',
    'NCERT Maths practice',
    'NCERT Science questions',
    'Class 10 board exam preparation',
    'Class 12 board exam preparation',
    'adaptive learning India',
    'personalized study plan CBSE',
    'spaced repetition for students',
    'concept mastery tracking',
    'student progress dashboard',
    'parent monitoring app India',
    'Alfanumrik',
    'bilingual learning Hindi English',
    'DPIIT recognized edtech',
    'no ads education platform India',
    'AI tutor Hindi',
    'free CBSE practice questions',
    'best learning app for Class 10',
    'online tuition alternative India',
    'affordable edtech India',
    'CBSE Social Science notes',
    'spaced revision app India',
    'exam stress reduction',
    'NCERT 2024-25 syllabus',
    'board exam 2025 preparation',
  ].join(', '),

  openGraph: {
    title: 'Alfanumrik — CBSE Adaptive Learning | Grades 6–12 | AI Tutor in Hindi & English',
    description:
      '8,057+ NCERT questions across 542 chapters. AI-powered concept mastery, spaced revision, and real progress tracking for CBSE students in Grades 6–12. Free to start.',
    url: 'https://alfanumrik.com/',
    locale: 'en_IN',
    type: 'website',
    siteName: 'Alfanumrik',
    images: [
      {
        url: 'https://alfanumrik.com/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Alfanumrik — CBSE Adaptive Learning Platform for Grades 6–12',
      },
    ],
  },

  twitter: {
    card: 'summary_large_image',
    site: '@alfanumrik',
    title: 'Alfanumrik — CBSE Adaptive Learning | AI Tutor in Hindi & English',
    description:
      '8,057+ NCERT questions, 542 chapters, AI tutor. Personalized practice for CBSE Grades 6–12. Free to start.',
    images: ['https://alfanumrik.com/og-image.png'],
  },

  alternates: {
    canonical: 'https://alfanumrik.com/',
    languages: {
      'en-IN': 'https://alfanumrik.com/',
      'hi-IN': 'https://alfanumrik.com/?lang=hi',
    },
  },

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-snippet': -1,
      'max-image-preview': 'large',
      'max-video-preview': -1,
    },
  },

  category: 'education',

  other: {
    'application-name': 'Alfanumrik',
    'geo.region': 'IN',
    'geo.placename': 'India',
    'DC.title': 'Alfanumrik — CBSE Adaptive Learning Platform',
    'DC.subject': 'CBSE education, NCERT, adaptive learning, AI tutoring',
    'DC.language': 'en-IN, hi-IN',
    'DC.audience': 'Students grades 6-12, parents, teachers',
    'revisit-after': '7 days',
  },
};

export default function WelcomeLayout({ children }: { children: ReactNode }) {
  return children;
}
