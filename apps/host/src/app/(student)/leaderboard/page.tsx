'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { authedFetch } from '@alfanumrik/lib/authed-fetch';
import { getCompetitions, joinCompetition, getCompetitionLeaderboard, getHallOfFame } from '@alfanumrik/lib/supabase';
import { Card, Button, SectionHeader, LoadingFoxy, Avatar, EmptyState, PremiumCard } from '@alfanumrik/ui/ui';
import { BarChart } from '@alfanumrik/ui/admin-ui';
import { logger } from '@alfanumrik/lib/logger';
import { getScoreColor } from '@alfanumrik/lib/score-colors';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import StreakBadge from '@alfanumrik/ui/challenge/StreakBadge';
import { useFeatureFlags, useLeaderboard } from '@alfanumrik/lib/swr';
import { toast } from '@alfanumrik/ui/ui/toast';
import {
  PercentileBandCard,
  type PercentileBand,
} from '@alfanumrik/ui/leaderboard/PercentileBandCard';

/**
 * ── WHY THIS PAGE READS EVERYTHING FROM /api/v1/leaderboard/* ─────────────────
 * Four of these tabs used to query cross-student tables (`performance_scores`,
 * `score_history`, `challenge_streaks`, `student_titles`) DIRECTLY FROM THE
 * BROWSER with the anon key. Every one of those tables is own-row-only (or
 * service-role-only) under RLS, so each read returned at most ONE row — the
 * caller's — and the page rendered that as a peer board: the student was always
 * rank #1 with a gold medal, "My Titles" was permanently empty, and "Streaks"
 * was a board of one. "My Class" resolved its class from `students.class_id`,
 * a column that does not exist, so every enrolled student was told they were
 * not in a class.
 *
 * The fix is server-side routes with service-role reads + explicit P13 field
 * whitelists — NOT looser RLS. All client-side cross-student reads are gone.
 *
 * ── THE CROSS-CUTTING RULE ──────────────────────────────────────────────────
 * Every tab distinguishes LOADING / EMPTY / ERROR as three separate states.
 * "No X yet" is a claim about the world; a non-2xx response cannot establish
 * it, so no reassuring empty state is ever rendered on a failed read.
 */

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

/** Entry returned by /api/v1/leaderboard/my-class (P13 whitelist — exactly this). */
interface ClassLeaderEntry {
  rank: number;
  student_id: string;
  name: string | null;
  grade: string | null;
  avatar_url: string | null;
  xp_total: number;
  xp_this_period: number;
  quizzes: number;
}

/** `data` block of GET /api/v1/leaderboard/my-class. */
interface MyClassData {
  schemaVersion: number;
  period: string;
  enrolled: boolean;
  class_id: string | null;
  resolvedAt: string;
  items: ClassLeaderEntry[];
}

/**
 * The class board has FOUR outcomes, and they are deliberately not collapsible:
 *   'off'        — 404 while `ff_class_leaderboard_v1` is off. Not an error.
 *   enrolled:false — genuinely not in a class.
 *   enrolled:true + items:[] — in a class, nobody has XP for the period yet.
 *   thrown error — the read failed; NEVER render an empty state.
 */
type MyClassResult = { kind: 'off' } | { kind: 'ok'; data: MyClassData };

/**
 * Wire shape of GET /api/v1/leaderboard/me. The route returns the v1 envelope
 * `{ success, data }` — NOT a flat band object. `band` is typed loosely because
 * it can come straight from the RPC's `band` column (free-form text) as well as
 * from the route's own `bandFromPercentile()`; PercentileBandCard narrows it.
 */
interface LeaderboardMeData {
  period: string;
  rank: number | null;
  percentile: number | null;
  xp: number;
  band: PercentileBand | string | null;
  neighbours: Array<{ rank: number; name: string; xp: number; delta: number }>;
  /** The CALLER'S OWN Performance Score. `null` = no scored subjects yet —
   *  it is NEVER rendered as 0. Peer scores are not served anywhere. */
  performance_score: number | null;
  level_name: string | null;
}

interface LeaderboardMeEnvelope {
  success: boolean;
  data: LeaderboardMeData | null;
  error?: string;
}

/** Peer row from /api/v1/leaderboard/streaks. `best_streak` is deliberately
 *  NOT here — a peer's historical maximum is outside the peer-visible norm and
 *  the server does not send it. It exists only on `me`. */
