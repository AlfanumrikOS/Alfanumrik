import './globals.css';
import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/AuthContext';

export const metadata: Metadata = {
  title: 'Alfanumrik - Adaptive Learning OS | AI Tutor for CBSE & NCERT Students',
  description:
    'Alfanumrik is India\'s smartest AI-powered adaptive learning platform for CBSE and NCERT students. Foxy AI Tutor teaches in Hindi and English with Bayesian mastery tracking, spaced repetition, and gamified learning. Grades 6-12. Free to start.',
  authors: [{ name: 'Curiosense Learning India Private Limited' }],
  manifest: '/manifest.json',
  keywords: 'CBSE AI tutor, NCERT learning app, adaptive learning India, AI tutor Hindi, board exam preparation, Foxy AI tutor, spaced repetition CBSE, personalized learning India, class 9 science, class 10 math, online tutor India, NCERT solutions AI, Hindi medium tutor, Alfanumrik, Curiosense Learning',
  openGraph: {
    title: 'Alfanumrik - AI Tutor for CBSE & NCERT Students | Learn Smarter',
    description:
      'Meet Foxy, your personal AI tutor that teaches at YOUR level. 726 NCERT chapters, 16 subjects, Hindi & English. Adaptive learning powered by Bayesian mastery tracking. Free for students.',
    locale: 'en_IN',
    type: 'website',
    siteName: 'Alfanumrik Adaptive Learning OS',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Alfanumrik - India\'s Smartest AI Tutor for CBSE Students',
    description:
      'Foxy AI Tutor teaches CBSE & NCERT in Hindi and English. Adaptive learning, spaced repetition, gamified practice. Free to start.',
    creator: '@alfanumrik',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large' as const },
  },
  alternates: {
    canonical: 'https://alfanumrik.com',
  },
  other: {
    'google-site-verification': '',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#FBF8F4',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>
          <div className="app-shell">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
