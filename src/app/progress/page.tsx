'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getStudentProfiles, getSubjects } from '@/lib/supabase';
import { Card, ProgressBar, SectionHeader, StatCard, LoadingFoxy, BottomNav } from '@/components/ui';

export default function ProgressPage() {
  const { student, snapshot, isLoggedIn, isLoading, isHi, refreshSnapshot } = useAuth();
  const router = useRouter();
  const [profiles, setProfiles] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

  useEffect(() => {
    if (!student) return;
    refreshSnapshot();
    Promise.all([getStudentProfiles(student.id), getSubjects()]).then(([p, s]) => {
      setProfiles(p);
      setSubjects(s);
    });
  }, [student?.id]);

  if (isLoading || !student) return <LoadingFoxy />;

  const totalXp = snapshot?.total_xp ?? profiles.reduce((a, p) => a + (p.xp ?? 0), 0);
  const totalMinutes = profiles.reduce((a, p) => a + (p.total_time_minutes ?? 0), 0);
  const totalSessions = profiles.reduce((a, p) => a + (p.total_sessions ?? 0), 0);
  const totalCorrect = profiles.reduce((a, p) => a + (p.total_questions_answered_correctly ?? 0), 0);
  const totalAsked = profiles.reduce((a, p) => a + (p.total_questions_asked ?? 0), 0);
  const accuracy = totalAsked > 0 ? Math.round((totalCorrect / totalAsked) * 100) : 0;

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">←</button>
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            📈 {isHi ? 'प्रगति' : 'My Progress'}
          </h1>
        </div>
      </header>
      <main className="app-container py-6 space-y-4">
        <div className="grid-stats">
          <StatCard icon="⭐" value={totalXp.toLocaleString()} label="Total XP" color="var(--orange)" />
          <StatCard icon="🎯" value={`${accuracy}%`} label={isHi ? 'सटीकता' : 'Accuracy'} color="var(--green)" />
          <StatCard icon="⏱" value={`${totalMinutes}m`} label={isHi ? 'कुल समय' : 'Study Time'} color="var(--teal)" />
          <StatCard icon="📝" value={totalSessions} label={isHi ? 'सत्र' : 'Sessions'} color="var(--purple)" />
        </div>

        <div>
          <SectionHeader icon="📚">{isHi ? 'विषयवार प्रगति' : 'Subject Progress'}</SectionHeader>
          <div className="space-y-3">
            {profiles.map((p) => {
              const meta = subjects.find((s) => s.code === p.subject);
              const correctPct = p.total_questions_asked > 0
                ? Math.round((p.total_questions_answered_correctly / p.total_questions_asked) * 100)
                : 0;
              return (
                <Card key={p.id} className="!p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-2xl">{meta?.icon ?? '📚'}</span>
                    <div className="flex-1">
                      <div className="font-semibold text-sm md:text-base">{meta?.name ?? p.subject}</div>
                      <div className="text-xs text-[var(--text-3)]">
                        Level {p.level} · {p.xp} XP · {p.streak_days}🔥
                      </div>
                    </div>
                  </div>
                  <ProgressBar value={correctPct} color={meta?.color} label={isHi ? 'सटीकता' : 'Accuracy'} showPercent height={6} />
                </Card>
              );
            })}
          </div>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
