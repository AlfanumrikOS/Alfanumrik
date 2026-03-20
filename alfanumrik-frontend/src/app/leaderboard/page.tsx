'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import BottomNav from '@/components/BottomNav';
import { getLeaderboard } from '@/lib/supabase';

type Period = 'weekly' | 'monthly' | 'all_time';

export default function LeaderboardPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('weekly');
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (!isLoading && !isLoggedIn) router.replace('/'); }, [isLoading, isLoggedIn, router]);
  useEffect(() => {
    setLoading(true);
    getLeaderboard(period, 20).then(e => { setEntries(e); setLoading(false); });
  }, [period]);

  if (isLoading || !student) return <div className="mesh-bg min-h-dvh flex items-center justify-center"><div className="text-5xl animate-float">🦊</div></div>;

  const PERIODS: Array<{ id: Period; label: string; hi: string }> = [
    { id:'weekly', label:'This Week', hi:'इस हफ़्ते' },
    { id:'monthly', label:'This Month', hi:'इस महीने' },
    { id:'all_time', label:'All Time', hi:'सर्वकालिक' },
  ];

  const medals = ['🥇','🥈','🥉'];

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="glass border-b border-[var(--border)]">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">←</button>
          <h1 className="font-bold text-lg" style={{ fontFamily: 'var(--font-display)' }}>🏆 {isHi ? 'लीडरबोर्ड' : 'Leaderboard'}</h1>
        </div>
        <div className="max-w-lg mx-auto px-4 pb-2 flex gap-2">
          {PERIODS.map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className="px-3 py-1 rounded-full text-xs font-semibold transition-all"
              style={{ background: period === p.id ? 'rgba(255,107,53,0.2)' : 'transparent',
                border: period === p.id ? '1px solid rgba(255,107,53,0.4)' : '1px solid transparent',
                color: period === p.id ? 'var(--orange)' : 'var(--text-3)' }}>
              {isHi ? p.hi : p.label}
            </button>
          ))}
        </div>
      </header>
      <div className="max-w-lg mx-auto px-4 py-4">
        {loading ? (
          <div className="flex justify-center pt-16"><div className="text-4xl animate-float">🏆</div></div>
        ) : entries.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center">
            <div className="text-4xl mb-3">🏆</div>
            <p className="text-[var(--text-3)]">{isHi ? 'अभी कोई डेटा नहीं' : 'No entries yet — be the first!'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((e, i) => {
              const isMe = e.student?.id === student.id || e.student_id === student.id;
              return (
                <div key={e.id ?? i} className={`rounded-xl p-3.5 flex items-center gap-3 transition-all ${isMe ? 'glow-orange' : ''}`}
                  style={{ background: isMe ? 'rgba(255,107,53,0.1)' : 'rgba(23,18,40,0.5)',
                    border: isMe ? '1px solid rgba(255,107,53,0.3)' : '1px solid var(--border)' }}>
                  <span className="text-xl w-8 text-center">{i < 3 ? medals[i] : `#${e.rank ?? i+1}`}</span>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                    style={{ background: isMe ? 'linear-gradient(135deg,var(--orange),var(--gold))' : 'rgba(255,255,255,0.07)' }}>
                    {(e.student?.name ?? student.name)[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-sm">{e.student?.name ?? (isMe ? student.name : '—')}</div>
                    <div className="text-xs text-[var(--text-3)]">Grade {e.student?.grade ?? student.grade}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-sm" style={{ color: 'var(--gold)' }}>{(e.total_xp ?? 0).toLocaleString()} XP</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
