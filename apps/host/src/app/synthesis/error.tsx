'use client';

import { useEffect } from 'react';

export default function SynthesisError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    if (typeof console !== 'undefined') console.error('[synthesis] error boundary:', error);
  }, [error]);

  return (
    <main className="app-container py-8">
      <p className="text-sm text-red-800">Something went wrong loading the monthly synthesis.</p>
      <button
        onClick={reset}
        className="mt-3 rounded-lg bg-purple-700 text-white px-4 py-2 text-sm"
      >
        Try again
      </button>
    </main>
  );
}
