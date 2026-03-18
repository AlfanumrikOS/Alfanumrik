import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Alfanumrik — AI-Powered Adaptive Learning',
  description: 'India\'s AI-powered adaptive learning platform for NCERT/CBSE students. Chat with Foxy AI tutor, take chapter-wise quizzes, track mastery. By CusioSense Learning India Pvt. Ltd.',
  keywords: 'NCERT, CBSE, AI tutor, adaptive learning, India, education, quiz, Alfanumrik, Foxy',
  authors: [{ name: 'CusioSense Learning India Private Limited' }],
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Alfanumrik' },
  icons: {
    icon: [{ url: '/favicon.ico', sizes: 'any' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#E8590C',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, padding: 0, fontFamily: "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" } as any}>
        {children}
      </body>
    </html>
  )
}
