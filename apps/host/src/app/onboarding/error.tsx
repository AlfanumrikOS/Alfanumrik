'use client';

import { useEffect } from 'react';
import { captureException } from '@sentry/nextjs';

// P15 (Onboarding Integrity): the signup → verification → profile → dashboard
// funnel is the #1 acquisition path. A blank crash here loses a new user
// permanently, so the boundary must be present and self-contained — it cannot
// rely on AuthContext (the user may not yet have a profile) or backend calls.
export default function OnboardingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureException(error, { tags: { boundary: 'onboarding-error', digest: error.digest, p15: 'true' } });
  }, [error]);

  const isHi = typeof window !== 'undefined' && (
    localStorage.getItem('alfanumrik_lang') === 'hi' ||
    navigator.language?.startsWith('hi')
  );

  return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <span className="text-5xl block mb-4" role="img" aria-label="Welcome">👋</span>
        <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
          {isHi ? 'सेटअप में रुकावट' : 'Setup hit a snag'}
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'आपका खाता बना है — बस अगला चरण फिर से कोशिश करें।'
            : "Your account is created — just retry the next step."}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'var(--orange)' }}
          >
            {isHi ? 'फिर कोशिश करें' : 'Retry'}
          </button>
          <button
            onClick={() => { window.location.href = '/login'; }}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold"
            style={{ color: 'var(--text-2)', border: '1.5px solid var(--border)' }}
          >
            {isHi ? 'लॉगिन' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}
