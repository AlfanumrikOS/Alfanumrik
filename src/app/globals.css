import './globals.css';
import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/AuthContext';

export const metadata: Metadata = {
  title: 'Alfanumrik — AI Learning OS',
  description:
    'Personalised AI tutoring for Indian school students. CBSE/NCERT aligned. Hindi, English & 8 more languages.',
  authors: [{ name: 'Alfanumrik' }],
  manifest: '/manifest.json',
  keywords: 'CBSE,NCERT,AI tutor,adaptive learning,Foxy,Hindi medium',
  openGraph: {
    title: 'Alfanumrik — AI Learning OS',
    description:
      'Your AI tutor Foxy helps you master CBSE subjects in your own language.',
    locale: 'en_IN',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Alfanumrik — AI Learning OS',
    description:
      'Your AI tutor Foxy helps you master CBSE subjects in your own language.',
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
