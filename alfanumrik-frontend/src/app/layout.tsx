import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';

export const metadata: Metadata = {
  title: 'Alfanumrik — AI Learning OS',
  description: 'Personalised AI tutoring for Indian school students. CBSE/NCERT aligned. Hindi, English & 8 more languages.',
  keywords: ['CBSE', 'NCERT', 'AI tutor', 'adaptive learning', 'Foxy', 'Hindi medium'],
  authors: [{ name: 'Alfanumrik' }],
  openGraph: {
    title: 'Alfanumrik — AI Learning OS',
    description: 'Your AI tutor Foxy helps you master CBSE subjects in your own language.',
    type: 'website',
    locale: 'en_IN',
  },
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#0D0B15',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
