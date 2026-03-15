import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Alfanumrik — Your AI Tutor',
  description: 'AI-powered adaptive learning for every Indian student. NCERT Class 6-12.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Alfanumrik',
  },
}

export const viewport: Viewport = {
  themeColor: '#E8590C',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body style={{ margin: 0 }}>
        {children}
        <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').catch(()=>{})})};let dp;window.addEventListener('beforeinstallprompt',(e)=>{e.preventDefault();dp=e;window.alfanumrikInstallPrompt=e})` }} />
      </body>
    </html>
  )
}
