'use client';

import { useEffect } from 'react';
import { captureException } from '@sentry/nextjs';

/**
 * Global error boundary — catches errors in the root layout itself.
 * Must provide its own <html> and <body> since the root layout may have crashed.
 * Bilingual: detects language from navigator or localStorage.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report to Sentry with digest for server-side correlation
    captureException(error, {
      tags: { boundary: 'global-error', digest: error.digest },
    });
  }, [error]);

  // Detect Hindi preference without AuthContext (root layout may be broken)
  const isHi = typeof window !== 'undefined' && (
    localStorage.getItem('alfanumrik_lang') === 'hi' ||
    navigator.language?.startsWith('hi')
  );

  return (
    <html lang={isHi ? 'hi' : 'en'}>
      <body style={{
        margin: 0,
        background: '#FBF8F4',
        fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '40px 20px',
          textAlign: 'center',
        }}>
          <span style={{ fontSize: 56, marginBottom: 16 }} role="img" aria-label="Fox face">
            &#x1F98A;
          </span>
          <h1 style={{
            fontSize: 22,
            fontWeight: 700,
            color: '#1a1a1a',
            margin: '0 0 8px',
            fontFamily: "'Sora', system-ui, sans-serif",
          }}>
            {isHi ? 'कुछ गलत हो गया' : 'Something went wrong'}
          </h1>
          <p style={{
            fontSize: 14,
            color: '#888',
            margin: '0 0 24px',
            maxWidth: 400,
            lineHeight: 1.6,
          }}>
            {isHi
              ? 'Foxy को इस पेज को लोड करने में समस्या हुई। कृपया फिर से कोशिश करें।'
              : 'Foxy ran into a problem loading this page. Please try again.'}
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={reset}
              style={{
                padding: '12px 28px',
                backgroundColor: '#E8581C',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {isHi ? 'फिर से कोशिश करो' : 'Try Again'}
            </button>
            <button
              onClick={() => { window.location.href = '/'; }}
              style={{
                padding: '12px 28px',
                backgroundColor: 'transparent',
                color: '#444',
                border: '1.5px solid #e5e0d8',
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {isHi ? 'होम पर जाओ' : 'Go Home'}
            </button>
          </div>
          {process.env.NODE_ENV === 'development' && (
            <pre style={{
              marginTop: 24,
              padding: 16,
              backgroundColor: '#f5f0ea',
              borderRadius: 8,
              fontSize: 12,
              textAlign: 'left',
              maxWidth: '100%',
              overflow: 'auto',
              color: '#DC2626',
            }}>
              {error.message}
              {error.digest && `\nDigest: ${error.digest}`}
            </pre>
          )}
        </div>
      </body>
    </html>
  );
}
