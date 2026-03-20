'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { getBadges, getStudentBadges, type DBBadge } from '@/lib/supabase';
import { ArrowLeft, Award } from 'lucide-react';

export default function BadgesPage() {
  const { student, isLoggedIn, isLoading, isHi } = useStudent();
  const router = useRouter();
  const [badges, setBadges] = useState<DBBadge[]>([]);
  const [earned, setEarned] = useState<string[]>([]);

  useEffect(() => {
    if (!isLoggedIn && !isLoading) { router.push('/'); return; }
    getBadges().then(setBadges);
    if (student?.id) getStudentBadges(student.id).then(setEarned);
  }, [isLoggedIn, isLoading, student?.id]);

  if (isLoading || !student) return <div className="min-h-screen flex items-center justify-center"><div className="text-2xl animate-pulse">🦊</div></div>;

  return (
    <div className="min-h-screen pb-24">
      <div className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button>
          <Award className="w-5 h-5 text-yellow-400" />
          <span className="font-bold">{isHi ? 'बैज' : 'Badges'}</span>
          <span className="text-xs text-white/30 ml-auto">{earned.length}/{badges.length}</span>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 pt-6 grid grid-cols-2 gap-3">
        {badges.map(badge => {
          const isEarned = earned.includes(badge.id);
          return (
            <div key={badge.id} className="glass rounded-xl p-4 text-center transition-all" style={{opacity: isEarned ? 1 : 0.4}}>
              <div className="text-3xl mb-2">{badge.icon}</div>
              <div className="font-bold text-sm">{isHi && badge.name_hi ? badge.name_hi : badge.name_en}</div>
              <div className="text-xs text-white/30 mt-1">{isHi && badge.description_hi ? badge.description_hi : badge.description_en}</div>
              {badge.xp_reward > 0 && <div className="text-xs mt-2" style={{color:'#FFB800'}}>+{badge.xp_reward} XP</div>}
              {isEarned && <div className="text-xs text-green-400 mt-1">✓ {isHi ? 'प्राप्त' : 'Earned'}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
