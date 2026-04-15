'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';

/**
 * Legacy /simulations route — redirects to /stem-centre.
 * The STEM Lab is the unified home for all STEM labs and guided experiments.
 */
export default function SimulationsRedirect() {
  const router = useRouter();
  const { isHi } = useAuth();

  useEffect(() => {
    router.replace('/stem-centre');
  }, [router]);

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)' }}
    >
      <div className="text-center">
        <div className="text-4xl mb-3" aria-hidden="true">🔬</div>
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          {isHi ? 'STEM लैब पर ले जाया जा रहा है…' : 'Redirecting to STEM Lab…'}
        </p>
      </div>
    </div>
  );
}
