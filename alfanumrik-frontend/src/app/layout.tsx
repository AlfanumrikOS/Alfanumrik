import type { Metadata } from 'next';
import './globals.css';
import { StudentProvider } from '@/components/StudentProvider';

export const metadata: Metadata = {
  title: 'Alfanumrik Learning OS',
  description: 'Adaptive AI-powered learning for Indian schools — Classes 6-12',
  manifest: '/manifest.json',
  themeColor: '#0D0B15',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StudentProvider>{children}</StudentProvider>
      </body>
    </html>
  );
}
