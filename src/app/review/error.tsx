'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { captureException } from '@sentry/nextjs';
import { Button } from '@/components/ui/primitives';

export default function ReviewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureException(error, { tags: { boundary: 'review-error', digest: error.digest } });
  }, [error]);

  const isHi = typeof window !== 'undefined' && (
    localStorage.getItem('alfanumrik_lang') === 'hi' ||
    navigator.language?.startsWith('hi')
  );

  return (
    <div className="mesh-bg min-h-dvh pb-nav flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <span className="text-5xl block mb-4" role="img" aria-label="Review">📖</span>
        <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
          {isHi ? 'समीक्षा लोड नहीं हो सकी' : "Review couldn't load"}
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'आपकी प्रगति सुरक्षित है। फिर कोशिश करें।'
            : 'Your progress is safe. Try again.'}
        </p>
        <div className="flex gap-3 justify-center">
          <Button variant="primary" onClick={reset}>
            {isHi ? 'फिर कोशिश करें' : 'Retry'}
          </Button>
          <Link
            href="/dashboard"
            className="inline-flex h-12 items-center rounded-lg border border-surface-3 bg-surface-2 px-5 text-fluid-base font-semibold text-foreground transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {isHi ? 'डैशबोर्ड' : 'Dashboard'}
          </Link>
        </div>
      </div>
    </div>
  );
}
