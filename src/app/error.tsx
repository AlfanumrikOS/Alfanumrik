'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Route error:', error);

    // Production error beacon
    if (process.env.NODE_ENV === 'production' && typeof navigator !== 'undefined') {
      try {
        navigator.sendBeacon?.('/api/error-report', JSON.stringify({
          message: error.message,
          digest: error.digest,
          url: window.location.href,
          timestamp: new Date().toISOString(),
        }));
      } catch { /* don't throw in error handler */ }
    }
  }, [error]);

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
      <span style={{ fontSize: 48, marginBottom: 16 }} role="img" aria-label="Fox face">🦊</span>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1, #1a1a1a)', margin: '0 0 8px' }}>
        Something went wrong
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-3, #888)', margin: '0 0 20px', maxWidth: 400 }}>
        Foxy ran into a problem loading this page. Please try again.
      </p>
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
        Try Again
      </button>
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
        </pre>
      )}
    </div>
  );
}
