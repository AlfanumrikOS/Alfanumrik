'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { Card, LoadingFoxy, BottomNav, SectionHeader } from '@/components/ui';
import { SUBJECT_META } from '@/lib/constants';

export default function QuizPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

  if (isLoading || !student) return <LoadingFoxy />;

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">←</button>
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            ⚡ {isHi ? 'क्विज़' : 'Quick Quiz'}
          </h1>
        </div>
      </header>
      <main className="app-container py-6 space-y-4">
        <SectionHeader>{isHi ? 'विषय चुनो' : 'Choose a Subject'}</SectionHeader>
        <div className="grid-quiz-subjects">
          {SUBJECT_META.map((s) => (
            <Card
              key={s.code}
              hoverable
              onClick={() => router.push(`/foxy?mode=quiz&subject=${s.code}`)}
              className="!p-5 md:!p-6 text-center"
            >
              <div className="text-3xl md:text-4xl mb-2">{s.icon}</div>
              <div className="text-sm md:text-base font-semibold" style={{ color: s.color }}>{s.name}</div>
              <div className="text-xs text-[var(--text-3)] mt-1">{isHi ? '10 सवाल' : '10 questions'}</div>
            </Card>
          ))}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
