'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getLeaderboard } from '@/lib/supabase';
import { Card, SectionHeader, LoadingFoxy, BottomNav, Avatar } from '@/components/ui';

const PERIODS = [
  { id: 'weekly', label: 'This Week', labelHi: 'इस हफ़्ते' },
  { id: 'monthly', label: 'This Month', labelHi: 'इस महीने' },
  { id: 'all', label: 'All Time', labelHi: 'कुल' },
] as const;

const MEDALS = ['🥇', '🥈', '🥉'];

export default function LeaderboardPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const [period, setPeriod] = useState<string>('weekly');
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getLeaderboard(period, 20);
      setEntries(Array.isArray(data) ? data : []);
    } catch {
      setEntries([]);
    }
    setLoading(false);
  }, [period]);

  useEffect(() => {
    if (student) load();
  }, [student?.id, period, load]);

  if (isLoading || !student) return <LoadingFoxy />;

  const myRank = entries.findIndex((e) => e.student_id === student.id);

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* Header */}
      <header
        className="sticky top-0 z-40 border-b"
        style={{
          background: 'rgba(251,248,244,0.88)',
          backdropFilter: 'blur(20px)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">
              ←
            </button>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              🏆 {isHi ? 'लीडरबोर्ड' : 'Leaderboard'}
            </h1>
          </div>

          {/* Period Tabs */}
          <div className="flex gap-1.5 mt-3">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all"
                style={{
                  background: period === p.id ? 'rgba(232,88,28,0.1)' : 'var(--surface-2)',
                  border: period === p.id ? '1.5px solid var(--orange)' : '1.5px solid transparent',
                  color: period === p.id ? 'var(--orange)' : 'var(--text-3)',
                }}
              >
                {isHi ? p.labelHi : p.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {/* My Rank Banner */}
        {myRank >= 0 && (
          <Card accent="var(--orange)" className="!p-4">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold text-white"
                style={{ background: 'linear-gradient(135deg, var(--orange), var(--gold))' }}
              >
                #{myRank + 1}
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">
                  {isHi ? 'तुम्हारी रैंक' : 'Your Rank'}
                </div>
                <div className="text-xs text-[var(--text-3)]">
                  {entries[myRank]?.total_xp?.toLocaleString() ?? 0} XP ·{' '}
                  {entries[myRank]?.sessions ?? 0} {isHi ? 'सत्र' : 'sessions'}
                </div>
              </div>
              <span className="text-2xl">
                {myRank < 3 ? MEDALS[myRank] : '⭐'}
              </span>
            </div>
          </Card>
        )}

        {/* Leaderboard List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="text-4xl animate-float mb-3">🏆</div>
            <p className="text-sm text-[var(--text-3)]">
              {isHi ? 'लोड हो रहा है...' : 'Loading rankings...'}
            </p>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-4">📊</div>
            <h3 className="text-lg font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'अभी कोई डेटा नहीं' : 'No rankings yet'}
            </h3>
            <p className="text-sm text-[var(--text-3)] max-w-xs mx-auto mb-4">
              {isHi
                ? 'क्विज़ खेलो और XP कमाओ — तुम पहले होगे!'
                : 'Take quizzes and earn XP to appear on the leaderboard!'}
            </p>
            <button
              onClick={() => router.push('/quiz')}
              className="btn-primary text-sm px-6 py-3 rounded-xl"
            >
              {isHi ? 'क्विज़ शुरू करो' : 'Start a Quiz'} ⚡
            </button>
          </div>
        ) : (
          <>
            <SectionHeader icon="📊">
              {isHi ? `टॉप ${entries.length} छात्र` : `Top ${entries.length} Students`}
            </SectionHeader>
            <div className="space-y-2">
              {entries.map((entry, idx) => {
                const isMe = entry.student_id === student.id;
                return (
                  <Card
                    key={entry.student_id}
                    className={`!p-3 flex items-center gap-3 ${isMe ? 'ring-2' : ''}`}
                    style={isMe ? { '--tw-ring-color': 'var(--orange)' } as any : undefined}
                  >
                    {/* Rank */}
                    <div className="w-8 text-center flex-shrink-0">
                      {idx < 3 ? (
                        <span className="text-xl">{MEDALS[idx]}</span>
                      ) : (
                        <span className="text-sm font-bold text-[var(--text-3)]">#{idx + 1}</span>
                      )}
                    </div>

                    {/* Avatar */}
                    <Avatar name={entry.name ?? '?'} size={36} />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">
                        {entry.name}
                        {isMe && (
                          <span className="text-xs text-[var(--orange)] ml-1">
                            ({isHi ? 'तुम' : 'You'})
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--text-3)]">
                        Grade {entry.grade} · {entry.sessions ?? 0} {isHi ? 'सत्र' : 'sessions'}
                      </div>
                    </div>

                    {/* XP */}
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-bold gradient-text">
                        {entry.total_xp?.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-[var(--text-3)]">XP</div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
