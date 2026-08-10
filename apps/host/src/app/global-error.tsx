'use client';

// Lazy drop-in (same name/signature): keeps @sentry/core out of the
// first-paint shared bundle (P10) — see packages/lib/src/sentry-lazy-capture.ts.
import { captureException } from '@alfanumrik/lib/sentry-lazy-capture';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report root-level React render errors to Sentry (standard App Router
    // global-error pattern). No-ops when NEXT_PUBLIC_SENTRY_DSN is absent —
    // the client is initialized with `enabled: false` in
    // sentry-client-init.ts (deferred-loaded by instrumentation-client.ts).
    // PII redaction applies via beforeSend (P13).
    captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body data-digest={error.digest} style={{ margin: 0, background: '#FBF8F4' }}>
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
          <section style={{ maxWidth: 360, textAlign: 'center' }}>
            <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Something went wrong</h1>
            <p style={{ fontSize: 14, margin: '0 0 20px', color: '#666' }}>
              The app could not load. Please try again.
            </p>
            <button
              onClick={reset}
              style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: 'var(--accent-warm-strong)', color: 'var(--on-accent)' }}
            >
              Try Again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
