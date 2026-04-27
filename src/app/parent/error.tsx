'use client';

import { useEffect } from 'react';
import { captureException } from '@sentry/nextjs';

export default function ParentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureException(error, { tags: { boundary: 'parent-error', digest: error.digest } });
  }, [error]);

  const isHi = typeof window !== 'undefined' && (
    localStorage.getItem('alfanumrik_lang') === 'hi' || navigator.language?.startsWith('hi')
  );

  return (
    <div className="mesh-bg min-h-dvh pb-nav flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <span className="text-5xl block mb-4" role="img" aria-label="Fox">&#x1F98A;</span>
        <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
          {isHi ? 'डैशबोर्ड लोड नहीं हुआ' : "Couldn't load dashboard"}
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'कुछ गलत हो गया। फिर से कोशिश करें — आपके बच्चे का डेटा सुरक्षित है।'
            : "Something went wrong. Please try again — your child's data is safe."}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'var(--orange)' }}
          >
            {isHi ? 'फिर से कोशिश करो' : 'Retry'}
          </button>
          <button
            onClick={() => { window.location.href = '/parent'; }}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold"
            style={{ color: 'var(--text-2)', border: '1.5px solid var(--border)' }}
          >
            {isHi ? 'होम' : 'Home'}
          </button>
        </div>
      </div>
    </div>
  );
}
