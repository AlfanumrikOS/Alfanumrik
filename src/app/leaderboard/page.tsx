'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getLeaderboard, getCompetitions, joinCompetition, getCompetitionLeaderboard, getHallOfFame, supabase } from '@/lib/supabase';
import { Card, Button, SectionHeader, LoadingFoxy, BottomNav, Avatar, EmptyState } from '@/components/ui';
import type { LeaderboardEntry } from '@/lib/types';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';

// These types come from dynamic RPC responses with many optional fields
type RPCRecord = Record<string, any>; // eslint-disable-line

type Tab = 'ranks' | 'compete' | 'fame' | 'titles';

const PERIODS = [
  { id: 'weekly', label: 'This Week', labelHi: 'इस हफ़्ते' },
  { id: 'monthly', label: 'This Month', labelHi: 'इस महीने' },
  { id: 'all', label: 'All Time', labelHi: 'कुल' },
] as const;

const MEDALS = ['🥇', '🥈', '🥉'];
const RANK_COLORS = ['#F5A623', '#9CA3AF', '#CD7F32'];
const COMP_ICONS: Record<string, string> = {
  weekly_challenge: '🏅', monthly_olympiad: '🏆', subject_sprint: '🚀',
  streak_war: '🔥', quiz_blitz: '⚡', seasonal_mega: '🌟',
};
const COMP_LABELS: Record<string, string> = {
  weekly_challenge: 'Weekly', monthly_olympiad: 'Olympiad', subject_sprint: 'Sprint',
  streak_war: 'Streak War', quiz_blitz: 'Quiz Blitz', seasonal_mega: 'Mega Event',
};
const STATUS_BADGE: Record<string, { bg: string; color: string; label: string; labelHi: string }> = {
  live: { bg: 'rgba(22,163,74,0.1)', color: '#16A34A', label: 'LIVE', labelHi: 'लाइव' },
  upcoming: { bg: 'rgba(245,166,35,0.1)', color: '#D97706', label: 'UPCOMING', labelHi: 'आगामी' },
  completed: { bg: 'rgba(156,163,175,0.1)', color: '#6B7280', label: 'ENDED', labelHi: 'समाप्त' },
};
const FAME_ICONS: Record<string, string> = {
  competition_winner: '🏆', weekly_topper: '🏅', monthly_topper: '👑',
  streak_champion: '🔥', quiz_master: '⚡', overall_topper: '🌟',
};

