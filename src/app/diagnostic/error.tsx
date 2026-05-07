'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { captureException } from '@sentry/nextjs';

export default function DiagnosticError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureException(error, { tags: { boundary: 'diagnostic-error', digest: error.digest } });
  }, [error]);

  const isHi = typeof window !== 'undefined' && (
    localStorage.getItem('alfanumrik_lang') === 'hi' ||
    navigator.language?.startsWith('hi')
  );

  return (
    <div className="mesh-bg min-h-dvh pb-nav flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <span className="text-5xl block mb-4" role="img" aria-label="Diagnostic">🎯</span>
        <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
          {isHi ? 'डायग्नोस्टिक लोड नहीं हो सका' : "Diagnostic couldn't load"}
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'आपके उत्तर सुरक्षित हैं। फिर कोशिश करें या डैशबोर्ड पर लौटें।'
            : 'Your answers are saved. Retry or head back to the dashboard.'}
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
