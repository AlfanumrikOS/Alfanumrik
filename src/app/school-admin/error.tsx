'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { captureException } from '@sentry/nextjs';

export default function SchoolAdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureException(error, { tags: { boundary: 'school-admin-error', digest: error.digest } });
  }, [error]);

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-surface-2">
      <div className="text-center max-w-sm">
        <span className="text-5xl block mb-4" role="img" aria-label="School">🏫</span>
        <h2 className="text-lg font-bold mb-2 text-foreground">School admin couldn&apos;t load</h2>
        <p className="text-sm mb-5 text-muted-foreground">
          A page-level error occurred. Your school&apos;s data is safe — retry or return to the school admin home.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-on-surface-accent bg-surface-accent"
          >
            Retry
          </button>
          <Link
            href="/school-admin"
            className="px-6 py-2.5 rounded-xl text-sm font-semibold border border-surface-3 text-foreground"
          >
            School home
          </Link>
        </div>
      </div>
    </div>
  );
}
