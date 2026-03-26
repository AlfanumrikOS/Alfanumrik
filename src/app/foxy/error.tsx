'use client';

import { useEffect } from 'react';

export default function FoxyError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error('Foxy error:', error); }, [error]);

  return (
    <div className="mesh-bg min-h-dvh pb-nav flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <span className="text-5xl block mb-4">🦊💤</span>
        <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
          Foxy needs a moment
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--text-3)' }}>
          Something went wrong loading the tutor. Try again — your chat history is saved.
        </p>
        <button
          onClick={reset}
          className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'var(--orange)' }}
        >
          Wake Up Foxy
        </button>
      </div>
    </div>
  );
}
