'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function LearnError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { boundary: 'learn-error', digest: error.digest } });
  }, [error]);

  const isHi = typeof window !== 'undefined' && (
    localStorage.getItem('alfanumrik_lang') === 'hi' || navigator.language?.startsWith('hi')
  );

  return (
    <div className="mesh-bg min-h-dvh pb-nav flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <span className="text-5xl block mb-4" role="img" aria-label="Fox">&#x1F98A;</span>
        <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
          {isHi ? 'विषय लोड नहीं हो सके' : "Couldn't load subjects"}
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'कुछ गलत हो गया। कनेक्शन जाँचकर फिर से कोशिश करें।'
            : 'Something went wrong. Check your connection and try again.'}
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
            onClick={() => { window.location.href = '/dashboard'; }}
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