interface StreakPeerItem {
  rank: number;
  student_id: string;
  name: string | null;
  grade: string | null;
  current_streak: number;
  badges: string[];
}

/** The caller's own streak row — full fidelity, own data. */
interface StreakMe {
  student_id: string;
  current_streak: number;
  best_streak: number;
  badges: string[];
  rank: number | null;
  on_board: boolean;
}

interface StreaksData {
  schemaVersion: number;
  resolvedAt: string;
  threshold: number;
  items: StreakPeerItem[];
  me: StreakMe | null;
}

/** Own title from /api/v1/leaderboard/titles. */
interface TitleItem {
  id: string;
  title: string;
  title_hi: string | null;
  icon: string | null;
  tier: string | null;
  source: string | null;
  earned_at: string | null;
}

interface TitlesData {
  schemaVersion: number;
  resolvedAt: string;
  titles: TitleItem[];
}

/* Period ids are the SERVER's vocabulary ('all_time', not 'all') so the label
   the student taps and the window the server aggregates can never diverge. */
const PERIODS = [
  { id: 'weekly', label: 'This Week', labelHi: 'इस हफ़्ते' },
  { id: 'monthly', label: 'This Month', labelHi: 'इस महीने' },
  { id: 'all_time', label: 'All Time', labelHi: 'कुल' },
] as const;

/* The class board aggregates daily/weekly/monthly only — "All Time" is not a
   window it can answer, so it is not offered there rather than silently
   served as "weekly" under an "All Time" label. */
const CLASS_PERIODS = PERIODS.filter((p) => p.id !== 'all_time');
type ClassPeriod = 'weekly' | 'monthly';

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

/* One honest failure card for every tab. Rendered INSTEAD of (never alongside)
   any reassuring empty state. The primary control is Retry — a bare Dismiss
   left the student with no way back. min-h/min-w pin it to the 44px touch
   floor (WCAG 2.5.8), which the old bare text buttons did not meet. */
function LoadFailure({
  isHi,
  onRetry,
  onDismiss,
}: {
  isHi: boolean;
  onRetry: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div role="alert" className="mx-4 mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 flex items-center gap-2">
      <span aria-hidden="true">⚠️</span>
      <span className="flex-1">{isHi ? 'डेटा लोड नहीं हो सका' : 'Failed to load data'}</span>
      <button
        onClick={onRetry}
        className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 text-red-700 font-semibold underline"
      >
        🔄 {isHi ? 'फिर से कोशिश करो' : 'Retry'}
      </button>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] text-red-700 font-bold"
          aria-label={isHi ? 'बंद करें' : 'Dismiss'}
        >✕</button>
      )}
    </div>
  );
}

/**
 * Shared fetcher for the v1 `{ success, data }` envelope routes.
 * Anything that is not a 2xx envelope with `success: true` THROWS, so it lands
 * on SWR's `error` channel. It must never resolve to an empty payload — that is
 * exactly how a failed read becomes "No X yet" on screen.
 */
