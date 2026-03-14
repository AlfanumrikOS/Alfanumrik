import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Alfanumrik — Your AI Tutor',
  description: 'Foxy by MIGA — AI-powered adaptive learning for Indian students. NCERT Class 6-12.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#FAFAF8',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-dvh" style={{ fontFamily: "'DM Sans',sans-serif", background: '#FAFAF8', margin: 0 }}>
        {children}
      </body>
    </html>
  )
}
