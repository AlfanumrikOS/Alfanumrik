'use client';

import { useEffect } from 'react';
import { captureException } from '@sentry/nextjs';
import { Button } from '@alfanumrik/ui/ui/primitives';

export default function TeacherError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureException(error, { tags: { boundary: 'teacher-error', digest: error.digest } });
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
            ? 'कुछ गलत हो गया। आपकी कक्षा का डेटा सुरक्षित है — फिर से कोशिश करें।'
            : 'Something went wrong. Your class data is safe — please try again.'}
        </p>
        <div className="flex gap-3 justify-center">
          <Button variant="primary" onClick={reset}>
            {isHi ? 'फिर से कोशिश करो' : 'Retry'}
          </Button>
          <Button variant="secondary" onClick={() => { window.location.href = '/teacher'; }}>
            {isHi ? 'होम' : 'Home'}
          </Button>
        </div>
      </div>
    </div>
  );
}
