'use client';

import { useEffect } from 'react';
import { captureException } from '@sentry/nextjs';
import { Button } from '@/components/ui/primitives';

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
        <h2 className="text-lg font-bold mb-2 text-foreground">
          {isHi ? 'डैशबोर्ड लोड नहीं हुआ' : "Couldn't load dashboard"}
        </h2>
        <p className="text-sm mb-5 text-muted-foreground">
          {isHi
            ? 'कुछ गलत हो गया। फिर से कोशिश करें — आपके बच्चे का डेटा सुरक्षित है।'
            : "Something went wrong. Please try again — your child's data is safe."}
        </p>
        <div className="flex gap-3 justify-center">
          <Button onClick={reset}>
            {isHi ? 'फिर से कोशिश करो' : 'Retry'}
          </Button>
          <Button variant="secondary" onClick={() => { window.location.href = '/parent'; }}>
            {isHi ? 'होम' : 'Home'}
          </Button>
        </div>
      </div>
    </div>
  );
}
