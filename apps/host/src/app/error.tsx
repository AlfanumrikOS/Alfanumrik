'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main data-digest={error.digest} style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <section style={{ maxWidth: 360, textAlign: 'center' }}>
        <h2 style={{ fontSize: 20, margin: '0 0 8px' }}>Something went wrong</h2>
        <p style={{ fontSize: 14, margin: '0 0 20px', color: 'var(--text-3, #666)' }}>
          This page could not load. Please try again.
        </p>
        <button
          onClick={reset}
          style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: 'var(--orange, #E8581C)', color: '#fff' }}
        >
          Try Again
        </button>
      </section>
    </main>
  );
}
