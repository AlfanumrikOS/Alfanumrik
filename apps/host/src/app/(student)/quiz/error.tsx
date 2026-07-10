'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function QuizError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error('Quiz error:', error); }, [error]);

  // Detect Hindi preference without AuthContext (error boundaries run before context).
  // Mirrors the pattern in src/app/dashboard/error.tsx:14-17.
  const isHi = typeof window !== 'undefined' && (
    localStorage.getItem('alfanumrik_lang') === 'hi' ||
    navigator.language?.startsWith('hi')
  );

  return (
    <div className="mesh-bg min-h-dvh pb-nav flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <span className="text-5xl block mb-4">📝</span>
        <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
          {isHi ? 'क्विज़ लोड नहीं हो सका' : "Quiz couldn't load"}
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'चिंता न करें — कोई प्रगति नहीं खोई है। फिर कोशिश करें या डैशबोर्ड पर वापस जाएँ।'
            : "Don't worry — no progress was lost. Try again or go back to the dashboard."}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'var(--orange)' }}
          >
            {isHi ? 'फिर कोशिश करें' : 'Retry'}
          </button>
          <Link
            href="/dashboard"
            className="px-6 py-2.5 rounded-xl text-sm font-semibold"
            style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            {isHi ? 'डैशबोर्ड' : 'Dashboard'}
          </Link>
        </div>
      </div>
    </div>
  );
}
