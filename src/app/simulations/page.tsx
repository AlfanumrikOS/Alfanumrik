'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Legacy /simulations route — redirects to /stem-centre.
 * The STEM Centre is the unified home for all interactive labs and guided experiments.
 */
export default function SimulationsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/stem-centre');
  }, [router]);

  return (
    <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-3">🔬</div>
        <p className="text-gray-500 text-sm">Redirecting to STEM Centre...</p>
      </div>
    </div>
  );
}
