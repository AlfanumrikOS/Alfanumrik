'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * /super-admin error boundary — English-only per ops decision.
 * Reports to Sentry; never leaks error.message to UI in production.
 */
export default function SuperAdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary: 'super-admin-error', digest: error.digest } });
  }, [error]);

  const isDev = process.env.NODE_ENV === 'development';

  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', maxWidth: 480, margin: '60px auto' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }} role="img" aria-label="Warning">⚠️</div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>
        Something went wrong
      </h2>
      <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 20px', lineHeight: 1.6 }}>
        The control room couldn&apos;t load. Try again, or check system logs if the problem persists.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button
          onClick={reset}
          style={{
            padding: '8px 20px',
            background: '#111827',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
        <button
          onClick={() => { window.location.href = '/super-admin'; }}
          style={{
            padding: '8px 20px',
            background: '#fff',
            color: '#374151',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
      {isDev && error.digest && (
        <pre style={{ marginTop: 16, padding: 10, background: '#f3f4f6', borderRadius: 6, fontSize: 11, color: '#6b7280', textAlign: 'left' }}>
          digest: {error.digest}
        </pre>
      )}
    </div>
  );
}
