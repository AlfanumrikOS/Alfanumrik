'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { getLeaderboard, getCompetitions, joinCompetition, getCompetitionLeaderboard, getHallOfFame, supabase } from '@alfanumrik/lib/supabase';
import { Card, Button, SectionHeader, LoadingFoxy, Avatar, EmptyState, PremiumCard, GlowButton } from '@alfanumrik/ui/ui';
import { BarChart } from '@alfanumrik/ui/admin-ui';
import { getLevelFromScore } from '@alfanumrik/lib/score-config';
import { getScoreColor } from '@alfanumrik/lib/score-colors';
import type { LeaderboardEntry } from '@alfanumrik/lib/types';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import StreakBadge from '@alfanumrik/ui/challenge/StreakBadge';
import { STREAK_VISIBILITY_THRESHOLD } from '@alfanumrik/lib/challenge-config';
import { useFeatureFlags } from '@alfanumrik/lib/swr';
import { toast } from '@alfanumrik/ui/ui/toast';

/** Row shape returned by /api/v1/leaderboard/mastery. Phase 5 follow-on. */
interface MasteryLeaderEntry {
  rank: number;
  student_id: string;
  name: string;
  grade: string;
  school: string | null;
  avatar_url: string | null;
  mean_mastery: number;
  chapters_counted: number;
}

// These types come from dynamic RPC responses with many optional fields
type RPCRecord = Record<string, any>; // eslint-disable-line

type Tab = 'ranks' | 'compete' | 'fame' | 'titles' | 'streaks' | 'mastery' | 'class';

/** Entry returned by /api/v1/leaderboard/class/[classId] */
interface ClassLeaderEntry {
  rank: number;
  student_id: string;
  name: string;
  grade: string;
  xp_this_period: number;
}

/** Entry for the streaks leaderboard tab */
interface StreakLeaderEntry {
  student_id: string;
  current_streak: number;
  best_streak: number;
  badges: string[];
  student_name: string;
  student_avatar?: string;
}

/** Extended entry with Performance Score fields when available */
interface PerformanceRankEntry extends LeaderboardEntry {
  performance_score?: number;  // 0-100 overall average
  level_name?: string;
  foxy_coins?: number;
}

const PERIODS = [
  { id: 'weekly', label: 'This Week', labelHi: 'इस हफ़्ते' },
  { id: 'monthly', label: 'This Month', labelHi: 'इस महीने' },
  { id: 'all', label: 'All Time', labelHi: 'कुल' },
] as const;

/* getScoreColor now lives in the shared `@alfanumrik/lib/score-colors` module
   (Alfa Momentum Wave 4b de-dup) — band thresholds 90/75/50/35 unchanged. */

const MEDALS = ['🥇', '🥈', '🥉'];
// Medal identity preserved: gold (--gold), silver + bronze are neutral metal
// tones tokenized via the theme channel (no brand-hex bypass under cosmic).
const RANK_COLORS = [
  'var(--gold)',                                              // 🥇 gold
  'color-mix(in srgb, var(--text-3) 55%, #fff)',             // 🥈 silver
  'color-mix(in srgb, var(--gold) 55%, var(--text-1))',      // 🥉 bronze
];
const COMP_ICONS: Record<string, string> = {
  weekly_challenge: '🏅', monthly_olympiad: '🏆', subject_sprint: '🚀',
  streak_war: '🔥', quiz_blitz: '⚡', seasonal_mega: '🌟',
};
const COMP_LABELS: Record<string, string> = {
  weekly_challenge: 'Weekly', monthly_olympiad: 'Olympiad', subject_sprint: 'Sprint',
  streak_war: 'Streak War', quiz_blitz: 'Quiz Blitz', seasonal_mega: 'Mega Event',
};
const STATUS_BADGE: Record<string, { bg: string; color: string; label: string; labelHi: string }> = {
  live: { bg: 'color-mix(in srgb, var(--green) 10%, transparent)', color: 'var(--green)', label: 'LIVE', labelHi: 'लाइव' },
  upcoming: { bg: 'color-mix(in srgb, var(--gold) 10%, transparent)', color: 'color-mix(in srgb, var(--gold) 80%, #000)', label: 'UPCOMING', labelHi: 'आगामी' },
  completed: { bg: 'color-mix(in srgb, var(--text-3) 10%, transparent)', color: 'var(--text-3)', label: 'ENDED', labelHi: 'समाप्त' },
};
const FAME_ICONS: Record<string, string> = {
  competition_winner: '🏆', weekly_topper: '🏅', monthly_topper: '👑',
  streak_champion: '🔥', quiz_master: '⚡', overall_topper: '🌟',
};

/* Unified premium tab loader — replaces the five inconsistent emoji-float
   spinners + the lone full-screen LoadingFoxy that the tabs used to mix.
   Foxy floats over a soft warm-tinted card so every tab loads the same way.
   Bilingual-safe: the caller passes the already-localized label. */
function TabLoader({ label }: { label: string }) {
  return (
    <div
      className="rounded-2xl py-12 px-6 flex flex-col items-center text-center"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
      role="status"
      aria-label={label}
    >
      <span className="text-4xl animate-float" aria-hidden="true">🦊</span>
      <p className="text-sm text-[var(--text-3)] mt-3">{label}</p>
    </div>
  );
}

