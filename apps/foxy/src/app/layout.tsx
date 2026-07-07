import '@alfanumrik/ui/globals.css';
import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@alfanumrik/lib/AuthContext';
import { CosmicThemeProvider } from '@alfanumrik/lib/cosmic-theme';
import { cosmicFontVars } from '@alfanumrik/lib/cosmic-fonts';
import { momentumFontClass, momentumFontVars } from '@alfanumrik/lib/momentum-fonts';
import { SchoolProvider } from '@alfanumrik/lib/SchoolContext';
import { TenantConfigProvider } from '@alfanumrik/lib/tenant-domain/client';
import { ErrorBoundary } from '@alfanumrik/ui/ErrorBoundary';
import { Toaster } from '@alfanumrik/ui/ui/toast';

export const metadata: Metadata = {
  title: 'Foxy AI Tutor',
  description: 'Chat with Foxy, your personal AI tutor. Get help in Hindi and English across all CBSE subjects.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#FBF8F4',
};

export default function FoxyLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${cosmicFontVars} ${momentumFontClass}`}
      style={momentumFontVars}
      suppressHydrationWarning
    >
      <head>
        <meta name="color-scheme" content="light" />
      </head>
      <body>
        <TenantConfigProvider>
          <SchoolProvider>
            <AuthProvider>
              <CosmicThemeProvider>
                <ErrorBoundary>
                  {children}
                </ErrorBoundary>
                <Toaster />
              </CosmicThemeProvider>
            </AuthProvider>
          </SchoolProvider>
        </TenantConfigProvider>
      </body>
    </html>
  );
}
