'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
              style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: '#E8581C', color: '#fff' }}
            >
              Try Again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
