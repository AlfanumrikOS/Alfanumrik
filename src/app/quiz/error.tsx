'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function QuizError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error('Quiz error:', error); }, [error]);

  return (
    <div className="mesh-bg min-h-dvh pb-nav flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <span className="text-5xl block mb-4">📝</span>
        <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
          Quiz couldn&apos;t load
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--text-3)' }}>
          Don&apos;t worry — no progress was lost. Try again or go back to the dashboard.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'var(--orange)' }}
          >
            Retry
          </button>
          <Link
            href="/dashboard"
            className="px-6 py-2.5 rounded-xl text-sm font-semibold"
            style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