export default function LeaderboardPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('ranks');
  const [period, setPeriod] = useState('weekly');
  const [entries, setEntries] = useState<PerformanceRankEntry[]>([]);
  const [usePerformanceScores, setUsePerformanceScores] = useState(false);
  const [competitions, setCompetitions] = useState<RPCRecord[]>([]);
  const [fame, setFame] = useState<RPCRecord[]>([]);
  const [titles, setTitles] = useState<RPCRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<string | null>(null);
  const [selectedComp, setSelectedComp] = useState<RPCRecord | null>(null);
  const [compLeaderboard, setCompLeaderboard] = useState<RPCRecord[]>([]);
  const [streakEntries, setStreakEntries] = useState<StreakLeaderEntry[]>([]);
  // Phase 5 follow-on — mastery-percentile tab. Renders only when
  // ff_personalised_compete_v1 is on (server's /api/v1/leaderboard/mastery
  // also 404s when off). Falls through to legacy tabs when flag is off.
  const [masteryEntries, setMasteryEntries] = useState<MasteryLeaderEntry[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const { data: lbFlags } = useFeatureFlags();
  const masteryTabOn = lbFlags?.ff_personalised_compete_v1 === true;

  const classId = (student as any)?.class_id ?? null;
  const isClassTabActive = tab === 'class';
  const { data: classData, isLoading: classLoading } = useSWR<{ items: ClassLeaderEntry[] } | null>(
    classId && isClassTabActive ? `/api/v1/leaderboard/class/${classId}?period=${period}` : null,
    async (url: string) => {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) return null;
      return res.json() as Promise<{ items: ClassLeaderEntry[] }>;
    },
    { refreshInterval: 60000 },
  );

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  // Load rankings — tries Performance Score system first, falls back to XP
  const loadRanks = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      // Step 1: Load XP-based rankings (existing system, always works)
      const xpData = await getLeaderboard(period, 50);
      const xpEntries: PerformanceRankEntry[] = Array.isArray(xpData) ? xpData : [];

      // Step 2: Try to enrich with Performance Scores from performance_scores table
      // For "All Time" use current performance_scores; for weekly/monthly use score_history
      let perfMap: Map<string, { avgScore: number; levelName: string }> | null = null;

      try {
        if (period === 'all') {
          // Current snapshot from performance_scores
          const { data: perfData } = await supabase
            .from('performance_scores')
            .select('student_id, overall_score, level_name');
          if (perfData && perfData.length > 0) {
            // Average all subjects per student
            const studentScores: Record<string, { total: number; count: number; levels: string[] }> = {};
            for (const row of perfData) {
              if (!studentScores[row.student_id]) {
                studentScores[row.student_id] = { total: 0, count: 0, levels: [] };
              }
              studentScores[row.student_id].total += Number(row.overall_score);
              studentScores[row.student_id].count += 1;
              studentScores[row.student_id].levels.push(row.level_name);
            }
            perfMap = new Map();
            for (const [sid, agg] of Object.entries(studentScores)) {
              const avg = Math.round(agg.total / agg.count);
              perfMap.set(sid, { avgScore: avg, levelName: getLevelFromScore(avg) });
            }
          }
        } else {
          // For weekly/monthly, use score_history
          const since = new Date();
          since.setDate(since.getDate() - (period === 'monthly' ? 30 : 7));
          const { data: histData } = await supabase
            .from('score_history')
            .select('student_id, score, recorded_at')
            .gte('recorded_at', since.toISOString().split('T')[0]);
          if (histData && histData.length > 0) {
            // For each student, collect all scores then average
            const latestPerStudent: Record<string, { scores: number[] }> = {};
            for (const row of histData) {
              const key = `${row.student_id}`;
              if (!latestPerStudent[key]) latestPerStudent[key] = { scores: [] };
              latestPerStudent[key].scores.push(Number(row.score));
            }
            perfMap = new Map();
            for (const [sid, agg] of Object.entries(latestPerStudent)) {
              if (agg.scores.length > 0) {
                const avg = Math.round(agg.scores.reduce((a, b) => a + b, 0) / agg.scores.length);
                perfMap.set(sid, { avgScore: avg, levelName: getLevelFromScore(avg) });
              }
            }
          }
        }
      } catch {
        // Performance score fetch failed — gracefully fall back to XP-only
        perfMap = null;
      }

      // Step 3: Merge and rank
      if (perfMap && perfMap.size > 0) {
        // Enrich XP entries with performance scores
        const enriched: PerformanceRankEntry[] = xpEntries.map((e) => {
          const perf = perfMap!.get(e.student_id);
          return {
            ...e,
            performance_score: perf?.avgScore,
            level_name: perf?.levelName,
            foxy_coins: e.total_xp, // XP becomes "Foxy Coins" label
          };
        });
        // Re-sort by performance_score DESC (students with scores first, then by XP)
        enriched.sort((a, b) => {
          const aScore = a.performance_score ?? -1;
          const bScore = b.performance_score ?? -1;
          if (aScore !== bScore) return bScore - aScore;
          return (b.total_xp ?? 0) - (a.total_xp ?? 0);
        });
        setEntries(enriched);
        setUsePerformanceScores(true);
      } else {
        setEntries(xpEntries);
        setUsePerformanceScores(false);
      }
    } catch (e) { console.error('Failed to load rankings:', e); setEntries([]); setUsePerformanceScores(false); setFetchError(isHi ? 'डेटा लोड नहीं हो सका' : 'Failed to load data'); }
    setLoading(false);
  }, [period, isHi]);

  // Load competitions
  const loadCompetitions = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    setFetchError(null);
    try {
      const data = await getCompetitions(student.id);
      setCompetitions(Array.isArray(data) ? data : []);
    } catch { setCompetitions([]); setFetchError(isHi ? 'डेटा लोड नहीं हो सका' : 'Failed to load data'); }
    setLoading(false);
  }, [student, isHi]);

  // Load hall of fame
  const loadFame = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const data = await getHallOfFame(30);
      setFame(Array.isArray(data) ? data : []);
    } catch { setFame([]); setFetchError(isHi ? 'डेटा लोड नहीं हो सका' : 'Failed to load data'); }
    setLoading(false);
  }, [isHi]);

  // Load my titles
  const loadTitles = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    setFetchError(null);
    try {
      const { data } = await supabase.from('student_titles').select('*').eq('student_id', student.id).eq('is_active', true).order('earned_at', { ascending: false }).limit(50);
      setTitles(data ?? []);
    } catch { setTitles([]); setFetchError(isHi ? 'डेटा लोड नहीं हो सका' : 'Failed to load data'); }
    setLoading(false);
  }, [student, isHi]);

  // Load streaks leaderboard
  const loadStreaks = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    setFetchError(null);
    try {
      const { data } = await supabase
        .from('challenge_streaks')
        .select('student_id, current_streak, best_streak, badges, students!inner(name, avatar_url)')
        .gte('current_streak', STREAK_VISIBILITY_THRESHOLD)
        .order('current_streak', { ascending: false })
        .limit(50);

      if (data && data.length > 0) {
        const mapped: StreakLeaderEntry[] = data.map((row: any) => ({
          student_id: row.student_id,
          current_streak: row.current_streak,
          best_streak: row.best_streak,
          badges: Array.isArray(row.badges) ? row.badges : [],
          student_name: (row.students as any)?.name ?? '?',
          student_avatar: (row.students as any)?.avatar_url,
        }));
        setStreakEntries(mapped);
      } else {
        setStreakEntries([]);
      }
    } catch { setStreakEntries([]); setFetchError(isHi ? 'डेटा लोड नहीं हो सका' : 'Failed to load data'); }
    setLoading(false);
  }, [student, isHi]);

  // Phase 5 follow-on — mastery leaderboard fetcher. 404 = flag off
  // or no profile; treat as empty (UI renders the empty state).
  const loadMastery = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/v1/leaderboard/mastery?limit=50', {
        credentials: 'same-origin',
      });
      if (res.status === 404) {
        setMasteryEntries([]);
      } else if (res.ok) {
        const body = (await res.json()) as { items?: MasteryLeaderEntry[] };
        setMasteryEntries(Array.isArray(body.items) ? body.items : []);
      } else {
        setMasteryEntries([]);
      }
    } catch {
      setMasteryEntries([]);
      setFetchError(isHi ? 'डेटा लोड नहीं हो सका' : 'Failed to load data');
    }
    setLoading(false);
  }, [isHi]);

  useEffect(() => {
    if (!student) return;
    if (tab === 'ranks') loadRanks();
    else if (tab === 'compete') loadCompetitions();
    else if (tab === 'fame') loadFame();
    else if (tab === 'titles') loadTitles();
    else if (tab === 'streaks') loadStreaks();
    else if (tab === 'mastery') loadMastery();
    // Intentionally key on student?.id, not the student object, to avoid re-firing on every AuthContext refresh — see render-loop fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, student?.id, loadRanks, loadCompetitions, loadFame, loadTitles, loadStreaks, loadMastery]);

  // Intentionally key on student?.id, not the student object, to avoid re-firing on every AuthContext refresh — see render-loop fix.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (student && tab === 'ranks') loadRanks(); }, [period, student?.id, tab, loadRanks]);

  const handleJoin = async (compId: string) => {
    if (!student) return;
    setJoining(compId);
    try {
      const result = await joinCompetition(student.id, compId);
      if (result?.success) {
        await loadCompetitions();
      } else {
        toast.error(result?.error || 'Could not join');
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

  const myRank = entries.findIndex(e => e.student_id === student.id);

  const TABS: { id: Tab; label: string; labelHi: string; icon: string }[] = [
    { id: 'ranks', label: 'Rankings', labelHi: 'रैंकिंग', icon: '🏆' },
    ...(masteryTabOn
      ? [{ id: 'mastery' as Tab, label: 'Mastery', labelHi: 'महारत', icon: '🎯' }]
      : []),
    { id: 'class', label: 'My Class', labelHi: 'मेरी कक्षा', icon: '🏫' },
    { id: 'compete', label: 'Compete', labelHi: 'प्रतियोगिता', icon: '⚔️' },
    { id: 'streaks', label: 'Streaks', labelHi: 'स्ट्रीक', icon: '🔥' },
    { id: 'fame', label: 'Hall of Fame', labelHi: 'गौरव गाथा', icon: '👑' },
    { id: 'titles', label: 'My Titles', labelHi: 'मेरे खिताब', icon: '🎖️' },
  ];

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* Header */}
      <header className="page-header" style={{ background: 'color-mix(in srgb, var(--surface-1) 88%, transparent)', backdropFilter: 'blur(20px)' }}>
        <div className="app-container py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)] p-2 rounded-lg" aria-label={isHi ? 'वापस जाएं' : 'Go back'}>&larr;</button>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-serif)' }}>
              🏆 {isHi ? 'रैंकिंग और प्रतियोगिता' : 'Rankings & Compete'}
            </h1>
          </div>
          {/* Tabs */}
          <div
            className="flex gap-1.5 mt-3 overflow-x-auto pb-0.5 scrollbar-hide"
            style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain' }}
          >
            {TABS.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setSelectedComp(null); }}
                className="flex-shrink-0 px-4 py-2 rounded-xl text-xs font-bold transition-all text-center active:scale-[0.97]"
                style={{
                  background: tab === t.id ? 'rgb(var(--accent-warm-rgb) / 0.10)' : 'var(--surface-2)',
                  border: tab === t.id ? '1.5px solid var(--accent-warm)' : '1.5px solid transparent',
                  color: tab === t.id ? 'var(--accent-warm)' : 'var(--text-3)',
                  boxShadow: tab === t.id ? '0 2px 10px rgb(var(--accent-warm-rgb) / 0.16)' : undefined,
                }}>
                {t.icon} {isHi ? t.labelHi : t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="app-container py-4 space-y-3">
        <SectionErrorBoundary section="Leaderboard">

        {fetchError && (
          <div className="mx-4 mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 flex items-center gap-2">
            <span aria-hidden="true">⚠️</span>
            <span className="flex-1">{fetchError}</span>
            <button
              onClick={() => setFetchError(null)}
              className="ml-auto text-red-700 font-bold"
              aria-label={isHi ? 'बंद करें' : 'Dismiss'}
            >✕</button>
          </div>
        )}

        {/* ═══ RANKINGS TAB ═══ */}
        {tab === 'ranks' && (
          <>
            {/* Period Filter */}
            <div className="flex gap-1.5">
              {PERIODS.map(p => (
                <button key={p.id} onClick={() => setPeriod(p.id)}
                  className="flex-1 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.98]"
                  style={
                    period === p.id
                      ? {
                          background: 'linear-gradient(135deg, var(--accent-warm), var(--accent-warm-strong))',
                          color: '#fff',
                          boxShadow: '0 3px 12px rgb(var(--accent-warm-rgb) / 0.28)',
                        }
                      : { background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }
                  }>
                  {isHi ? p.labelHi : p.label}
                </button>
              ))}
            </div>

            {/* My Rank — Not in leaderboard */}
            {myRank < 0 && !loading && entries.length > 0 && (
              <div
                className="rounded-2xl p-4"
                style={{
                  background:
                    'linear-gradient(135deg, color-mix(in srgb, var(--purple) 8%, var(--surface-1)), rgb(var(--accent-warm-rgb) / 0.06))',
                  border: '1px solid color-mix(in srgb, var(--purple) 20%, transparent)',
                }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--text-3)]">{isHi ? 'तुम्हारा रैंक' : 'Your Rank'}</p>
                    <p className="text-2xl font-bold" style={{ color: 'var(--purple)' }}>#---</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-[var(--text-3)]">XP</p>
                    <p className="text-lg font-semibold">{student?.xp_total ?? 0}</p>
                  </div>
                </div>
                <p className="text-xs text-[var(--text-3)] mt-2">
                  {isHi ? 'क्विज़ दो और लीडरबोर्ड पर आओ!' : 'Take quizzes to climb the leaderboard!'}
                </p>
              </div>
            )}

            {/* My Rank Highlight */}
            {myRank >= 0 && (
              <PremiumCard glow gradient className="warm-cta !p-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, var(--accent-warm), var(--gold))' }}>
                    #{myRank + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold">{isHi ? 'तुम्हारी रैंक' : 'Your Rank'}</div>
                    {usePerformanceScores && entries[myRank]?.performance_score != null ? (
                      <div className="text-xs text-[var(--text-3)]">
                        <span className="font-semibold" style={{ color: getScoreColor(entries[myRank].performance_score!) }}>
                          {entries[myRank].performance_score}/100
                        </span>
                        {' '}{isHi ? 'प्रदर्शन स्कोर' : 'Performance Score'}
                        {entries[myRank].foxy_coins != null && (
                          <span> · {entries[myRank].foxy_coins?.toLocaleString()} Foxy Coins</span>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--text-3)]">
                        {entries[myRank]?.total_xp?.toLocaleString() ?? 0} XP · {entries[myRank]?.accuracy ?? 0}% {isHi ? 'सटीकता' : 'accuracy'}
                      </div>
                    )}
                    {entries[myRank]?.level_name && usePerformanceScores && (
                      <div className="text-xs mt-0.5 font-semibold" style={{ color: getScoreColor(entries[myRank].performance_score ?? 0) }}>
                        {entries[myRank].level_name}
                      </div>
                    )}
                    {entries[myRank]?.top_title && (
                      <div className="text-xs mt-1 font-semibold" style={{ color: 'var(--purple)' }}>
                        {entries[myRank].top_title}
                      </div>
                    )}
                  </div>
                  <span className="text-3xl">{myRank < 3 ? MEDALS[myRank] : ''}</span>
                </div>
              </PremiumCard>
            )}

            {/* Top 3 Podium */}
            {entries.length >= 3 && (
              <div className="flex items-end justify-center gap-3 py-4">
                {[1, 0, 2].map(idx => {
                  const e = entries[idx];
                  if (!e) return null;
                  const isMe = e.student_id === student.id;
                  const height = idx === 0 ? 'h-28' : idx === 1 ? 'h-20' : 'h-16';
                  const hasPerf = usePerformanceScores && e.performance_score != null;
                  return (
                    <div key={idx} className="flex flex-col items-center" style={{ width: idx === 0 ? '40%' : '30%' }}>
                      <div className={`text-${idx === 0 ? '3xl' : '2xl'} mb-1`}>{MEDALS[idx]}</div>
                      <Avatar name={e.name || e.student_name || ''} size={idx === 0 ? 48 : 36} />
                      <div className="text-xs font-bold mt-1 truncate max-w-full text-center" style={isMe ? { color: 'var(--accent-warm)' } : undefined}>
                        {e.name}{isMe ? (isHi ? ' (तुम)' : ' (You)') : ''}
                      </div>
                      <div className="text-xs text-[var(--text-3)]">Gr {e.grade}</div>
                      <div className={`w-full ${height} rounded-t-xl mt-2 flex flex-col items-center justify-end pb-2`}
                        style={{
                          background: `color-mix(in srgb, ${RANK_COLORS[idx]} 16%, var(--surface-1))`,
                          border: `1.5px solid color-mix(in srgb, ${RANK_COLORS[idx]} 40%, transparent)`,
                          boxShadow: idx === 0 ? '0 6px 18px color-mix(in srgb, var(--gold) 22%, transparent)' : undefined,
                        }}>
                        {hasPerf ? (
                          <>
                            <span className="text-lg font-bold" style={{ color: getScoreColor(e.performance_score!) }}>
                              {e.performance_score}
                            </span>
                            <span className="text-[10px] text-[var(--text-3)]">/100</span>
                          </>
                        ) : (
                          <span className="text-sm font-bold" style={{ color: RANK_COLORS[idx] }}>
                            {e.total_xp?.toLocaleString()} XP
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Top 10 chart — XP or Performance Score depending on available data */}
            {!loading && entries.length > 0 && (
              <section className="mb-2">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--text-3)]">
                  {usePerformanceScores
                    ? (isHi ? 'शीर्ष 10 प्रदर्शन स्कोर' : 'Top 10 by Performance Score')
                    : (isHi ? 'शीर्ष 10 XP' : 'Top 10 by XP')}
                </h2>
                <BarChart
                  series={[
                    {
                      name: usePerformanceScores ? (isHi ? 'प्रदर्शन स्कोर' : 'Performance Score') : 'XP',
                      data: entries.slice(0, 10).map((e) => ({
                        x: e.name ?? '?',
                        y: usePerformanceScores && e.performance_score != null
                          ? e.performance_score
                          : (e.total_xp ?? 0),
                      })),
                    },
                  ]}
                  height={200}
                />
              </section>
            )}

            {/* Full List */}
            {loading ? (
              <TabLoader label={isHi ? 'लोड हो रहा है...' : 'Loading rankings...'} />
            ) : entries.length === 0 ? (
              <EmptyState
                icon="🏆"
                title={isHi ? 'अभी कोई रैंकिंग नहीं' : 'No rankings yet'}
                description={isHi ? 'क्विज़ खेलो और अपना Performance Score बढ़ाओ — रैंकिंग में ऊपर चढ़ो!' : 'Take quizzes to boost your Performance Score and climb the ranks!'}
                action={
                  <Button onClick={() => router.push('/quiz')}>
                    {isHi ? 'क्विज़ शुरू करो' : 'Start a Quiz'}
                  </Button>
                }
              />
            ) : (
              <>
                <SectionHeader icon="📊">
                  {isHi ? `टॉप ${entries.length} छात्र` : `Top ${entries.length} Students`}
                </SectionHeader>
                <div className="space-y-3">
                  {entries.map((entry, idx) => {
                    const isMe = entry.student_id === student.id;
                    const hasPerf = usePerformanceScores && entry.performance_score != null;
                    return (
                      <PremiumCard key={entry.student_id}
                        glow={isMe}
                        className={`!p-4 flex items-center gap-3${isMe ? ' warm-cta' : ''}`}>
                        <div className="w-8 text-center flex-shrink-0">
                          {idx < 3 ? <span className="text-xl">{MEDALS[idx]}</span>
                            : <span className="text-sm font-bold text-[var(--text-3)]">#{idx + 1}</span>}
                        </div>
                        <Avatar name={entry.name ?? '?'} size={36} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {entry.name}
                            {isMe && <span className="text-xs ml-1" style={{ color: 'var(--accent-warm)' }}>({isHi ? 'तुम' : 'You'})</span>}
                          </div>
                          <div className="text-xs text-[var(--text-3)]">
                            Gr {entry.grade}
                            {entry.school && ` · ${entry.school}`}
                            {entry.city && ` · ${entry.city}`}
                          </div>
                          {hasPerf && entry.level_name && (
                            <div className="text-xs font-semibold mt-0.5" style={{ color: getScoreColor(entry.performance_score!) }}>
                              {entry.level_name}
                            </div>
                          )}
                          {entry.top_title && (
                            <div className="text-xs font-semibold mt-0.5" style={{ color: 'var(--purple)' }}>
                              {entry.top_title}
                            </div>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          {hasPerf ? (
                            <>
                              <div className="text-lg font-bold" style={{ color: getScoreColor(entry.performance_score!) }}>
                                {entry.performance_score}
                              </div>
                              <div className="text-[10px] text-[var(--text-3)]">/100</div>
                              {entry.foxy_coins != null && (
                                <div className="text-[10px] text-[var(--text-3)] mt-0.5">
                                  {entry.foxy_coins.toLocaleString()} Foxy Coins
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="text-sm font-bold gradient-text">{entry.total_xp?.toLocaleString()}</div>
                              <div className="text-xs text-[var(--text-3)]">
                                {entry.accuracy}% {'\u00B7'} {entry.streak}
                              </div>
                            </>
                          )}
                        </div>
                      </PremiumCard>
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
              <TabLoader label={isHi ? 'प्रतियोगिताएँ लोड हो रही हैं...' : 'Loading competitions...'} />
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
                {competitions.filter(c => c.is_featured && c.status === 'live').map(comp => (
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
                          <span className="text-xs font-semibold" style={{ color: RANK_COLORS[0] }}>🥇 {comp.bonus_xp_1} XP</span>
                          <span className="text-xs font-semibold" style={{ color: RANK_COLORS[1] }}>🥈 {comp.bonus_xp_2} XP</span>
                          <span className="text-xs font-semibold" style={{ color: RANK_COLORS[2] }}>🥉 {comp.bonus_xp_3} XP</span>
                        </div>

                        <div className="flex items-center gap-2 mt-3">
                          {comp.is_joined ? (
                            <>
                              <button onClick={() => handleViewCompLeaderboard(comp)}
                                className="text-xs px-4 py-2 rounded-xl font-bold"
                                style={{ background: `${comp.accent_color}15`, border: `1.5px solid ${comp.accent_color}`, color: comp.accent_color }}>
                                {isHi ? '📊 रैंकिंग देखो' : '📊 View Ranking'}
                              </button>
                              <span className="text-xs font-semibold" style={{ color: 'var(--green)' }}>
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
                {competitions.filter(c => !c.is_featured || c.status !== 'live').map(comp => {
                  const sb = STATUS_BADGE[comp.status] || STATUS_BADGE.upcoming;
                  return (
                    <PremiumCard key={comp.id} className="!p-4">
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
                            {comp.is_joined && <span className="text-xs font-bold" style={{ color: 'var(--green)' }}>✓ Joined</span>}
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
                    </PremiumCard>
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
              className="text-xs text-[var(--text-3)] flex items-center gap-1 p-2 rounded-lg"
              aria-label={isHi ? 'वापस जाएं' : 'Back to competitions'}>
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
                    <span className="text-xs font-semibold" style={{ color: RANK_COLORS[0] }}>🥇 {selectedComp.prize_1_title}</span>
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
                  ⚡ {isHi ? 'क्विज़ खेलो' : 'Take Quiz'}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {compLeaderboard.map((entry, idx) => {
                  const isMe = entry.student_id === student.id;
                  return (
                    <PremiumCard key={entry.student_id}
                      glow={isMe}
                      className={`!p-4 flex items-center gap-3${isMe ? ' warm-cta' : ''}`}>
                      <div className="w-8 text-center flex-shrink-0">
                        {idx < 3 ? <span className="text-xl">{MEDALS[idx]}</span>
                          : <span className="text-sm font-bold text-[var(--text-3)]">#{idx + 1}</span>}
                      </div>
                      <Avatar name={entry.name} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">
                          {entry.name}
                          {isMe && <span className="text-xs ml-1" style={{ color: 'var(--accent-warm)' }}>({isHi ? 'तुम' : 'You'})</span>}
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
                    </PremiumCard>
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
              <TabLoader label={isHi ? 'गौरव गाथा लोड हो रही है...' : 'Loading Hall of Fame...'} />
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
                  ⚔️ {isHi ? 'प्रतियोगिता देखो' : 'View Competitions'}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <SectionHeader icon="👑">{isHi ? 'शानदार विजेता' : 'Champions & Winners'}</SectionHeader>
                {fame.map(entry => (
                  <PremiumCard key={entry.id} className="!p-4">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl flex-shrink-0">{entry.rank <= 3 ? MEDALS[entry.rank - 1] : FAME_ICONS[entry.achievement_type] || '🏆'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold">{entry.student_name}</div>
                        <div className="text-xs font-semibold" style={{ color: 'var(--accent-warm)' }}>{entry.title}</div>
                        <div className="text-xs text-[var(--text-3)] mt-0.5">
                          Grade {entry.grade} · {entry.month_year} · {entry.subject || 'All Subjects'}
                          {entry.xp_bonus > 0 && ` · +${entry.xp_bonus} XP`}
                        </div>
                      </div>
                    </div>
                  </PremiumCard>
                ))}
              </div>
            )}
          </>
        )}

        {/* ═══ MY TITLES TAB ═══ */}
        {tab === 'titles' && (
          <>
            {loading ? (
              <TabLoader label={isHi ? 'लोड हो रहा है...' : 'Loading...'} />
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
                    ⚔️ {isHi ? 'प्रतियोगिता' : 'Compete'}
                  </Button>
                  <Button variant="ghost" onClick={() => router.push('/quiz')}>
                    ⚡ {isHi ? 'क्विज़' : 'Quiz'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <SectionHeader icon="🎖️">{isHi ? `मेरे खिताब (${titles.length})` : `My Titles (${titles.length})`}</SectionHeader>
                <div className="grid grid-cols-2 gap-3">
                  {titles.map(t => {
                    // Tier color identity preserved: gold/silver/bronze via the
                    // RANK_COLORS metal tones, other tiers via the purple accent.
                    const tierColor =
                      t.tier === 'gold' ? RANK_COLORS[0]
                      : t.tier === 'silver' ? RANK_COLORS[1]
                      : t.tier === 'bronze' ? RANK_COLORS[2]
                      : 'var(--purple)';
                    return (
                    <div key={t.id} className="rounded-2xl p-4 text-center"
                      style={{
                        background: `color-mix(in srgb, ${tierColor} 8%, var(--surface-1))`,
                        border: `1.5px solid color-mix(in srgb, ${tierColor} 30%, transparent)`,
                      }}>
                      <div className="text-3xl mb-2">{t.icon || '🏆'}</div>
                      <div className="text-xs font-bold">{isHi && t.title_hi ? t.title_hi : t.title}</div>
                      <div className="text-xs text-[var(--text-3)] mt-1 capitalize">{t.tier} · {t.source}</div>
                      <div className="text-xs text-[var(--text-3)]">
                        {new Date(t.earned_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══ STREAKS TAB ═══ */}
        {tab === 'streaks' && (
          <>
            {loading ? (
              <TabLoader label={isHi ? 'स्ट्रीक लोड हो रही हैं...' : 'Loading streaks...'} />
            ) : streakEntries.length === 0 ? (
              <EmptyState
                icon="🔥"
                title={isHi ? 'अभी कोई सक्रिय स्ट्रीक नहीं' : 'No active streaks yet'}
                description={isHi ? 'आज अपनी स्ट्रीक शुरू करो! रोज़ डेली चैलेंज हल करो।' : 'Start yours today! Solve the daily challenge every day.'}
                action={
                  <Button onClick={() => router.push('/dashboard')}>
                    {isHi ? 'डेली चैलेंज खेलो' : 'Play Daily Challenge'}
                  </Button>
                }
              />
            ) : (
              <>
                <SectionHeader icon="🔥">
                  {isHi ? `टॉप स्ट्रीक (${streakEntries.length})` : `Top Streaks (${streakEntries.length})`}
                </SectionHeader>
                <div className="space-y-3">
                  {streakEntries.map((entry, idx) => {
                    const isMe = entry.student_id === student.id;
                    return (
                      <PremiumCard key={entry.student_id}
                        glow={isMe}
                        className={`!p-4 flex items-center gap-3${isMe ? ' warm-cta' : ''}`}>
                        <div className="w-8 text-center flex-shrink-0">
                          {idx < 3 ? <span className="text-xl">{MEDALS[idx]}</span>
                            : <span className="text-sm font-bold text-[var(--text-3)]">#{idx + 1}</span>}
                        </div>
                        <Avatar name={entry.student_name} size={36} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {entry.student_name}
                            {isMe && <span className="text-xs ml-1" style={{ color: 'var(--accent-warm)' }}>({isHi ? 'तुम' : 'You'})</span>}
                          </div>
                          <div className="mt-1">
                            <StreakBadge streak={entry.current_streak} badges={entry.badges} isHi={isHi} size="sm" />
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-lg font-bold" style={{ color: 'var(--accent-warm)' }}>
                            {isHi ? `${entry.current_streak} दिन` : `Day ${entry.current_streak}`}
                          </div>
                          {entry.best_streak > entry.current_streak && (
                            <div className="text-[10px] text-[var(--text-3)]">
                              {isHi ? `सर्वश्रेष्ठ: ${entry.best_streak}` : `Best: ${entry.best_streak}`}
                            </div>
                          )}
                        </div>
                      </PremiumCard>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* ═══ MASTERY TAB ═══ (Phase 5 follow-on) */}
        {tab === 'mastery' && (
          <>
            <SectionHeader icon="🎯">
              {isHi ? 'मास्ट्री रैंक' : 'Mastery Ranking'}
            </SectionHeader>
            <p className="text-xs text-[var(--text-3)] -mt-2 mb-2">
              {isHi
                ? 'XP नहीं — असली समझ के आधार पर'
                : 'Ranked by what you actually know, not raw XP'}
            </p>
            {loading ? (
              <TabLoader label={isHi ? 'लोड हो रहा है...' : 'Loading...'} />
            ) : masteryEntries.length === 0 ? (
              <EmptyState
                icon="🎯"
                title={isHi ? 'अभी कोई डेटा नहीं' : 'No mastery data yet'}
                description={
                  isHi
                    ? 'जब छात्र क्विज़ शुरू करेंगे तो यहाँ रैंक दिखेगी'
                    : 'Rankings appear once students complete quizzes'
                }
              />
            ) : (
              <div className="space-y-1.5" data-testid="mastery-leaderboard-list">
                {masteryEntries.map(entry => {
                  const isMe = entry.student_id === student.id;
                  const pct = Math.round(entry.mean_mastery * 100);
                  const medal = entry.rank <= 3 ? MEDALS[entry.rank - 1] : null;
                  const rankColor =
                    entry.rank <= 3 ? RANK_COLORS[entry.rank - 1] : 'var(--text-3)';
                  return (
                    <PremiumCard
                      key={entry.student_id}
                      glow={isMe}
                      data-testid="mastery-leaderboard-row"
                      className={`flex items-center gap-3 !p-3${isMe ? ' warm-cta' : ''}`}
                    >
                      <div
                        className="w-10 text-center font-bold text-sm flex-shrink-0"
                        style={{ color: rankColor }}
                      >
                        {medal ?? `#${entry.rank}`}
                      </div>
                      <Avatar name={entry.name} size={36} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {entry.name}{isMe && ' '}
                          {isMe && (
                            <span className="text-[10px] font-bold" style={{ color: 'var(--accent-warm)' }}>
                              {isHi ? '(तुम)' : '(you)'}
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-[var(--text-3)] truncate">
                          {isHi ? `कक्षा ${entry.grade}` : `Grade ${entry.grade}`}
                          {entry.school ? ` · ${entry.school}` : ''}
                          {' · '}
                          {isHi
                            ? `${entry.chapters_counted} अध्याय`
                            : `${entry.chapters_counted} ch`}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div
                          className="text-base font-bold"
                          style={{ color: getScoreColor(pct) }}
                        >
                          {pct}%
                        </div>
                        <div className="text-[10px] text-[var(--text-3)]">
                          {isHi ? 'मास्ट्री' : 'mastery'}
                        </div>
                      </div>
                    </PremiumCard>
                  );
                })}
              </div>
            )}
          </>
        )}
        {/* ═══ MY CLASS TAB ═══ */}
        {tab === 'class' && (
          <>
            {/* Period filter — reuse same period state */}
            <div className="flex gap-1.5">
              {PERIODS.map(p => (
                <button key={p.id} onClick={() => setPeriod(p.id)}
                  className="flex-1 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.98]"
                  style={
                    period === p.id
                      ? {
                          background: 'linear-gradient(135deg, var(--accent-warm), var(--accent-warm-strong))',
                          color: '#fff',
                          boxShadow: '0 3px 12px rgb(var(--accent-warm-rgb) / 0.28)',
                        }
                      : { background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }
                  }>
                  {isHi ? p.labelHi : p.label}
                </button>
              ))}
            </div>

            {!classId ? (
              <div className="text-center py-12">
                <div className="text-5xl mb-4">🏫</div>
                <p className="text-sm font-semibold text-[var(--text-2)] mb-1">
                  {isHi
                    ? 'आप अभी किसी कक्षा में नहीं हैं।'
                    : "You're not in a class yet."}
                </p>
                <p className="text-xs text-[var(--text-3)]">
                  {isHi ? 'अपने शिक्षक से कहें।' : 'Ask your teacher to add you.'}
                </p>
              </div>
            ) : classLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: 'var(--surface-2)' }} />
                ))}
              </div>
            ) : !classData?.items || classData.items.length === 0 ? (
              <EmptyState
                icon="🏫"
                title={isHi ? 'अभी कोई रैंकिंग नहीं' : 'No class rankings yet'}
                description={isHi ? 'क्विज़ खेलो और कक्षा में आगे बढ़ो!' : 'Take quizzes to climb the class rankings!'}
                action={
                  <Button onClick={() => router.push('/quiz')}>
                    {isHi ? 'क्विज़ शुरू करो' : 'Start a Quiz'}
                  </Button>
                }
              />
            ) : (
              <>
                <SectionHeader icon="🏫">
                  {isHi ? `कक्षा रैंकिंग (${classData.items.length})` : `Class Rankings (${classData.items.length})`}
                </SectionHeader>
                <div className="space-y-3">
                  {classData.items.map((entry, idx) => {
                    const isMe = entry.student_id === student.id;
                    return (
                      <PremiumCard key={entry.student_id}
                        glow={isMe}
                        className={`!p-4 flex items-center gap-3${isMe ? ' warm-cta' : ''}`}>
                        <div className="w-8 text-center flex-shrink-0">
                          {idx < 3
                            ? <span className="text-xl">{MEDALS[idx]}</span>
                            : <span className="text-sm font-bold text-[var(--text-3)]">#{idx + 1}</span>}
                        </div>
                        <Avatar name={entry.name ?? '?'} size={36} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {entry.name}
                            {isMe && <span className="text-xs ml-1" style={{ color: 'var(--accent-warm)' }}>({isHi ? 'तुम' : 'You'})</span>}
                          </div>
                          <div className="text-xs text-[var(--text-3)]">
                            {isHi ? `कक्षा ${entry.grade}` : `Grade ${entry.grade}`}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-bold gradient-text">{entry.xp_this_period?.toLocaleString()}</div>
                          <div className="text-xs text-[var(--text-3)]">XP</div>
                        </div>
                      </PremiumCard>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        </SectionErrorBoundary>
      </main>


    </div>
  );
}
