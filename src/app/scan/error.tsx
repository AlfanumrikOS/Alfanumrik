'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { captureException } from '@sentry/nextjs';

export default function ScanError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureException(error, { tags: { boundary: 'scan-error', digest: error.digest } });
  }, [error]);

  const isHi = typeof window !== 'undefined' && (
    localStorage.getItem('alfanumrik_lang') === 'hi' ||
    navigator.language?.startsWith('hi')
  );

  return (
    <div className="mesh-bg min-h-dvh pb-nav flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <span className="text-5xl block mb-4" role="img" aria-label="Camera">📷</span>
        <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
          {isHi ? 'स्कैन काम नहीं किया' : "Scan didn't work"}
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'कैमरा या नेटवर्क की समस्या हो सकती है। फिर कोशिश करें या Foxy से सीधे पूछें।'
            : 'Camera or network issue. Try again or ask Foxy directly.'}
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
            href="/foxy"
            className="px-6 py-2.5 rounded-xl text-sm font-semibold"
            style={{ border: '1px solid var(--border)', color: 'var(--text-2)' }}
          >
            {isHi ? 'Foxy खोलें' : 'Open Foxy'}
          </Link>
        </div>
      </div>
    </div>
  );
}
