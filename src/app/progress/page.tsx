'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import BottomNav from '@/components/BottomNav';
import { getLearningProfiles, getDailyActivity, getStudentAchievements, getSubjects } from '@/lib/supabase';
import type { LearningProfile, Subject } from '@/lib/types';

export default function ProgressPage() {
  const { student, snapshot, isLoggedIn, isLoading, isHi, refreshSnapshot } = useAuth();
  const router = useRouter();
  const [profiles, setProfiles] = useState<LearningProfile[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [activity, setActivity] = useState<Array<{ activity_date: string; xp_earned: number; questions_correct: number; sessions_count: number }>>([]);
  const [achievements, setAchievements] = useState<Array<{ id: string; unlocked_at: string; achievement: { title: string; icon: string; description: string; xp_reward: number } }>>([]);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

  useEffect(() => {
    if (!student) return;
    refreshSnapshot();
    Promise.all([
      getLearningProfiles(student.id),
      getSubjects(),
      getDailyActivity(student.id, 30),
      getStudentAchievements(student.id),
    ]).then(([profs, subs, act, ach]) => {
      setProfiles(profs as LearningProfile[]);
      setSubjects(subs as Subject[]);
      setActivity(act as any);
      setAchievements(ach as any);
    });
  }, [student?.id]); // eslint-disable-line

  if (isLoading || !student) return <div className="mesh-bg min-h-dvh flex items-center justify-center"><div className="text-5xl animate-float">🦊</div></div>;

  const totalXP = snapshot?.total_xp ?? profiles.reduce((s, p) => s + (p.xp ?? 0), 0);
  const streak = snapshot?.current_streak ?? 0;
  const mastered = snapshot?.topics_mastered ?? 0;
  const quizzesTaken = snapshot?.quizzes_taken ?? 0;
  const avgScore = snapshot?.avg_quiz_score ?? 0;
  const totalSessions = snapshot?.total_sessions ?? 0;

  // Last 14 days activity map
  const activityMap: Record<string, number> = {};
  activity.forEach(a => { activityMap[a.activity_date] = (a.xp_earned ?? 0) + (a.questions_correct ?? 0) * 2; });
  const days14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    const key = d.toISOString().slice(0, 10);
    return { key, val: activityMap[key] ?? 0, day: d.toLocaleDateString('en', { weekday: 'narrow' }) };
  });
  const maxVal = Math.max(...days14.map(d => d.val), 1);

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="glass border-b border-[var(--border)]">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">←</button>
          <h1 className="font-bold text-lg" style={{ fontFamily: 'var(--font-display)' }}>
            📈 {isHi ? 'मेरी प्रगति' : 'My Progress'}
          </h1>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Top stats */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { v: totalXP.toLocaleString(), l: isHi ? 'कुल XP' : 'Total XP', icon: '⭐', c: 'var(--gold)' },
            { v: streak,   l: isHi ? 'दिन स्ट्रीक' : 'Day Streak',    icon: '🔥', c: 'var(--orange)' },
            { v: mastered, l: isHi ? 'महारत'  : 'Mastered Topics',    icon: '✅', c: 'var(--green)' },
            { v: totalSessions, l: isHi ? 'सत्र' : 'Sessions',         icon: '📚', c: 'var(--teal)' },
          ].map(({ v, l, icon, c }) => (
            <div key={l} className="glass rounded-2xl p-4 text-center">
              <div className="text-2xl mb-1">{icon}</div>
              <div className="text-2xl font-bold" style={{ color: c, fontFamily: 'var(--font-display)' }}>{v}</div>
              <div className="text-xs text-[var(--text-3)] mt-0.5">{l}</div>
            </div>
          ))}
        </div>

        {/* Quiz performance */}
        <div className="glass rounded-2xl p-5">
          <h2 className="font-bold mb-4">{isHi ? '⚡ क्विज़ प्रदर्शन' : '⚡ Quiz Performance'}</h2>
          <div className="flex gap-4">
            <div className="flex-1 text-center p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="text-2xl font-bold gradient-text">{quizzesTaken}</div>
              <div className="text-xs text-[var(--text-3)]">{isHi ? 'क्विज़ खेले' : 'Quizzes taken'}</div>
            </div>
            <div className="flex-1 text-center p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="text-2xl font-bold" style={{ color: 'var(--green)' }}>{Math.round(avgScore)}%</div>
              <div className="text-xs text-[var(--text-3)]">{isHi ? 'औसत स्कोर' : 'Avg score'}</div>
            </div>
          </div>
        </div>

        {/* Activity heatmap (14 days) */}
        <div className="glass rounded-2xl p-5">
          <h2 className="font-bold mb-3">{isHi ? '📅 14 दिन की गतिविधि' : '📅 Last 14 Days'}</h2>
          <div className="flex items-end gap-1">
            {days14.map(({ key, val, day }) => (
              <div key={key} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full rounded-sm transition-all" style={{ height: `${Math.max(4, (val / maxVal) * 48)}px`, background: val > 0 ? `rgba(255,107,53,${0.2 + (val / maxVal) * 0.8})` : 'rgba(255,255,255,0.06)' }} />
                <span className="text-[8px] text-[var(--text-3)]">{day}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Per-subject progress */}
        <div className="glass rounded-2xl p-5">
          <h2 className="font-bold mb-4">{isHi ? '📚 विषयवार प्रगति' : '📚 By Subject'}</h2>
          {profiles.length === 0 ? (
            <p className="text-sm text-[var(--text-3)]">{isHi ? 'अभी कोई डेटा नहीं' : 'No data yet — start learning!'}</p>
          ) : (
            <div className="space-y-3">
              {profiles.map(p => {
                const sub = subjects.find(s => s.code === p.subject);
                const xpProgress = Math.min(100, ((p.xp % 500) / 500) * 100);
                return (
                  <div key={p.id}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <span>{sub?.icon ?? '📚'}</span>
                        {sub?.name ?? p.subject}
                      </span>
                      <span className="text-[var(--text-3)] text-xs">Lv{p.level} · {p.xp}XP · {p.streak_days}🔥</span>
                    </div>
                    <div className="w-full h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }}>
                      <div className="h-full rounded-full" style={{ width: `${xpProgress}%`, background: sub?.color ?? 'var(--orange)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Achievements */}
        {achievements.length > 0 && (
          <div className="glass rounded-2xl p-5">
            <h2 className="font-bold mb-4">{isHi ? '🏅 हासिल की गई उपलब्धियाँ' : '🏅 Achievements Earned'}</h2>
            <div className="grid grid-cols-3 gap-2">
              {achievements.map(a => (
                <div key={a.id} className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)' }}>
                  <div className="text-2xl mb-1">{a.achievement?.icon ?? '🏅'}</div>
                  <div className="text-[10px] font-semibold text-[var(--gold)]">{a.achievement?.title ?? ''}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
