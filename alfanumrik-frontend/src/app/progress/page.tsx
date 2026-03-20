'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { MASTERY_CONFIG, SUBJECT_CONFIG, type Subject } from '@/lib/types';
import { ArrowLeft, BarChart3, TrendingUp } from 'lucide-react';

export default function ProgressPage() {
  const { student, snapshot, isLoggedIn, isLoading, isHi, refreshSnapshot } = useStudent();
  const router = useRouter();

  useEffect(() => {
    if (!isLoggedIn && !isLoading) { router.push('/'); return; }
    if (student?.id) refreshSnapshot();
  }, [isLoggedIn, isLoading, student?.id]);

  if (isLoading || !student) return <div className="min-h-screen flex items-center justify-center"><div className="text-2xl animate-pulse">🦊</div></div>;

  const mastery = snapshot?.mastery ?? { not_started: 0, attempted: 0, familiar: 0, proficient: 0, mastered: 0 };
  const total = Object.values(mastery).reduce((a, b) => a + b, 0) || 1;
  const xp = snapshot?.student?.xp_total ?? student.xpTotal;
  const streak = snapshot?.student?.streak_days ?? student.streakDays;

  return (
    <div className="min-h-screen pb-24">
      <div className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button>
          <BarChart3 className="w-5 h-5" style={{color:'#9B4DAE'}} />
          <span className="font-bold">{isHi ? 'मेरी प्रगति' : 'My Progress'}</span>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="glass rounded-xl p-5 text-center"><div className="text-3xl font-bold" style={{color:'#FFB800'}}>{xp}</div><div className="text-xs text-white/30 mt-1">{isHi ? 'कुल XP' : 'Total XP'}</div></div>
          <div className="glass rounded-xl p-5 text-center"><div className="text-3xl font-bold" style={{color:'#FF6B35'}}>{streak}</div><div className="text-xs text-white/30 mt-1">{isHi ? 'दिन स्ट्रीक' : 'Day Streak'}</div></div>
        </div>
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4"><TrendingUp className="w-5 h-5 text-white/30" /><span className="font-bold">{isHi ? 'महारत वितरण' : 'Mastery Distribution'}</span></div>
          {(['mastered', 'proficient', 'familiar', 'attempted', 'not_started'] as const).map(level => {
            const count = mastery[level] || 0;
            const pct = Math.round((count / total) * 100);
            const cfg = MASTERY_CONFIG[level];
            return (
              <div key={level} className="mb-3">
                <div className="flex justify-between text-sm mb-1"><span style={{color: cfg.color}}>{isHi ? cfg.labelHi : cfg.label}</span><span className="text-white/30">{count} ({pct}%)</span></div>
                <div className="w-full h-3 rounded-full" style={{background:'rgba(255,255,255,0.05)'}}><div className="h-3 rounded-full transition-all" style={{width:`${pct}%`, background: cfg.color}} /></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
