'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { captureException } from '@sentry/nextjs';

export default function SchoolsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureException(error, { tags: { boundary: 'schools-error', digest: error.digest } });
  }, [error]);

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-slate-50">
      <div className="text-center max-w-sm">
        <span className="text-5xl block mb-4" role="img" aria-label="School">🏫</span>
        <h2 className="text-lg font-bold mb-2 text-slate-900">School page couldn&apos;t load</h2>
        <p className="text-sm mb-5 text-slate-600">
          A page-level error occurred. Try again or contact support if the problem persists.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand-orange"
          >
            Retry
          </button>
          <Link
            href="/"
            className="px-6 py-2.5 rounded-xl text-sm font-semibold border border-slate-300 text-slate-700"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