export default function LeaderboardPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('ranks');
  const [period, setPeriod] = useState('weekly');
  const [rankMode, setRankMode] = useState<'xp' | 'accuracy' | 'mastery'>('xp');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [competitions, setCompetitions] = useState<RPCRecord[]>([]);
  const [fame, setFame] = useState<RPCRecord[]>([]);
  const [titles, setTitles] = useState<RPCRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<string | null>(null);
  const [selectedComp, setSelectedComp] = useState<RPCRecord | null>(null);
  const [compLeaderboard, setCompLeaderboard] = useState<RPCRecord[]>([]);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  // Load rankings
  const loadRanks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getLeaderboard(period, 50);
      setEntries(Array.isArray(data) ? data : []);
    } catch (e) { console.error('Failed to load rankings:', e); setEntries([]); }
    setLoading(false);
  }, [period]);

  // Load competitions
  const loadCompetitions = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    try {
      const data = await getCompetitions(student.id);
      setCompetitions(Array.isArray(data) ? data : []);
    } catch { setCompetitions([]); }
    setLoading(false);
  }, [student]);

  // Load hall of fame
  const loadFame = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getHallOfFame(30);
      setFame(Array.isArray(data) ? data : []);
    } catch { setFame([]); }
    setLoading(false);
  }, []);

  // Load my titles
  const loadTitles = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    try {
      const { data } = await supabase.from('student_titles').select('*').eq('student_id', student.id).eq('is_active', true).order('earned_at', { ascending: false }).limit(50);
      setTitles(data ?? []);
    } catch { setTitles([]); }
    setLoading(false);
  }, [student]);

  useEffect(() => {
    if (!student) return;
    if (tab === 'ranks') loadRanks();
    else if (tab === 'compete') loadCompetitions();
    else if (tab === 'fame') loadFame();
    else if (tab === 'titles') loadTitles();
  }, [tab, student, loadRanks, loadCompetitions, loadFame, loadTitles]);

  useEffect(() => { if (student && tab === 'ranks') loadRanks(); }, [period, student, tab, loadRanks]);

  const handleJoin = async (compId: string) => {
    if (!student) return;
    setJoining(compId);
    try {
      const result = await joinCompetition(student.id, compId);
      if (result?.success) {
        await loadCompetitions();
      } else {
        alert(result?.error || 'Could not join');
      }
    } catch (e) {
      console.error('Join error:', e);
    }
    setJoining(null);
  };

  const handleViewCompLeaderboard = async (comp: RPCRecord) => {
    setSelectedComp(comp);
    try {
      const data = await getCompetitionLeaderboard(comp.id, 50);
      setCompLeaderboard(Array.isArray(data) ? data : []);
    } catch { setCompLeaderboard([]); }
  };

  if (isLoading || !student) return <LoadingFoxy />;

  const sortedEntries = [...entries].sort((a, b) => {
    if (rankMode === 'accuracy') return (b.accuracy || 0) - (a.accuracy || 0);
    if (rankMode === 'mastery') return (b.topics_mastered || 0) - (a.topics_mastered || 0);
    return (b.total_xp || 0) - (a.total_xp || 0);
  });

  const myRank = sortedEntries.findIndex(e => e.student_id === student.id);

  const TABS: { id: Tab; label: string; labelHi: string; icon: string }[] = [
    { id: 'ranks', label: 'Rankings', labelHi: 'रैंकिंग', icon: '🏆' },
    { id: 'compete', label: 'Compete', labelHi: 'प्रतियोगिता', icon: '⚔️' },
    { id: 'fame', label: 'Hall of Fame', labelHi: 'गौरव गाथा', icon: '👑' },
    { id: 'titles', label: 'My Titles', labelHi: 'मेरे खिताब', icon: '🎖️' },
  ];

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* Header */}
      <header className="page-header" style={{ background: 'rgba(251,248,244,0.88)', backdropFilter: 'blur(20px)' }}>
        <div className="app-container py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">&larr;</button>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              🏆 {isHi ? 'रैंकिंग और प्रतियोगिता' : 'Rankings & Compete'}
            </h1>
          </div>
          {/* Tabs */}
          <div className="flex gap-1.5 mt-3 overflow-x-auto pb-0.5">
            {TABS.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setSelectedComp(null); }}
                className="flex-1 min-w-0 py-2 rounded-xl text-xs font-semibold transition-all text-center"
                style={{
                  background: tab === t.id ? 'rgba(232,88,28,0.1)' : 'var(--surface-2)',
                  border: tab === t.id ? '1.5px solid var(--orange)' : '1.5px solid transparent',
                  color: tab === t.id ? 'var(--orange)' : 'var(--text-3)',
                }}>
                {t.icon} {isHi ? t.labelHi : t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="app-container py-4 space-y-3">
        <SectionErrorBoundary section="Leaderboard">

        {/* ═══ RANKINGS TAB ═══ */}
        {tab === 'ranks' && (
          <>
            {/* Period Filter */}
            <div className="flex gap-1.5">
              {PERIODS.map(p => (
                <button key={p.id} onClick={() => setPeriod(p.id)}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all"
                  style={{
                    background: period === p.id ? 'var(--orange)' : 'var(--surface-2)',
                    color: period === p.id ? '#fff' : 'var(--text-3)',
                  }}>
                  {isHi ? p.labelHi : p.label}
                </button>
              ))}
            </div>

            {/* Ranking Mode Toggle */}
            <div className="flex gap-2 mb-3">
              {([
                { key: 'xp' as const, label: 'XP', labelHi: 'XP', icon: '⭐' },
                { key: 'accuracy' as const, label: 'Accuracy', labelHi: 'सटीकता', icon: '🎯' },
                { key: 'mastery' as const, label: 'Mastery', labelHi: 'दक्षता', icon: '🧠' },
              ] as const).map(mode => (
                <button
                  key={mode.key}
                  onClick={() => setRankMode(mode.key)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
                  style={{
                    background: rankMode === mode.key ? 'var(--orange)' : 'var(--surface-2)',
                    color: rankMode === mode.key ? '#fff' : 'var(--text-3)',
                  }}
                >
                  {mode.icon} {isHi ? mode.labelHi : mode.label}
                </button>
              ))}
            </div>

            {/* My Rank Highlight */}
            {myRank >= 0 && (
              <Card accent="var(--orange)" className="!p-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, var(--orange), var(--gold))' }}>
                    #{myRank + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold">{isHi ? 'तुम्हारी रैंक' : 'Your Rank'}</div>
                    <div className="text-xs text-[var(--text-3)]">
                      {sortedEntries[myRank]?.total_xp?.toLocaleString() ?? 0} XP · {sortedEntries[myRank]?.accuracy ?? 0}% {isHi ? 'सटीकता' : 'accuracy'}
                    </div>
                    {sortedEntries[myRank]?.top_title && (
                      <div className="text-xs mt-1 font-semibold" style={{ color: 'var(--purple)' }}>
                        🎖️ {sortedEntries[myRank].top_title}
                      </div>
                    )}
                  </div>
                  <span className="text-3xl">{myRank < 3 ? MEDALS[myRank] : '⭐'}</span>
                </div>
              </Card>
            )}

            {/* Top 3 Podium */}
            {sortedEntries.length >= 3 && (
              <div className="flex items-end justify-center gap-3 py-4">
                {[1, 0, 2].map(idx => {
                  const e = sortedEntries[idx];
                  if (!e) return null;
                  const isMe = e.student_id === student.id;
                  const height = idx === 0 ? 'h-28' : idx === 1 ? 'h-20' : 'h-16';
                  return (
                    <div key={idx} className="flex flex-col items-center" style={{ width: idx === 0 ? '40%' : '30%' }}>
                      <div className={`text-${idx === 0 ? '3xl' : '2xl'} mb-1`}>{MEDALS[idx]}</div>
                      <Avatar name={e.name || e.student_name || ''} size={idx === 0 ? 48 : 36} />
                      <div className={`text-xs font-bold mt-1 truncate max-w-full text-center ${isMe ? 'text-[var(--orange)]' : ''}`}>
                        {e.name}{isMe ? (isHi ? ' (तुम)' : ' (You)') : ''}
                      </div>
                      <div className="text-xs text-[var(--text-3)]">Gr {e.grade}</div>
                      <div className={`w-full ${height} rounded-t-xl mt-2 flex items-end justify-center pb-2`}
                        style={{ background: `${RANK_COLORS[idx]}20`, border: `1.5px solid ${RANK_COLORS[idx]}40` }}>
                        <span className="text-sm font-bold" style={{ color: RANK_COLORS[idx] }}>
                          {e.total_xp?.toLocaleString()} XP
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Full List */}
            {loading ? (
              <div className="text-center py-12">
                <div className="text-4xl animate-float mb-3">🏆</div>
                <p className="text-sm text-[var(--text-3)]">{isHi ? 'लोड हो रहा है...' : 'Loading rankings...'}</p>
              </div>
            ) : sortedEntries.length === 0 ? (
              <EmptyState
                icon="🏆"
                title={isHi ? 'अभी कोई रैंकिंग नहीं' : 'No rankings yet'}
                description={isHi ? 'क्विज़ खेलो और XP कमाओ — रैंकिंग में ऊपर चढ़ो!' : 'Take quizzes and earn XP to climb the ranks!'}
                action={
                  <Button onClick={() => router.push('/quiz')}>
                    {`${isHi ? 'क्विज़ शुरू करो' : 'Start a Quiz'} ⚡`}
                  </Button>
                }
              />
            ) : (
              <>
                <SectionHeader icon="📊">
                  {isHi ? `टॉप ${sortedEntries.length} छात्र` : `Top ${sortedEntries.length} Students`}
                </SectionHeader>
                <div className="space-y-3">
                  {sortedEntries.map((entry, idx) => {
                    const isMe = entry.student_id === student.id;
                    return (
                      <Card key={entry.student_id}
                        className={`!p-4 flex items-center gap-3 ${isMe ? '!bg-[rgba(232,88,28,0.06)] !border-2 !border-[rgba(232,88,28,0.3)]' : ''}`}>
                        <div className="w-8 text-center flex-shrink-0">
                          {idx < 3 ? <span className="text-xl">{MEDALS[idx]}</span>
                            : <span className="text-sm font-bold text-[var(--text-3)]">#{idx + 1}</span>}
                        </div>
                        <Avatar name={entry.name ?? '?'} size={36} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {entry.name}
                            {isMe && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-1.5" style={{ background: 'var(--orange)', color: '#fff' }}>
                                {isHi ? 'आप' : 'You'}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--text-3)]">
                            Gr {entry.grade}
                            {entry.school && ` · ${entry.school}`}
                            {entry.city && ` · ${entry.city}`}
                          </div>
                          {entry.top_title && (
                            <div className="text-xs font-semibold mt-0.5" style={{ color: 'var(--purple)' }}>
                              🎖️ {entry.top_title}
                            </div>
                          )}
                          <div className="flex gap-3 text-[10px] text-[var(--text-3)] mt-1">
                            {entry.accuracy != null && <span>🎯 {Math.round(entry.accuracy)}%</span>}
                            {entry.streak > 0 && <span>🔥 {entry.streak}d</span>}
                            {(entry.topics_mastered ?? 0) > 0 && <span>🧠 {entry.topics_mastered}</span>}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-bold gradient-text">{entry.total_xp?.toLocaleString()}</div>
                          <div className="text-xs text-[var(--text-3)]">
                            {entry.accuracy}% · 🔥{entry.streak}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* ═══ COMPETITIONS TAB ═══ */}
        {tab === 'compete' && !selectedComp && (
          <>
            {loading ? (
              <div className="text-center py-12">
                <div className="text-4xl animate-float mb-3">⚔️</div>
                <p className="text-sm text-[var(--text-3)]">{isHi ? 'प्रतियोगिताएँ लोड हो रही हैं...' : 'Loading competitions...'}</p>
              </div>
            ) : competitions.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-5xl mb-4">🎯</div>
                <h3 className="text-lg font-bold mb-2">{isHi ? 'अभी कोई प्रतियोगिता नहीं' : 'No competitions right now'}</h3>
                <p className="text-sm text-[var(--text-3)] max-w-xs mx-auto">
                  {isHi ? 'प्रैक्टिस करते रहो — जब प्रतियोगिताएँ शुरू होंगी तो यहाँ दिखाई देंगी।' : 'Keep practicing — competitions will be announced here when they go live.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Featured banner */}
                {competitions.filter((c: RPCRecord) => c.is_featured && c.status === 'live').map((comp: RPCRecord) => (
                  <div key={comp.id} className="rounded-2xl p-5 relative overflow-hidden"
                    style={{
                      background: `linear-gradient(135deg, ${comp.accent_color}15, ${comp.accent_color}08)`,
                      border: `2px solid ${comp.accent_color}40`,
                    }}>
                    <div className="flex items-start gap-3">
                      <span className="text-4xl">{comp.banner_emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                            style={{ background: STATUS_BADGE[comp.status].bg, color: STATUS_BADGE[comp.status].color }}>
                            {isHi ? STATUS_BADGE[comp.status].labelHi : STATUS_BADGE[comp.status].label}
                          </span>
                          <span className="text-xs text-[var(--text-3)]">
                            {COMP_LABELS[comp.competition_type] || comp.competition_type}
                          </span>
                        </div>
                        <h3 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                          {isHi && comp.title_hi ? comp.title_hi : comp.title}
                        </h3>
                        <p className="text-xs text-[var(--text-3)] mt-1 leading-relaxed line-clamp-2">
                          {isHi && comp.description_hi ? comp.description_hi : comp.description}
                        </p>

                        {/* Prizes */}
                        <div className="flex items-center gap-3 mt-3">
                          <span className="text-xs font-semibold" style={{ color: '#F5A623' }}>🥇 {comp.bonus_xp_1} XP</span>
                          <span className="text-xs font-semibold" style={{ color: '#9CA3AF' }}>🥈 {comp.bonus_xp_2} XP</span>
                          <span className="text-xs font-semibold" style={{ color: '#CD7F32' }}>🥉 {comp.bonus_xp_3} XP</span>
                        </div>

                        <div className="flex items-center gap-2 mt-3">
                          {comp.is_joined ? (
                            <>
                              <button onClick={() => handleViewCompLeaderboard(comp)}
                                className="text-xs px-4 py-2 rounded-xl font-bold"
                                style={{ background: `${comp.accent_color}15`, border: `1.5px solid ${comp.accent_color}`, color: comp.accent_color }}>
                                {isHi ? '📊 रैंकिंग देखो' : '📊 View Ranking'}
                              </button>
                              <span className="text-xs font-semibold" style={{ color: '#16A34A' }}>
                                ✓ {isHi ? 'शामिल हो' : 'Joined'}
                                {comp.my_rank && ` · Rank #${comp.my_rank}`}
                              </span>
                            </>
                          ) : (
                            <button onClick={() => handleJoin(comp.id)}
                              className="text-xs px-4 py-2 rounded-xl font-bold text-white"
                              style={{ background: comp.accent_color }}>
                              {joining === comp.id ? '...' : (isHi ? '🚀 अभी जुड़ो' : '🚀 Join Now')}
                            </button>
                          )}
                          <span className="text-xs text-[var(--text-3)]">
                            👥 {comp.participant_count} {isHi ? 'छात्र' : 'joined'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Other competitions */}
                <SectionHeader icon="🎯">{isHi ? 'सभी प्रतियोगिताएँ' : 'All Competitions'}</SectionHeader>
                {competitions.filter((c: RPCRecord) => !c.is_featured || c.status !== 'live').map((comp: RPCRecord) => {
                  const sb = STATUS_BADGE[comp.status] || STATUS_BADGE.upcoming;
                  return (
                    <Card key={comp.id} className="!p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl flex-shrink-0">{comp.banner_emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs px-2 py-0.5 rounded-full font-bold"
                              style={{ background: sb.bg, color: sb.color }}>
                              {isHi ? sb.labelHi : sb.label}
                            </span>
                          </div>
                          <div className="text-sm font-bold">{isHi && comp.title_hi ? comp.title_hi : comp.title}</div>
                          <div className="text-xs text-[var(--text-3)] mt-0.5 line-clamp-1">
                            {isHi && comp.description_hi ? comp.description_hi : comp.description}
                          </div>
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-xs text-[var(--text-3)]">🥇 {comp.bonus_xp_1} XP</span>
                            <span className="text-xs text-[var(--text-3)]">👥 {comp.participant_count}</span>
                            {comp.is_joined && <span className="text-xs font-bold" style={{ color: '#16A34A' }}>✓ Joined</span>}
                          </div>
                          <div className="mt-2">
                            {comp.status === 'live' && !comp.is_joined && (
                              <button onClick={() => handleJoin(comp.id)}
                                className="text-xs px-3 py-1.5 rounded-lg font-bold text-white"
                                style={{ background: comp.accent_color }}>
                                {joining === comp.id ? '...' : (isHi ? 'जुड़ो' : 'Join')}
                              </button>
                            )}
                            {comp.is_joined && comp.status === 'live' && (
                              <button onClick={() => handleViewCompLeaderboard(comp)}
                                className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                                style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                                {isHi ? 'रैंकिंग' : 'Rankings'}
                              </button>
                            )}
                            {comp.status === 'upcoming' && (
                              <span className="text-xs text-[var(--text-3)]">
                                {isHi ? 'शुरू:' : 'Starts:'} {new Date(comp.start_date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ═══ COMPETITION LEADERBOARD VIEW ═══ */}
        {tab === 'compete' && selectedComp && (
          <div className="space-y-3">
            <button onClick={() => setSelectedComp(null)}
              className="text-xs text-[var(--text-3)] flex items-center gap-1">
              &larr; {isHi ? 'वापस' : 'Back to competitions'}
            </button>
            <Card accent={selectedComp.accent_color}>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-3xl">{selectedComp.banner_emoji}</span>
                <div>
                  <h3 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                    {isHi && selectedComp.title_hi ? selectedComp.title_hi : selectedComp.title}
                  </h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs font-semibold" style={{ color: '#F5A623' }}>🥇 {selectedComp.prize_1_title}</span>
                    <span className="text-xs text-[var(--text-3)]">👥 {selectedComp.participant_count}</span>
                  </div>
                </div>
              </div>
            </Card>

            {compLeaderboard.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-3">📊</div>
                <p className="text-sm text-[var(--text-3)]">
                  {isHi ? 'अभी कोई स्कोर नहीं। क्विज़ खेलो!' : 'No scores yet. Take a quiz to compete!'}
                </p>
                <Button onClick={() => router.push('/quiz')} className="mt-3">
                  {`⚡ ${isHi ? 'क्विज़ खेलो' : 'Take Quiz'}`}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {compLeaderboard.map((entry: RPCRecord, idx: number) => {
                  const isMe = entry.student_id === student.id;
                  return (
                    <Card key={entry.student_id}
                      className={`!p-4 flex items-center gap-3 ${isMe ? 'ring-2 ring-[var(--orange)]' : ''}`}>
                      <div className="w-8 text-center flex-shrink-0">
                        {idx < 3 ? <span className="text-xl">{MEDALS[idx]}</span>
                          : <span className="text-sm font-bold text-[var(--text-3)]">#{idx + 1}</span>}
                      </div>
                      <Avatar name={entry.name} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">
                          {entry.name}
                          {isMe && <span className="text-xs text-[var(--orange)] ml-1">({isHi ? 'तुम' : 'You'})</span>}
                        </div>
                        <div className="text-xs text-[var(--text-3)]">
                          Gr {entry.grade}{entry.school ? ` · ${entry.school}` : ''}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-sm font-bold" style={{ color: selectedComp.accent_color }}>
                          {entry.score}
                        </div>
                        <div className="text-xs text-[var(--text-3)]">{entry.accuracy}%</div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ HALL OF FAME TAB ═══ */}
        {tab === 'fame' && (
          <>
            {loading ? (
              <div className="text-center py-12">
                <div className="text-4xl animate-float mb-3">👑</div>
                <p className="text-sm text-[var(--text-3)]">{isHi ? 'गौरव गाथा लोड हो रही है...' : 'Loading Hall of Fame...'}</p>
              </div>
            ) : fame.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-5xl mb-4">👑</div>
                <h3 className="text-lg font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                  {isHi ? 'गौरव गाथा' : 'Hall of Fame'}
                </h3>
                <p className="text-sm text-[var(--text-3)] max-w-xs mx-auto mb-4">
                  {isHi
                    ? 'प्रतियोगिताओं में टॉप 3 आओ — तुम्हारा नाम यहाँ हमेशा के लिए अंकित होगा!'
                    : 'Finish in the Top 3 of any competition — your name will be immortalized here!'}
                </p>
                <Button onClick={() => setTab('compete')}>
                  {`⚔️ ${isHi ? 'प्रतियोगिता देखो' : 'View Competitions'}`}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <SectionHeader icon="👑">{isHi ? 'शानदार विजेता' : 'Champions & Winners'}</SectionHeader>
                {fame.map((entry: RPCRecord) => (
                  <Card key={entry.id} className="!p-4">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl flex-shrink-0">{entry.rank <= 3 ? MEDALS[entry.rank - 1] : FAME_ICONS[entry.achievement_type] || '🏆'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold">{entry.student_name}</div>
                        <div className="text-xs font-semibold" style={{ color: 'var(--orange)' }}>{entry.title}</div>
                        <div className="text-xs text-[var(--text-3)] mt-0.5">
                          Grade {entry.grade} · {entry.month_year} · {entry.subject || 'All Subjects'}
                          {entry.xp_bonus > 0 && ` · +${entry.xp_bonus} XP`}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* ═══ MY TITLES TAB ═══ */}
        {tab === 'titles' && (
          <>
            {loading ? (
              <div className="text-center py-12">
                <div className="text-4xl animate-float mb-3">🎖️</div>
                <p className="text-sm text-[var(--text-3)]">{isHi ? 'लोड हो रहा है...' : 'Loading...'}</p>
              </div>
            ) : titles.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-5xl mb-4">🎖️</div>
                <h3 className="text-lg font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                  {isHi ? 'अभी कोई खिताब नहीं' : 'No Titles Yet'}
                </h3>
                <p className="text-sm text-[var(--text-3)] max-w-xs mx-auto mb-4">
                  {isHi
                    ? 'प्रतियोगिताओं में जीतो और शानदार खिताब कमाओ! तुम्हारे माता-पिता को गर्व होगा!'
                    : 'Win competitions to earn prestigious titles! Make your parents proud!'}
                </p>
                <div className="flex gap-2 justify-center">
                  <Button onClick={() => setTab('compete')}>
                    {`⚔️ ${isHi ? 'प्रतियोगिता' : 'Compete'}`}
                  </Button>
                  <Button variant="ghost" onClick={() => router.push('/quiz')}>
                    {`⚡ ${isHi ? 'क्विज़' : 'Quiz'}`}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <SectionHeader icon="🎖️">{isHi ? `मेरे खिताब (${titles.length})` : `My Titles (${titles.length})`}</SectionHeader>
                <div className="grid grid-cols-2 gap-3">
                  {titles.map((t: RPCRecord) => (
                    <div key={t.id} className="rounded-2xl p-4 text-center"
                      style={{
                        background: t.tier === 'gold' ? 'rgba(245,166,35,0.08)' : t.tier === 'silver' ? 'rgba(156,163,175,0.08)' : t.tier === 'bronze' ? 'rgba(205,127,50,0.08)' : 'rgba(124,58,237,0.08)',
                        border: `1.5px solid ${t.tier === 'gold' ? 'rgba(245,166,35,0.3)' : t.tier === 'silver' ? 'rgba(156,163,175,0.3)' : t.tier === 'bronze' ? 'rgba(205,127,50,0.3)' : 'rgba(124,58,237,0.3)'}`,
                      }}>
                      <div className="text-3xl mb-2">{t.icon || '🏆'}</div>
                      <div className="text-xs font-bold">{isHi && t.title_hi ? t.title_hi : t.title}</div>
                      <div className="text-xs text-[var(--text-3)] mt-1 capitalize">{t.tier} · {t.source}</div>
                      <div className="text-xs text-[var(--text-3)]">
                        {new Date(t.earned_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        </SectionErrorBoundary>
      </main>

      <BottomNav />
    </div>
  );
}
