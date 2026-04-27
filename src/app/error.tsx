'use client';

import { useEffect } from 'react';
import { captureException } from '@sentry/nextjs';

/**
 * Root route error boundary — catches errors in any page (not root layout).
 * Reports to Sentry. Bilingual (Hindi/English).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report to Sentry with context
    captureException(error, {
      tags: {
        boundary: 'route-error',
        digest: error.digest,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
      },
    });
  }, [error]);

  // Detect Hindi preference — AuthContext may not be available in error state
  const isHi = typeof window !== 'undefined' && (
    localStorage.getItem('alfanumrik_lang') === 'hi' ||
    navigator.language?.startsWith('hi')
  );

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      padding: '40px 20px',
      textAlign: 'center',
      fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
    }}>
      <span style={{ fontSize: 48, marginBottom: 16 }} role="img" aria-label="Fox face">
        &#x1F98A;
      </span>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1, #1a1a1a)', margin: '0 0 8px' }}>
        {isHi ? 'कुछ गलत हो गया' : 'Something went wrong'}
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-3, #888)', margin: '0 0 24px', maxWidth: 400, lineHeight: 1.6 }}>
        {isHi
          ? 'Foxy को इस पेज को लोड करने में समस्या हुई। कृपया फिर से कोशिश करें।'
          : 'Foxy ran into a problem loading this page. Please try again.'}
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={reset}
          style={{
            padding: '10px 24px',
            backgroundColor: 'var(--orange, #E8581C)',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {isHi ? 'फिर से कोशिश करो' : 'Try Again'}
        </button>
        <button
          onClick={() => { window.location.href = '/dashboard'; }}
          style={{
            padding: '10px 24px',
            backgroundColor: 'transparent',
            color: 'var(--text-2, #444)',
            border: '1.5px solid var(--border, #e5e0d8)',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {isHi ? 'डैशबोर्ड पर जाओ' : 'Go to Dashboard'}
        </button>
      </div>
      {process.env.NODE_ENV === 'development' && (
        <pre style={{
          marginTop: 20,
          padding: 16,
          backgroundColor: 'var(--surface-2, #f5f0ea)',
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
  );
}
