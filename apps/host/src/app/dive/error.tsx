'use client';

import { useEffect } from 'react';

export default function DiveError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    if (typeof console !== 'undefined') console.error('[dive] error boundary:', error);
  }, [error]);

  return (
    <main className="app-container py-8">
      <p className="text-sm text-danger">Something went wrong loading this week&#39;s dive.</p>
      <button
        onClick={reset}
        className="mt-3 rounded-lg bg-secondary text-on-accent px-4 py-2 text-sm"
      >
        Try again
      </button>
    </main>
  );
}
