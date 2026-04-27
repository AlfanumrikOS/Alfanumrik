'use client';

import { useEffect } from 'react';

export default function FoxyError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error('Foxy error:', error); }, [error]);

  // Detect Hindi preference without AuthContext (error boundaries run before context).
  // Mirrors the pattern in src/app/dashboard/error.tsx:14-17.
  const isHi = typeof window !== 'undefined' && (
    localStorage.getItem('alfanumrik_lang') === 'hi' ||
    navigator.language?.startsWith('hi')
  );

  return (
    <div className="mesh-bg min-h-dvh pb-nav flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <span className="text-5xl block mb-4">🦊💤</span>
        <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
          {isHi ? 'फॉक्सी को एक मिनट चाहिए' : 'Foxy needs a moment'}
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'ट्यूटर लोड करने में कुछ गड़बड़ हो गई। फिर कोशिश करें — आपका चैट इतिहास सुरक्षित है।'
            : 'Something went wrong loading the tutor. Try again — your chat history is saved.'}
        </p>
        <button
          onClick={reset}
          className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'var(--orange)' }}
        >
          {isHi ? 'फॉक्सी को जगाएँ' : 'Wake Up Foxy'}
        </button>
      </div>
    </div>
  );
}
