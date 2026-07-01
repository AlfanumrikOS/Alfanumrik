'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useAuth } from '@/lib/AuthContext';

function StudyPlanContent() {
  const router = useRouter();
  const { authUserId, isLoading, isHi } = useAuth();
  const searchParams = useSearchParams();
  const examId = searchParams.get('exam_id');

  useEffect(() => {
    if (!isLoading && !authUserId) {
      router.replace('/login');
    }
  }, [authUserId, isLoading, router]);

  if (isLoading || !authUserId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-2xl animate-pulse">📋</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-foreground mb-2">
          {isHi ? 'अध्ययन योजना' : 'Study Plan'}
        </h1>
        {examId && (
          <p className="text-sm text-muted-foreground mb-6">
            {isHi
              ? `परीक्षा ${examId} के लिए आपकी अध्ययन योजना तैयार हो रही है…`
              : `Preparing your study plan for exam ${examId}…`}
          </p>
        )}
        <div className="rounded-xl border border-surface-3 bg-surface-1 p-6 text-center">
          <p className="text-4xl mb-3">🚧</p>
          <p className="font-semibold text-foreground mb-1">
            {isHi ? 'जल्द आ रहा है' : 'Coming Soon'}
          </p>
          <p className="text-sm text-muted-foreground">
            {isHi
              ? 'व्यक्तिगत अध्ययन योजनाएं बनाई जा रही हैं। जल्द वापस देखें!'
              : 'Personalised study plans are being built. Check back soon!'}
          </p>
          <button
            onClick={() => router.back()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium"
            style={{ background: 'var(--primary)', color: 'white' }}
          >
            {isHi ? '← वापस जाएं' : '← Go Back'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StudyPlanPage() {
  return (
    <Suspense>
      <StudyPlanContent />
    </Suspense>
  );
}
