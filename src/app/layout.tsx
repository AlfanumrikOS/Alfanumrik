import './globals.css';
import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/AuthContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import RegisterSW from '@/lib/RegisterSW';
import CookieConsent from '@/components/CookieConsent';
import JsonLd from '@/components/JsonLd';
import NetworkStatus from '@/components/NetworkStatus';
import DemoModeWrapper from '@/components/DemoModeWrapper';

export const metadata: Metadata = {
  title: {
    default: 'Alfanumrik - Adaptive Learning OS | AI Tutor for CBSE Students',
    template: '%s | Alfanumrik',
  },
  description:
    'Alfanumrik is India\'s smartest AI-powered adaptive learning platform for CBSE students. Foxy AI Tutor teaches in Hindi and English with Bayesian mastery tracking, spaced repetition, and gamified learning. Grades 6-12.',
  authors: [{ name: 'Cusiosense Learning India Private Limited' }],
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.svg',
    apple: '/apple-touch-icon.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Alfanumrik',
  },
  keywords: 'CBSE AI tutor, adaptive learning India, AI tutor Hindi, board exam preparation, Foxy AI tutor, spaced repetition CBSE, personalized learning India, class 9 science, class 10 math, online tutor India, Hindi medium tutor, Alfanumrik, Cusiosense Learning',
  openGraph: {
    title: 'Alfanumrik - AI Tutor for CBSE Students | Learn Smarter',
    description:
      'Meet Foxy, your personal AI tutor that teaches at YOUR level. 16 subjects, Hindi & English. Adaptive learning powered by Bayesian mastery tracking.',
    url: 'https://alfanumrik.com',
    locale: 'en_IN',
    type: 'website',
    siteName: 'Alfanumrik Adaptive Learning OS',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Alfanumrik - India\'s Smartest AI Tutor for CBSE Students',
    description:
      'Foxy AI Tutor teaches CBSE in Hindi and English. Adaptive learning, spaced repetition, gamified practice. Start now.',
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
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
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
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        <link rel="dns-prefetch" href="https://fonts.gstatic.com" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <JsonLd />
      </head>
      <body>
        <a href="#main-content" className="skip-nav">Skip to content</a>
        <AuthProvider>
          <NetworkStatus />
          <ErrorBoundary>
            <div id="main-content" className="app-shell">{children}</div>
          </ErrorBoundary>
          <DemoModeWrapper />
          <RegisterSW />
          <CookieConsent />
        </AuthProvider>
      </body>
    </html>
  );
}
