'use client';

/**
 * /quiz/ncert — Redirects to unified /quiz with NCERT mode.
 *
 * The main quiz page now handles all question types including NCERT written answers.
 * This page preserves backward compatibility by redirecting with query params.
 */

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function NCERTQuizRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    // Preserve any query params (subject, chapter, grade, etc.)
    const params = new URLSearchParams(searchParams.toString());
    // Set question type to NCERT written types if not already specified
    if (!params.has('types')) {
      params.set('types', 'ncert');
    }
    router.replace(`/quiz?${params.toString()}`);
  }, [router, searchParams]);

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--bg)' }}>
      <p className="text-sm" style={{ color: 'var(--text-3)' }}>
        Redirecting to quiz...
      </p>
    </div>
  );
}