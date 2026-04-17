'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/AuthContext';
import { LoadingFoxy, BottomNav } from '@/components/ui';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { supabase } from '@/lib/supabase';

// Lazy-load ChallengeMode — only rendered for authenticated students
const ChallengeMode = dynamic(() => import('@/components/challenge/ChallengeMode'), {
  ssr: false,
  loading: () => <LoadingFoxy />,
});

export default function ChallengePage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [autoJoinDone, setAutoJoinDone] = useState(false);
  const [autoJoinError, setAutoJoinError] = useState('');

  // Redirect if not logged in
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  // Auto-join from share link (?code=xxx)
  const shareCode = searchParams.get('code');
  useEffect(() => {
    if (!shareCode || !student || autoJoinDone) return;
    setAutoJoinDone(true);

    (async () => {
      try {
        const { error } = await supabase.rpc('join_challenge', {
          p_student_id: student.id,
          p_share_code: shareCode,
        });
        if (error) {
          setAutoJoinError(isHi ? 'चैलेंज जॉइन नहीं हो सका' : 'Could not join challenge');
        }
        // Remove code from URL without reload
        window.history.replaceState({}, '', '/challenge');
      } catch {
        setAutoJoinError(isHi ? 'कुछ गलत हो गया' : 'Something went wrong');
      }
    })();
  }, [shareCode, student, autoJoinDone, isHi]);

  // Loading state
  if (isLoading || !student) {
    return <LoadingFoxy />;
  }

  return (
    <div className="mesh-bg min-h-dvh pb-24">
      <div className="max-w-lg mx-auto px-4 pt-6">
        {/* Auto-join notification */}
        {autoJoinError && (
          <div
            className="rounded-xl p-3 mb-4 text-sm font-medium"
            style={{ background: 'rgba(220,38,38,0.08)', color: '#DC2626', border: '1px solid rgba(220,38,38,0.2)' }}
            role="alert"
          >
            {autoJoinError}
          </div>
        )}
        {autoJoinDone && !autoJoinError && (
          <div
            className="rounded-xl p-3 mb-4 text-sm font-medium"
            style={{ background: 'rgba(22,163,74,0.08)', color: '#16A34A', border: '1px solid rgba(22,163,74,0.2)' }}
            role="status"
          >
            {isHi ? '✅ चैलेंज जॉइन हो गया!' : '✅ Challenge joined!'}
          </div>
        )}

        <SectionErrorBoundary section="Challenge Mode">
          <ChallengeMode
            studentId={student.id}
            studentName={student.name}
            grade={student.grade}
            isHi={isHi}
          />
        </SectionErrorBoundary>
      </div>
      <BottomNav />
    </div>
  );
}