async function fetchEnvelope<T>(url: string): Promise<T> {
  // authedFetch forwards `Authorization: Bearer <token>` from the live
  // Supabase session (session lives in localStorage, not a cookie) — every
  // route behind this fetcher is authorizeRequest()-gated and a bare fetch()
  // 401s for every student. See @alfanumrik/lib/authed-fetch header comment.
  const res = await authedFetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const err = new Error(`${url}: HTTP ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: T }
    | null;
  if (!json || json.success !== true || json.data == null) {
    throw new Error(`${url}: malformed response`);
  }
  return json.data;
}

export default function LeaderboardPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const isInsideRoleShellMain = false;

  const [tab, setTab] = useState<Tab>('ranks');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['id']>('weekly');
  const [classPeriod, setClassPeriod] = useState<ClassPeriod>('weekly');
  const [competitions, setCompetitions] = useState<RPCRecord[]>([]);
  const [fame, setFame] = useState<RPCRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<string | null>(null);
  const [selectedComp, setSelectedComp] = useState<RPCRecord | null>(null);
  const [compLeaderboard, setCompLeaderboard] = useState<RPCRecord[]>([]);
  // Phase 5 follow-on — mastery-percentile tab. Renders only when
  // ff_personalised_compete_v1 is on (server's /api/v1/leaderboard/mastery
  // also 404s when off). Falls through to legacy tabs when flag is off.
  const [masteryEntries, setMasteryEntries] = useState<MasteryLeaderEntry[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const { data: lbFlags } = useFeatureFlags();
  const masteryTabOn = lbFlags?.ff_personalised_compete_v1 === true;

  /* ── RANKINGS ─────────────────────────────────────────────────────────────
     Server-computed ranks, straight from the CDN-cached route via the shared
     hook. There is deliberately NO client-side enrichment or re-sort: the old
     `performance_scores` / `score_history` browser reads returned only the
     caller's row, so every peer sorted to -1 and the caller took rank #1. */
  const {
    data: board,
    error: ranksError,
    isLoading: ranksLoading,
    mutate: reloadRanks,
  } = useLeaderboard(period, 50);
  const entries = board?.entries ?? [];
  // The board's ranking basis is the SERVER's to declare, never the client's.
  const rankedBy = board?.rankedBy ?? 'xp';

  /* ── MY TITLES ── own-data; service-role read scoped server-side. */
  const {
    data: titlesData,
    error: titlesError,
    isLoading: titlesLoading,
    mutate: reloadTitles,
  } = useSWR<TitlesData>(
    isLoggedIn && tab === 'titles' ? '/api/v1/leaderboard/titles' : null,
    fetchEnvelope<TitlesData>,
    { revalidateOnFocus: false },
  );
  const titles = titlesData?.titles ?? [];

  /* ── STREAKS ── peer board + the caller's own row (`me`). */
  const {
    data: streaksData,
    error: streaksError,
    isLoading: streaksLoading,
    mutate: reloadStreaks,
  } = useSWR<StreaksData>(
    isLoggedIn && tab === 'streaks' ? '/api/v1/leaderboard/streaks?limit=50' : null,
    fetchEnvelope<StreaksData>,
    { refreshInterval: 60_000 },
  );
  const streakItems = streaksData?.items ?? [];
  const myStreak = streaksData?.me ?? null;

  /* ── MY CLASS ── one fetch, no class-id plumbing: membership is resolved
     server-side from `class_students`. `students.class_id` never existed. */
  const {
    data: classResult,
    isLoading: classLoading,
    error: classError,
    mutate: reloadClass,
  } = useSWR<MyClassResult>(
    isLoggedIn && tab === 'class'
      ? `/api/v1/leaderboard/my-class?period=${classPeriod}&limit=20`
      : null,
    async (url: string): Promise<MyClassResult> => {
      const res = await authedFetch(url, { credentials: 'same-origin' });
      // 404 = `ff_class_leaderboard_v1` is off. That is a deliberate product
      // state, not a failure — it must not raise an error banner.
      if (res.status === 404) return { kind: 'off' };
      if (!res.ok) throw new Error(`my-class leaderboard: HTTP ${res.status}`);
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: MyClassData }
        | null;
      if (!json || json.success !== true || !json.data) {
        throw new Error('my-class leaderboard: malformed response');
      }
      return { kind: 'ok', data: json.data };
    },
    { refreshInterval: 60_000 },
  );

  // U10 — personal percentile band (never expose absolute numeric rank).
  // The route replies with the v1 ENVELOPE `{ success, data }` — this fetcher
  // used to `return res.json()` and read `.band` off the envelope, which is
  // always `undefined` and crashed PercentileBandCard, taking every tab on the
  // page down with it via <SectionErrorBoundary>. Unwrap `data` here; the API
  // shape is unchanged (other consumers depend on it).
  const { data: bandData } = useSWR<LeaderboardMeData | null>(
    isLoggedIn ? `/api/v1/leaderboard/me?period=${period}` : null,
    async (url: string) => {
      const res = await authedFetch(url, { credentials: 'same-origin' });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as LeaderboardMeEnvelope | null;
      // success:false, data:null, or a malformed body → no card, no throw.
      if (!json || json.success !== true || !json.data) return null;
      return json.data;
    },
    { refreshInterval: 300_000 },
  );

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  /* Observability for every server-backed tab. P13: reason only — never a
     student id, never a row payload. */
  useEffect(() => {
    const failures: Array<[string, unknown]> = [
      ['rankings', ranksError],
      ['titles', titlesError],
      ['streaks', streaksError],
      ['my-class', classError],
    ];
    for (const [scope, err] of failures) {
      if (!err) continue;
      logger.warn(`leaderboard: ${scope} load failed`, {
        reason: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }, [ranksError, titlesError, streaksError, classError]);

  // Load competitions
  const loadCompetitions = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    setFetchError(null);
    try {
      const result = await getCompetitions(student.id);
      if (!result.ok) throw new Error(result.error);
      setCompetitions(Array.isArray(result.data) ? result.data : []);
    } catch { setCompetitions([]); setFetchError(isHi ? 'डेटा लोड नहीं हो सका' : 'Failed to load data'); }
    setLoading(false);
  }, [student, isHi]);

  // Load hall of fame
  const loadFame = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const result = await getHallOfFame(30);
      if (!result.ok) throw new Error(result.error);
      setFame(Array.isArray(result.data) ? result.data : []);
    } catch { setFame([]); setFetchError(isHi ? 'डेटा लोड नहीं हो सका' : 'Failed to load data'); }
    setLoading(false);
  }, [isHi]);

  /* The "My Titles" and "Streaks" client reads are GONE.
     `student_titles` is service-role-only under RLS (one policy, no student
     SELECT) so the browser read returned zero rows for everyone, forever;
     `challenge_streaks` + `students` are own-row-only, so the "Top Streaks"
     board could contain at most the caller. Both now come from
     /api/v1/leaderboard/{titles,streaks} through the SWR hooks above. */

  // Phase 5 follow-on — mastery leaderboard fetcher. 404 = flag off
  // or no profile; treat as empty (UI renders the empty state).
  const loadMastery = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await authedFetch('/api/v1/leaderboard/mastery?limit=50', {
        credentials: 'same-origin',
      });
      if (res.status === 404) {
        // 404 = flag off or no profile. The ONLY non-2xx that is a genuine
        // "nothing here" answer.
        setMasteryEntries([]);
      } else if (res.ok) {
        const body = (await res.json()) as { items?: MasteryLeaderEntry[] };
        setMasteryEntries(Array.isArray(body.items) ? body.items : []);
      } else {
        // Every other non-2xx is a failure. Collapsing it into [] rendered
        // "No mastery data yet" after a 500.
        throw new Error(`mastery leaderboard: HTTP ${res.status}`);
      }
    } catch {
      setMasteryEntries([]);
      setFetchError(isHi ? 'डेटा लोड नहीं हो सका' : 'Failed to load data');
    }
    setLoading(false);
  }, [isHi]);

  /* Rankings / titles / streaks / my-class are SWR-owned (keyed on tab +
     period), so only the three legacy RPC-backed tabs still load imperatively. */
  useEffect(() => {
    if (!student) return;
    if (tab === 'compete') loadCompetitions();
    else if (tab === 'fame') loadFame();
    else if (tab === 'mastery') loadMastery();
    // Intentionally key on student?.id, not the student object, to avoid re-firing on every AuthContext refresh — see render-loop fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, student?.id, loadCompetitions, loadFame, loadMastery]);

  // Retry for the shared error card, which now serves only the imperative tabs.
  const reloadActiveTab = useCallback(() => {
    if (tab === 'compete') loadCompetitions();
    else if (tab === 'fame') loadFame();
    else if (tab === 'mastery') loadMastery();
    else setFetchError(null);
  }, [tab, loadCompetitions, loadFame, loadMastery]);

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
    setFetchError(null);
    try {
      const result = await getCompetitionLeaderboard(comp.id, 50);
      if (!result.ok) throw new Error(result.error);
      setCompLeaderboard(Array.isArray(result.data) ? result.data : []);
    } catch {
      // "No scores yet. Take a quiz to compete!" would otherwise be shown to a
      // student whose read just failed — it invites a wasted action based on a
      // false premise.
      setCompLeaderboard([]);
      setFetchError(isHi ? 'डेटा लोड नहीं हो सका' : 'Failed to load data');
    }
  };

  if (isLoading || !student) return <LoadingFoxy />;

  /* P7: grade is a STRING (P5) and is never rendered as a bare "Gr 8". */
  const gradeLabel = (grade: string | null | undefined) =>
    grade == null || grade === '' ? null : isHi ? `कक्षा ${grade}` : `Grade ${grade}`;

  /* The board is labelled from the SERVER's declared basis. 'xp' is the only
     basis this route produces today; anything else is echoed rather than
     silently mislabelled. */
  const rankedByLabel = rankedBy === 'xp' ? 'XP' : rankedBy;

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
  const ContentElement = isInsideRoleShellMain ? 'div' : 'main';

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* Header */}
      <header className="page-header" style={{ background: 'color-mix(in srgb, var(--surface-1) 88%, transparent)', backdropFilter: 'blur(20px)' }}>
        <div className="app-container py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)] p-2 rounded-lg" aria-label={isHi ? 'वापस जाएं' : 'Go back'}>&larr;</button>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
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

      <ContentElement className="app-container py-4 space-y-3">
        <SectionErrorBoundary section="Leaderboard">

        {/* Failure state for the imperative tabs (Compete / Hall of Fame /
            Mastery). Rendered INSTEAD of (never alongside) their reassuring
            empty states — each of those is gated on `!fetchError` below.
            The SWR-backed tabs carry their own failure branch inline. */}
        {fetchError && (
          <LoadFailure isHi={isHi} onRetry={reloadActiveTab} onDismiss={() => setFetchError(null)} />
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
                          background: 'var(--surface-accent)',
                          color: 'var(--on-surface-accent)',
                          boxShadow: '0 3px 12px rgb(var(--accent-warm-rgb) / 0.28)',
                        }
                      : { background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }
                  }>
                  {isHi ? p.labelHi : p.label}
                </button>
              ))}
            </div>

            {/* U10 — personal percentile band (no absolute rank ever). A
                partial payload (no band yet — e.g. a student with no ranking)
                skips the card rather than passing `undefined` down. */}
            {bandData?.band ? <PercentileBandCard band={bandData.band} isHi={isHi} /> : null}

            {/* The caller's OWN Performance Score — own data, served privately by
                /api/v1/leaderboard/me. `null` means "no scored subjects yet" and
                is rendered as an ABSENCE, never as a 0. Peer Performance Scores
                are not served anywhere and are not shown on this board. */}
            {bandData?.performance_score != null && (
              <PremiumCard className="!p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[var(--text-3)]">
                    {isHi ? 'तुम्हारा परफ़ॉर्मेंस स्कोर' : 'Your Performance Score'}
                  </div>
                  {bandData.level_name && (
                    <div className="text-sm font-semibold mt-0.5" style={{ color: getScoreColor(bandData.performance_score) }}>
                      {bandData.level_name}
                    </div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="text-2xl font-bold" style={{ color: getScoreColor(bandData.performance_score) }}>
                    {bandData.performance_score}
                  </span>
                  <span className="text-xs text-[var(--text-3)]">
                    {isHi ? ' / 100 अंक' : ' out of 100'}
                  </span>
                </div>
              </PremiumCard>
            )}

            {/* Top 3 Podium — medal position is the SERVER's rank, not the array
                index, so nothing on this page can promote the caller. Renders
                only on a successful, non-empty read (entries is [] otherwise). */}
            {entries.length >= 3 && (
              <div className="flex items-end justify-center gap-3 py-4">
                {[1, 0, 2].map(idx => {
                  const e = entries[idx];
                  if (!e) return null;
                  const isMe = e.student_id === student.id;
                  const height = idx === 0 ? 'h-28' : idx === 1 ? 'h-20' : 'h-16';
                  const medalIdx = Math.min(Math.max(e.rank, 1), 3) - 1;
                  return (
                    <div key={e.student_id} className="flex flex-col items-center" style={{ width: idx === 0 ? '40%' : '30%' }}>
                      <div className={`text-${idx === 0 ? '3xl' : '2xl'} mb-1`}>{MEDALS[medalIdx]}</div>
                      <Avatar name={e.name ?? ''} size={idx === 0 ? 48 : 36} />
                      <div className="text-xs font-bold mt-1 truncate max-w-full text-center" style={isMe ? { color: 'var(--accent-warm)' } : undefined}>
                        {e.name ?? (isHi ? 'छात्र' : 'Student')}{isMe ? (isHi ? ' (तुम)' : ' (You)') : ''}
                      </div>
                      {gradeLabel(e.grade) && (
                        <div className="text-xs text-[var(--text-3)]">{gradeLabel(e.grade)}</div>
                      )}
                      <div className={`w-full ${height} rounded-t-xl mt-2 flex flex-col items-center justify-end pb-2`}
                        style={{
                          background: `color-mix(in srgb, ${RANK_COLORS[medalIdx]} 16%, var(--surface-1))`,
                          border: `1.5px solid color-mix(in srgb, ${RANK_COLORS[medalIdx]} 40%, transparent)`,
                          boxShadow: medalIdx === 0 ? '0 6px 18px color-mix(in srgb, var(--gold) 22%, transparent)' : undefined,
                        }}>
                        <span className="text-sm font-bold" style={{ color: RANK_COLORS[medalIdx] }}>
                          {e.total_xp.toLocaleString()} XP
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Top 10 chart — labelled from the SERVER's `ranked_by`. The old
                "Top 10 by Performance Score" header was false: the board was
                (and is) ranked by XP. */}
            {!ranksLoading && !ranksError && entries.length > 0 && (
              <section className="mb-2">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--text-3)]">
                  {isHi ? `शीर्ष 10 — ${rankedByLabel}` : `Top 10 by ${rankedByLabel}`}
                </h2>
                <BarChart
                  series={[
                    {
                      name: rankedByLabel,
                      data: entries.slice(0, 10).map((e) => ({
                        x: e.name ?? '?',
                        y: e.total_xp,
                      })),
                    },
                  ]}
                  height={200}
                />
              </section>
            )}

            {/* Full list — LOADING / ERROR / EMPTY / DATA, four distinct states.
                The empty state is reachable ONLY from a successful read. */}
            {ranksLoading ? (
              <TabLoader label={isHi ? 'लोड हो रहा है...' : 'Loading rankings...'} />
            ) : ranksError ? (
              <LoadFailure isHi={isHi} onRetry={() => { void reloadRanks(); }} />
            ) : entries.length === 0 ? (
              <EmptyState
                icon="🏆"
                title={isHi ? 'अभी कोई रैंकिंग नहीं' : 'No rankings yet'}
                description={isHi ? 'क्विज़ खेलो, XP कमाओ — और रैंकिंग में ऊपर चढ़ो!' : 'Take quizzes to earn XP and climb the ranks!'}
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
                  {entries.map((entry) => {
                    const isMe = entry.student_id === student.id;
                    // Rank comes from the SERVER. Nothing here renumbers it, so
                    // the caller can no longer be handed #1 by a client re-sort.
                    const medal = entry.rank >= 1 && entry.rank <= 3 ? MEDALS[entry.rank - 1] : null;
                    return (
                      <PremiumCard key={entry.student_id}
                        glow={isMe}
                        className={`!p-4 flex items-center gap-3${isMe ? ' warm-cta' : ''}`}>
                        <div className="w-8 text-center flex-shrink-0">
                          {medal
                            ? <span className="text-xl">{medal}</span>
                            : <span className="text-sm font-bold text-[var(--text-3)]">#{entry.rank}</span>}
                        </div>
                        <Avatar name={entry.name ?? '?'} size={36} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {entry.name ?? (isHi ? 'छात्र' : 'Student')}
                            {isMe && <span className="text-xs ml-1" style={{ color: 'var(--accent-warm)' }}>({isHi ? 'तुम' : 'You'})</span>}
                          </div>
                          {/* P13: name + grade are the WHOLE peer whitelist here.
                              `school` / `city` are no longer served by the route
                              (and were rendering as `undefined` even before). */}
                          {gradeLabel(entry.grade) && (
                            <div className="text-xs text-[var(--text-3)]">{gradeLabel(entry.grade)}</div>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          {/* This number is XP and is now labelled XP. It used to
                              read "Foxy Coins" — an unrelated currency
                              (`coin_balances`, spent in the /profile Shop). */}
                          <div className="text-sm font-bold gradient-text">{entry.total_xp.toLocaleString()}</div>
                          <div className="text-xs text-[var(--text-3)]">XP</div>
                          <div className="text-[10px] text-[var(--text-3)] mt-0.5">
                            🔥 {entry.streak} {'\u00B7'}{' '}
                            {isHi ? `${entry.sessions} क्विज़` : `${entry.sessions} quizzes`}
                          </div>
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
              fetchError ? null :
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
              fetchError ? null :
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
              fetchError ? null :
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
            {/* LOADING / ERROR / EMPTY / DATA. A titles read failure is a 500,
                never `[]` — "No Titles Yet" is a claim about what the student
                has earned and a failed read cannot establish it. */}
            {titlesLoading ? (
              <TabLoader label={isHi ? 'लोड हो रहा है...' : 'Loading...'} />
            ) : titlesError ? (
              <LoadFailure isHi={isHi} onRetry={() => { void reloadTitles(); }} />
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
                    // tier/source are nullable on the contract — a missing one
                    // must not render as "null · null".
                    const meta = [t.tier, t.source].filter(Boolean).join(' · ');
                    return (
                    <div key={t.id} className="rounded-2xl p-4 text-center"
                      style={{
                        background: `color-mix(in srgb, ${tierColor} 8%, var(--surface-1))`,
                        border: `1.5px solid color-mix(in srgb, ${tierColor} 30%, transparent)`,
                      }}>
                      <div className="text-3xl mb-2">{t.icon || '🏆'}</div>
                      {/* P7: the server ships `title_hi`; use it under isHi. */}
                      <div className="text-xs font-bold">{isHi && t.title_hi ? t.title_hi : t.title}</div>
                      {meta && (
                        <div className="text-xs text-[var(--text-3)] mt-1 capitalize">{meta}</div>
                      )}
                      {t.earned_at && (
                        <div className="text-xs text-[var(--text-3)]">
                          {new Date(t.earned_at).toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', { month: 'short', year: 'numeric' })}
                        </div>
                      )}
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
            {/* LOADING / ERROR / EMPTY / DATA. The board used to be a board of
                ONE (own-row-only RLS on `challenge_streaks` + `students`); it is
                now the server's peer board. */}
            {streaksLoading ? (
              <TabLoader label={isHi ? 'स्ट्रीक लोड हो रही हैं...' : 'Loading streaks...'} />
            ) : streaksError ? (
              <LoadFailure isHi={isHi} onRetry={() => { void reloadStreaks(); }} />
            ) : streakItems.length === 0 ? (
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
                {/* Own streak, shown when the caller is below the board's
                    visibility threshold — otherwise they simply vanish from a
                    page that is partly about their own streak. */}
                {myStreak && !myStreak.on_board && myStreak.current_streak > 0 && (
                  <PremiumCard className="!p-4 flex items-center gap-3 warm-cta">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">{isHi ? 'तुम्हारी स्ट्रीक' : 'Your streak'}</div>
                      <div className="mt-1">
                        <StreakBadge streak={myStreak.current_streak} badges={myStreak.badges} isHi={isHi} size="sm" />
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-lg font-bold" style={{ color: 'var(--accent-warm)' }}>
                        {isHi ? `${myStreak.current_streak} दिन` : `Day ${myStreak.current_streak}`}
                      </div>
                      {myStreak.best_streak > myStreak.current_streak && (
                        <div className="text-[10px] text-[var(--text-3)]">
                          {isHi ? `सर्वश्रेष्ठ: ${myStreak.best_streak}` : `Best: ${myStreak.best_streak}`}
                        </div>
                      )}
                    </div>
                  </PremiumCard>
                )}

                <SectionHeader icon="🔥">
                  {isHi ? `टॉप स्ट्रीक (${streakItems.length})` : `Top Streaks (${streakItems.length})`}
                </SectionHeader>
                <div className="space-y-3">
                  {streakItems.map((entry) => {
                    const isMe = entry.student_id === student.id;
                    const medal = entry.rank >= 1 && entry.rank <= 3 ? MEDALS[entry.rank - 1] : null;
                    return (
                      <PremiumCard key={entry.student_id}
                        glow={isMe}
                        className={`!p-4 flex items-center gap-3${isMe ? ' warm-cta' : ''}`}>
                        <div className="w-8 text-center flex-shrink-0">
                          {medal
                            ? <span className="text-xl">{medal}</span>
                            : <span className="text-sm font-bold text-[var(--text-3)]">#{entry.rank}</span>}
                        </div>
                        <Avatar name={entry.name ?? '?'} size={36} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {entry.name ?? (isHi ? 'छात्र' : 'Student')}
                            {isMe && <span className="text-xs ml-1" style={{ color: 'var(--accent-warm)' }}>({isHi ? 'तुम' : 'You'})</span>}
                          </div>
                          {gradeLabel(entry.grade) && (
                            <div className="text-xs text-[var(--text-3)]">{gradeLabel(entry.grade)}</div>
                          )}
                          <div className="mt-1">
                            <StreakBadge streak={entry.current_streak} badges={entry.badges} isHi={isHi} size="sm" />
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-lg font-bold" style={{ color: 'var(--accent-warm)' }}>
                            {isHi ? `${entry.current_streak} दिन` : `Day ${entry.current_streak}`}
                          </div>
                          {/* `best_streak` exists ONLY on `me` — a peer's
                              historical maximum is outside the peer whitelist
                              and the server never sends it. */}
                          {isMe && myStreak && myStreak.best_streak > entry.current_streak && (
                            <div className="text-[10px] text-[var(--text-3)]">
                              {isHi ? `सर्वश्रेष्ठ: ${myStreak.best_streak}` : `Best: ${myStreak.best_streak}`}
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
              fetchError ? null :
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
            {/* The class board answers daily/weekly/monthly only — "All Time"
                is not offered here rather than silently served as weekly. */}
            <div className="flex gap-1.5">
              {CLASS_PERIODS.map(p => (
                <button key={p.id} onClick={() => setClassPeriod(p.id as ClassPeriod)}
                  className="flex-1 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.98]"
                  style={
                    classPeriod === p.id
                      ? {
                          background: 'var(--surface-accent)',
                          color: 'var(--on-surface-accent)',
                          boxShadow: '0 3px 12px rgb(var(--accent-warm-rgb) / 0.28)',
                        }
                      : { background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }
                  }>
                  {isHi ? p.labelHi : p.label}
                </button>
              ))}
            </div>

            {/* FIVE distinct outcomes, none of them collapsed into another:
                loading / failed / feature-off / not-enrolled / enrolled-but-empty.
                Class membership is resolved SERVER-SIDE from `class_students`;
                the page no longer reads a `students.class_id` that never
                existed and always resolved to null. */}
            {classLoading ? (
              <div className="space-y-3" role="status" aria-label={isHi ? 'लोड हो रहा है' : 'Loading class rankings'}>
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: 'var(--surface-2)' }} />
                ))}
              </div>
            ) : classError ? (
              // An error REPLACES the reassuring empty, it never sits next to it.
              <LoadFailure isHi={isHi} onRetry={() => { void reloadClass(); }} />
            ) : classResult?.kind === 'off' ? (
              // 404 while `ff_class_leaderboard_v1` is off. A deliberate product
              // state — not a failure, so no error banner.
              <div className="text-center py-12">
                <div className="text-5xl mb-4">🏫</div>
                <p className="text-sm font-semibold text-[var(--text-2)] mb-1">
                  {isHi ? 'कक्षा रैंकिंग जल्द आ रही है' : 'Class rankings are coming soon'}
                </p>
                <p className="text-xs text-[var(--text-3)]">
                  {isHi ? 'तब तक बाकी रैंकिंग देखो।' : 'Check the other rankings in the meantime.'}
                </p>
              </div>
            ) : classResult?.kind === 'ok' && !classResult.data.enrolled ? (
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
            ) : classResult?.kind === 'ok' && classResult.data.items.length === 0 ? (
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
            ) : classResult?.kind === 'ok' ? (
              <>
                <SectionHeader icon="🏫">
                  {isHi ? `कक्षा रैंकिंग (${classResult.data.items.length})` : `Class Rankings (${classResult.data.items.length})`}
                </SectionHeader>
                <div className="space-y-3">
                  {classResult.data.items.map((entry) => {
                    const isMe = entry.student_id === student.id;
                    const medal = entry.rank >= 1 && entry.rank <= 3 ? MEDALS[entry.rank - 1] : null;
                    return (
                      <PremiumCard key={entry.student_id}
                        glow={isMe}
                        className={`!p-4 flex items-center gap-3${isMe ? ' warm-cta' : ''}`}>
                        <div className="w-8 text-center flex-shrink-0">
                          {medal
                            ? <span className="text-xl">{medal}</span>
                            : <span className="text-sm font-bold text-[var(--text-3)]">#{entry.rank}</span>}
                        </div>
                        <Avatar name={entry.name ?? '?'} size={36} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {entry.name ?? (isHi ? 'छात्र' : 'Student')}
                            {isMe && <span className="text-xs ml-1" style={{ color: 'var(--accent-warm)' }}>({isHi ? 'तुम' : 'You'})</span>}
                          </div>
                          {gradeLabel(entry.grade) && (
                            <div className="text-xs text-[var(--text-3)]">{gradeLabel(entry.grade)}</div>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-bold gradient-text">{entry.xp_this_period.toLocaleString()}</div>
                          <div className="text-xs text-[var(--text-3)]">XP</div>
                          <div className="text-[10px] text-[var(--text-3)] mt-0.5">
                            {isHi ? `${entry.quizzes} क्विज़` : `${entry.quizzes} quizzes`}
                          </div>
                        </div>
                      </PremiumCard>
                    );
                  })}
                </div>
              </>
            ) : null}
          </>
        )}

        </SectionErrorBoundary>
      </ContentElement>


    </div>
  );
}
