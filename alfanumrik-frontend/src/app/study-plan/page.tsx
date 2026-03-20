'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import BottomNav from '@/components/BottomNav';
import { getStudyPlan } from '@/lib/supabase';

export default function StudyPlanPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (!isLoading && !isLoggedIn) router.replace('/'); }, [isLoading, isLoggedIn, router]);
  useEffect(() => {
    if (!student) return;
    getStudyPlan(student.id).then(p => { setPlan(p); setLoading(false); });
  }, [student?.id]); // eslint-disable-line

  if (isLoading || !student) return <div className="mesh-bg min-h-dvh flex items-center justify-center"><div className="text-5xl animate-float">🦊</div></div>;

  const tasks = plan?.tasks ?? plan?.today_tasks ?? [];
  const today = new Date().toLocaleDateString('en', { weekday:'long', month:'long', day:'numeric' });

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="glass border-b border-[var(--border)]">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">←</button>
          <div>
            <h1 className="font-bold" style={{ fontFamily: 'var(--font-display)' }}>📅 {isHi ? 'अध्ययन योजना' : 'Study Plan'}</h1>
            <p className="text-xs text-[var(--text-3)]">{today}</p>
          </div>
        </div>
      </header>
      <div className="max-w-lg mx-auto px-4 py-6 space-y-3">
        {loading ? (
          <div className="flex justify-center pt-12"><div className="text-4xl animate-float">📅</div></div>
        ) : tasks.length === 0 ? (
          <div className="glass rounded-3xl p-10 text-center">
            <div className="text-5xl mb-4">📅</div>
            <h2 className="font-bold mb-2">{isHi ? 'आज की कोई योजना नहीं' : 'No plan for today yet'}</h2>
            <p className="text-sm text-[var(--text-3)] mb-4">{isHi ? 'Foxy से बात करो — वो तुम्हारे लिए योजना बनाएगी' : 'Chat with Foxy to generate your personalised plan'}</p>
            <button className="btn-primary" onClick={() => router.push('/foxy')}>{isHi ? 'फॉक्सी से पूछो →' : 'Ask Foxy →'}</button>
          </div>
        ) : (
          tasks.map((t: any, i: number) => (
            <div key={t.id ?? i} className={`glass-mid rounded-2xl p-4 flex items-start gap-4 ${t.is_completed ? 'opacity-50' : ''}`}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: t.is_completed ? 'rgba(45,198,83,0.2)' : 'rgba(255,107,53,0.1)' }}>
                {t.is_completed ? '✅' : (t.task_type === 'quiz' ? '⚡' : t.task_type === 'review' ? '🔄' : '📖')}
              </div>
              <div className="flex-1">
                <div className="font-semibold text-sm">{t.title}</div>
                <div className="text-xs text-[var(--text-3)] mt-0.5">{t.description}</div>
                <div className="flex gap-3 mt-1.5 text-xs">
                  <span className="text-[var(--teal)]">⏱ {t.estimated_minutes ?? 15} min</span>
                  <span style={{ color: 'var(--gold)' }}>+{t.xp_reward ?? 20} XP</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <BottomNav />
    </div>
  );
}
