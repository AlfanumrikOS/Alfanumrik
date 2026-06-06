'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/AuthContext';
import { supabase, getFeatureFlags } from '@/lib/supabase';
import { getLevelFromScore } from '@/lib/score-config';
import { useAtlasFlag } from '@/lib/use-atlas-flag';
import { useRealtimeRevalidator } from '@/hooks/useRealtimeRevalidator';
import { useFeatureFlags } from '@/lib/swr';
import { REALTIME_FLAGS, CONSUMER_MINIMALISM_FLAGS } from '@/lib/feature-flags';
import AtlasParent from './AtlasParent';
// Cosmic redesign (ff_cosmic_redesign_v1). When the flag is ON the parent home
// is reskinned to the cosmic composition + a Starfield is layered behind it.
// When OFF, useCosmicTheme().cosmicEnabled is false and NONE of this renders —
// the legacy DOM below stays byte-identical to today (and Atlas/legacy dispatch
// is untouched).
import { useCosmicTheme } from '@/lib/cosmic-theme';
import { Starfield } from '@/components/cosmic';
import {
  type ParentSession,
  type StudentSession,
  storeParentSession,
  loadParentSession,
  clearParentSession,
  recordFailedAttempt,
  clearLockoutAttempts,
  isLockedOut,
} from './_components/parent-session';

const ScoreCard = dynamic(() => import('@/components/score/ScoreCard'), { ssr: false });

// Cosmic parent home — lazily imported so its cosmic primitives never enter the
// flag-OFF first-paint bundle (ssr:false keeps it client-only). Rendered only
// when ff_cosmic_redesign_v1 resolves ON.
const CosmicParentHome = dynamic(() => import('./CosmicParentHome'), { ssr: false });

// Parent "glance" home (Consumer Minimalism Wave C, ff_parent_glance_v1).
// Lazy-loaded so its code never enters the flag-OFF first-paint bundle — when
// the flag is OFF this import is never resolved and the legacy 8-tab DOM below
// renders byte-identically. Read-only reorg; reuses the SAME fetched data.
const ParentGlanceHome = dynamic(() => import('@/components/parent/ParentGlanceHome'), { ssr: false });

// ============================================================
// BILINGUAL HELPERS (P7)
// ============================================================
const t = (isHi: boolean, en: string, hi: string) => isHi ? hi : en;

// ============================================================
// INTERFACES
// ============================================================

interface DashboardStats {
  xp: number;
  streak: number;
  accuracy: number;
  totalQuizzes: number;
  minutes: number;
  totalChats: number;
  avgScore: number;
}

interface WeeklyDay {
  quizzes: number;
  active: boolean;
  label: string;
}

interface WeekSummary {
  quizzes: number;
  avgScore: number;
  activeDays: number;
}

interface BktMastery {
  levels: Record<string, number>;
  total: number;
}

interface ActiveBurst {
  type: string;
  title: string;
  progress: number;
  goal: number;
  xp: number;
}

interface ParentTip {
  id: string;
  title: string;
  description: string;
}

interface DashboardData {
  error?: string;
  student?: { name: string; grade: string };
  subject?: string;
  stats: DashboardStats;
  dailyActivity?: WeeklyDay[];
  weekSummary?: WeekSummary;
  bktMastery?: BktMastery;
  activeBursts?: ActiveBurst[];
  insights?: string[];
}

async function api(action: string, params: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('parent-portal', {
    body: { action, ...params },
  });
  if (error) {
    throw new Error(`API error: ${error.message || 'Unknown error'}`);
  }
  return data;
}

// ============================================================
// PARENT LOGIN SCREEN
// ============================================================
// Brute-force protection helpers (recordFailedAttempt, clearLockoutAttempts,
// isLockedOut) are imported from ./_components/parent-session so they can
// be reused and tested independently. Progressive lockout: 3 -> 5 -> 15 -> 60 min.

function LoginScreen({ onLogin, isHi, authUserId, prefillName }: { onLogin: (g: ParentSession, s: StudentSession) => void; isHi: boolean; authUserId?: string | null; prefillName?: string }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState(prefillName || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!code.trim()) { setError(t(isHi, 'Please enter link code', 'कृपया लिंक कोड दर्ज करें')); return; }

    // Check lockout before attempting
    const lockout = isLockedOut();
    if (lockout.locked) { setError(lockout.message); return; }

    setLoading(true); setError('');
    try {
      // Pass auth_user_id explicitly so the edge function can find the existing
      // guardian profile from Supabase auth signup — eliminates orphan guardians
      // even if the Authorization header token extraction fails.
      const res = await api('parent_login', { link_code: code, parent_name: name || 'Parent', auth_user_id: authUserId || null });
      setLoading(false);
      if (res.error) {
        // Record failed attempt for lockout
        const lockMsg = recordFailedAttempt();
        setError(lockMsg || res.error);
        return;
      }
      // Success — clear lockout state
      clearLockoutAttempts();
      await storeParentSession(res.guardian, res.student);
      onLogin(res.guardian, res.student);
    } catch (err) {
      setLoading(false);
      const lockMsg = recordFailedAttempt();
      setError(lockMsg || 'Connection error. Please try again.');
    }
  };

  return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-screen flex items-center justify-center">
      <div className="max-w-[380px] w-full text-center">
        <div className="text-5xl mb-3">&#x1F9D1;&#x200D;&#x1F393;</div>
        <h1 className="text-[22px] font-bold text-gray-900 mb-1">{t(isHi, 'Parent Dashboard', 'अभिभावक डैशबोर्ड')}</h1>
        <p className="text-sm text-gray-500 mb-6">{t(isHi, "Enter your child's link code to view their progress", 'अपने बच्चे की प्रगति देखने के लिए लिंक कोड दर्ज करें')}</p>
        {prefillName ? (
          <p className="text-sm text-gray-700 mb-3 font-medium">
            {t(isHi, `Welcome, ${prefillName}!`, `स्वागत है, ${prefillName}!`)} {t(isHi, "Enter your child's link code to continue.", 'जारी रखने के लिए अपने बच्चे का लिंक कोड दर्ज करें।')}
          </p>
        ) : (
          <input className="w-full px-3.5 py-3 bg-orange-50 border border-orange-200 rounded-[10px] text-gray-900 text-[15px] outline-none mb-2.5 box-border" placeholder={t(isHi, 'Your name', 'आपका नाम')} value={name} onChange={e => setName(e.target.value)} aria-label={t(isHi, 'Your name', 'आपका नाम')} autoComplete="name" />
        )}
        <input className="w-full px-3.5 py-3 bg-orange-50 border border-orange-200 rounded-[10px] text-gray-900 text-xl outline-none mb-2.5 box-border tracking-[4px] text-center uppercase" placeholder={t(isHi, 'LINK CODE', 'लिंक कोड')} value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={8} onKeyDown={e => e.key === 'Enter' && submit()} aria-label={t(isHi, 'Child link code', 'बच्चे का लिंक कोड')} />
        {error && <p className="text-red-500 text-[13px] my-2">{error}</p>}
        <button onClick={submit} disabled={loading} className={`w-full mt-2 px-5 py-3 bg-orange-500 text-white border-none rounded-[10px] text-[15px] font-semibold cursor-pointer ${loading ? 'opacity-50' : 'opacity-100'}`}>
          {loading ? t(isHi, 'Connecting...', 'कनेक्ट हो रहा है...') : t(isHi, 'View Dashboard', 'डैशबोर्ड देखें')}
        </button>
        <p className="text-xs text-gray-500 mt-4">
          {t(isHi, "Ask your child for the link code from their Alfanumrik profile.", 'अपने बच्चे से उनकी Alfanumrik प्रोफ़ाइल से लिंक कोड मांगें।')}
        </p>
        <p className="text-xs text-gray-400 mt-3">
          {t(isHi, 'Student or Teacher?', 'छात्र या शिक्षक?')}{' '}
          <a href="/login?switch=true" className="text-orange-500 font-medium hover:underline">
            {t(isHi, 'Login here \u2192', 'यहाँ लॉगिन करें \u2192')}
          </a>
        </p>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            window.location.href = '/login';
          }}
          className="text-xs text-gray-400 mt-2 hover:text-gray-600 underline bg-transparent border-none cursor-pointer"
        >
          {t(isHi, 'Sign out & switch account', 'साइन आउट करें और अकाउंट बदलें')}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// STAT CARD
// ============================================================
function Stat({ label, value, color, icon }: { label: string; value: string | number; color: string; icon: string }) {
  return (
    <div className="bg-white rounded-xl px-3.5 py-3 border border-orange-200">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-sm">{icon}</span>
        <span className="text-gray-500 text-[11px] uppercase tracking-[0.5px]">{label}</span>
      </div>
      <span className="text-[22px] font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

// ============================================================
// WEEKLY ACTIVITY CHART
// ============================================================
function WeeklyChart({ data }: { data: WeeklyDay[] }) {
  const maxQ = Math.max(...data.map(d => d.quizzes), 1);
  return (
    <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-3.5">
      <h3 className="text-[15px] font-semibold text-gray-900 mb-3">This week</h3>
      <div className="flex items-end gap-2 h-[100px] mt-3">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center">
            <div
              className={`rounded mb-1.5 transition-[height] duration-300 ${d.active ? 'bg-orange-500' : 'bg-orange-50'}`}
              style={{ height: Math.max(4, (d.quizzes / maxQ) * 80) }}
            />
            <span className={`text-[10px] ${d.active ? 'text-gray-900' : 'text-gray-500'}`}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// BKT MASTERY RING
// ============================================================
function MasteryRing({ levels, total }: { levels: Record<string, number>; total: number }) {
  if (total === 0) return <p className="text-gray-500 text-[13px] italic">No adaptive data yet.</p>;
  const data = [
    { label: 'Mastered', count: levels.mastered || 0, color: '#059669' },
    { label: 'Proficient', count: levels.proficient || 0, color: '#7C3AED' },
    { label: 'Familiar', count: levels.familiar || 0, color: '#2563EB' },
    { label: 'Attempted', count: levels.attempted || 0, color: '#D97706' },
  ].filter(d => d.count > 0);
  return (
    <div className="flex gap-3 flex-wrap">
      {data.map(d => (
        <div key={d.label} className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 rounded-lg" style={{ borderLeft: `3px solid ${d.color}` }}>
          <span className="text-lg font-bold" style={{ color: d.color }}>{d.count}</span>
          <span className="text-xs text-gray-500">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// MULTI-CHILD SELECTOR
// ============================================================
const avatarGradientsDash = [
  ['#F59E0B', '#D97706'],
  ['#EC4899', '#DB2777'],
  ['#8B5CF6', '#7C3AED'],
  ['#06B6D4', '#0891B2'],
  ['#F97316', '#EA580C'],
  ['#10B981', '#059669'],
];

function ChildSelectorPills({
  studentList,
  selectedIdx,
  onSelect,
}: {
  studentList: StudentSession[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}) {
  if (studentList.length <= 1) return null;
  return (
    <div style={{
      display: 'flex',
      gap: 8,
      overflowX: 'auto',
      paddingBottom: 4,
      marginBottom: 16,
      scrollbarWidth: 'none',
      WebkitOverflowScrolling: 'touch',
    } as React.CSSProperties}>
      <style>{`.child-pills::-webkit-scrollbar{display:none}`}</style>
      {studentList.map((child, idx) => {
        const selected = idx === selectedIdx;
        const [from, to] = avatarGradientsDash[child.name.charCodeAt(0) % avatarGradientsDash.length];
        return (
          <button
            key={child.id}
            onClick={() => onSelect(idx)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px 8px 8px',
              borderRadius: 24,
              border: selected ? 'none' : '1px solid #FDBA7444',
              backgroundColor: selected ? '#F97316' : '#FFFFFF',
              color: selected ? '#FFFFFF' : '#475569',
              fontSize: 13,
              fontWeight: selected ? 700 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              boxShadow: selected ? '0 2px 8px #F9731640' : 'none',
              transition: 'all 0.2s',
            }}
          >
            {/* Avatar circle */}
            <div style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${from}, ${to})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
            }}>
              {child.name.charAt(0).toUpperCase()}
            </div>
            {child.name.split(' ')[0]}
            {/* Grade badge */}
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              backgroundColor: selected ? 'rgba(255,255,255,0.25)' : '#FDBA7433',
              color: selected ? '#fff' : '#F97316',
              borderRadius: 8,
              padding: '1px 6px',
            }}>
              {t(false, 'G', 'क')}{child.grade}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// MAIN DASHBOARD
// ============================================================
/** Performance score row from the performance_scores table */
interface PerfScoreRow {
  subject: string;
  overall_score: number;
  level_name: string;
}

function Dashboard({ guardian, initialStudent, allChildren, isHi, canFetchMessages }: { guardian: ParentSession; initialStudent: StudentSession; allChildren: StudentSession[]; isHi: boolean; canFetchMessages: boolean }) {
  // Cosmic redesign switch. False unless ff_cosmic_redesign_v1 resolves ON.
  const { cosmicEnabled } = useCosmicTheme();
  // Parent glance home (Wave C). Read the flag via the shared SWR hook — the
  // same client flag-read pattern Wave A used for ff_today_home_v1. When the
  // flag is OFF (the default) glanceEnabled is false and the legacy render
  // path below is reached unchanged. `showClassic` lets the parent reveal the
  // existing 8-tab dashboard from the glance home so nothing is lost.
  const { data: flags } = useFeatureFlags();
  const glanceEnabled = flags?.[CONSUMER_MINIMALISM_FLAGS.PARENT_GLANCE_V1] === true;
  const [showClassic, setShowClassic] = useState(false);
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [tips, setTips] = useState<ParentTip[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTips, setShowTips] = useState(false);
  const [selectedChildIdx, setSelectedChildIdx] = useState(0);
  const [perfScores, setPerfScores] = useState<PerfScoreRow[]>([]);
  const [labStreak, setLabStreak] = useState<number | null>(null);

  // Derive current student from selectedChildIdx
  const children = allChildren.length > 0 ? allChildren : [initialStudent];
  const student = children[selectedChildIdx] ?? initialStudent;

  const load = useCallback(async () => {
    setLoading(true);
    const [d, tipRes] = await Promise.all([
      api('get_child_dashboard', { student_id: student.id, guardian_id: guardian.id }),
      api('get_tips'),
    ]);
    setDash(d); setTips(tipRes.tips || []);

    // Fetch Performance Scores for this child (RLS handles parent access via guardian_student_links)
    try {
      const { data: psData } = await supabase
        .from('performance_scores')
        .select('subject, overall_score, level_name')
        .eq('student_id', student.id);
      if (psData && psData.length > 0) {
        setPerfScores(psData.map((r: Record<string, unknown>) => ({
          subject: String(r.subject || ''),
          overall_score: Number(r.overall_score ?? 0),
          level_name: String(r.level_name || getLevelFromScore(Number(r.overall_score ?? 0))),
        })));
      } else {
        setPerfScores([]);
      }
    } catch {
      setPerfScores([]);
    }

    // Fetch STEM lab streak (RLS handles parent access via student_lab_streaks_guardian_select)
    try {
      const { data: streakRow } = await supabase
        .from('student_lab_streaks')
        .select('current_streak')
        .eq('student_id', student.id)
        .maybeSingle();
      setLabStreak(streakRow ? Number(streakRow.current_streak ?? 0) : 0);
    } catch {
      setLabStreak(null);
    }

    setLoading(false);
  }, [student.id, guardian.id]);

  useEffect(() => { load(); }, [load]);

  // Phase C.6 — realtime child-progress revalidation (default OFF via flag).
  // Subscribe to student_learning_profiles UPDATE filtered by the children
  // this parent is linked to. Debounced 5s — parents don't need sub-second
  // granularity, and after a child finishes a quiz several rows may update
  // in quick succession (one per subject). The 5s debounce coalesces them
  // into a single refetch.
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flags = await getFeatureFlags({ role: 'parent' });
        if (!cancelled) setRealtimeEnabled(Boolean(flags[REALTIME_FLAGS.SUBSCRIPTIONS_V1]));
      } catch {
        if (!cancelled) setRealtimeEnabled(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const childIdsKey = children.map((c) => c.id).filter(Boolean).join(',');
  useRealtimeRevalidator({
    enabled: realtimeEnabled && childIdsKey.length > 0,
    channel: `parent-children-${guardian.id}`,
    table: 'student_learning_profiles',
    event: 'UPDATE',
    filter: childIdsKey ? `student_id=in.(${childIdsKey})` : null,
    debounceMs: 5000,
    onChange: load,
  });

  // Bug fix (2026-04-29 IST timezone): refetch when the tab regains focus or
  // becomes visible. Without this, a parent who opens the dashboard once in
  // the morning and returns hours later sees stale "today" stats — the chart
  // still shows the previous IST day as the rightmost cell because no
  // re-fetch was triggered.
  useEffect(() => {
    const onFocus = () => { load(); };
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        load();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [load]);

  const logout = () => { clearParentSession(); window.location.reload(); };

  if (loading) return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-screen">
      <div className="text-center py-20 text-gray-500">
        <div className="w-10 h-10 border-[3px] border-orange-200 border-t-orange-500 rounded-full mx-auto mb-4 animate-spin" />
        {t(isHi, `Loading ${student.name}'s progress...`, `${student.name} की प्रगति लोड हो रही है...`)}
      </div>
    </div>
  );

  if (!dash || dash.error) return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-screen">
      <div className="text-center py-[60px] text-red-500">{dash?.error || t(isHi, 'Failed to load dashboard', 'डैशबोर्ड लोड करने में विफल')}</div>
    </div>
  );

  const s = dash.stats;
  const childName = dash.student?.name || student.name;

  const accuracyColor = (s.accuracy || 0) >= 70 ? 'border-emerald-600' : (s.accuracy || 0) >= 40 ? 'border-amber-600' : 'border-red-600';

  // Check if child has zero activity — show contextual empty state
  const hasNoActivity = (s.totalQuizzes || 0) === 0 && (s.xp || 0) === 0 && (s.totalChats || 0) === 0;

  // ════════════════════════════════════════════════════════════════════════
  // COSMIC BRANCH (ff_cosmic_redesign_v1 ON). Renders the reskinned parent
  // home wired to the SAME real data (dash.stats, dash.dailyActivity,
  // dash.weekSummary, dash.bktMastery, perfScores, labStreak) the legacy DOM
  // below uses. Display only. The parent role auto-gets the peach/mint palette
  // via html[data-role="parent"]. When the flag is OFF, cosmicEnabled is false
  // and we fall through to the byte-identical legacy markup.
  // ════════════════════════════════════════════════════════════════════════
  if (cosmicEnabled) {
    return (
      <div style={{ position: 'relative', minHeight: '100vh' }}>
        <Starfield />
        {/* Multi-child selector — preserved (renders nothing for single child). */}
        {children.length > 1 && (
          <div style={{ maxWidth: 600, margin: '0 auto', padding: '8px 16px 0' }}>
            <ChildSelectorPills
              studentList={children}
              selectedIdx={selectedChildIdx}
              onSelect={(idx) => {
                if (idx === selectedChildIdx) return;
                setLoading(true);
                setDash(null);
                setPerfScores([]);
                setLabStreak(null);
                setSelectedChildIdx(idx);
              }}
            />
          </div>
        )}
        <CosmicParentHome
          student={student}
          childName={childName}
          grade={dash.student?.grade || student.grade}
          isHi={isHi}
          stats={s}
          dailyActivity={dash.dailyActivity}
          weekSummary={dash.weekSummary}
          bktMastery={dash.bktMastery}
          perfScores={perfScores}
          labStreak={labStreak}
          canFetchMessages={canFetchMessages}
          onRefresh={load}
          onLogout={logout}
        />
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // GLANCE BRANCH (ff_parent_glance_v1 ON, cosmic OFF, classic not revealed).
  // Push-first one-scroll reorg of the SAME already-fetched data (dash.stats,
  // dash.dailyActivity, dash.weekSummary, dash.bktMastery, dash.insights,
  // perfScores, labStreak). Read-only — no refetch, no new endpoint, no POST.
  // The multi-child selector is preserved (same pattern as the cosmic branch).
  // "View classic dashboard" sets showClassic → falls through to the legacy
  // markup below, which stays byte-identical when the flag is OFF.
  // ════════════════════════════════════════════════════════════════════════
  if (glanceEnabled && !showClassic) {
    return (
      <div className="bg-[#FFF8F0] min-h-screen">
        {children.length > 1 && (
          <div className="max-w-[600px] mx-auto px-4 pt-2">
            <ChildSelectorPills
              studentList={children}
              selectedIdx={selectedChildIdx}
              onSelect={(idx) => {
                if (idx === selectedChildIdx) return;
                setLoading(true);
                setDash(null);
                setPerfScores([]);
                setLabStreak(null);
                setSelectedChildIdx(idx);
              }}
            />
          </div>
        )}
        <ParentGlanceHome
          stats={s}
          childName={childName}
          grade={dash.student?.grade || student.grade}
          subject={dash.subject}
          dailyActivity={dash.dailyActivity}
          weekSummary={dash.weekSummary}
          bktMastery={dash.bktMastery}
          insights={dash.insights}
          perfScores={perfScores}
          labStreak={labStreak}
          student={student}
          guardianId={guardian.id}
          canFetchReport={canFetchMessages}
          loading={loading}
          error={dash.error ?? null}
          onShowClassic={() => setShowClassic(true)}
          onRefresh={load}
          onLogout={logout}
          isHi={isHi}
          t={t}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-screen">
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div className="flex justify-between items-start mb-5 pb-4 border-b border-orange-200">

        <div>
          <p className="text-[11px] text-orange-500 font-semibold uppercase tracking-[1px] mb-1">{t(isHi, 'Parent Dashboard', 'अभिभावक डैशबोर्ड')}</p>
          <h1 className="text-[22px] font-bold text-gray-900 m-0">{childName}</h1>
          <p className="text-sm text-gray-500 mt-1 mb-0">{t(isHi, 'Grade', 'कक्षा')} {dash.student?.grade || student.grade} | {dash.subject || t(isHi, 'Science', 'विज्ञान')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="px-3 py-1.5 bg-transparent text-orange-500 border border-orange-200 rounded-md text-xs cursor-pointer">{t(isHi, 'Refresh', 'रिफ्रेश')}</button>
          <button onClick={logout} className="px-3 py-1.5 bg-transparent text-gray-500 border border-orange-200 rounded-md text-xs cursor-pointer">{t(isHi, 'Logout', 'लॉग आउट')}</button>
        </div>
      </div>

      {/* Multi-child selector — only renders when >1 child linked */}
      <ChildSelectorPills
        studentList={children}
        selectedIdx={selectedChildIdx}
        onSelect={(idx) => {
          // Bug fix (2026-04-29): switch to loading state immediately so the
          // "Failed to load dashboard" error UI does not flash between
          // setDash(null) and the next load() tick. Also clear stale
          // performance scores so the previously-selected child's subject
          // cards do not bleed into the new child's view.
          if (idx === selectedChildIdx) return;
          setLoading(true);
          setDash(null);
          setPerfScores([]);
          setLabStreak(null);
          setSelectedChildIdx(idx);
        }}
      />

      {/* Contextual empty state when child has no data yet */}
      {hasNoActivity && (
        <div className="bg-white rounded-[14px] px-[18px] py-6 border border-orange-200 mb-4 text-center">
          <div className="text-4xl mb-3">&#x1F331;</div>
          <h3 className="text-[16px] font-semibold text-gray-900 mb-2">
            {t(isHi, `${childName} hasn't started learning yet`, `${childName} ने अभी तक पढ़ाई शुरू नहीं की है`)}
          </h3>
          <p className="text-[13px] text-gray-500 mb-3 leading-relaxed max-w-[300px] mx-auto">
            {t(isHi,
              'Once they take their first quiz or chat with Foxy, you\'ll see their progress here in real-time.',
              'जब वे अपनी पहली क्विज़ देंगे या Foxy से चैट करेंगे, तो आप यहाँ उनकी प्रगति देख सकेंगे।'
            )}
          </p>
          <div className="flex flex-col gap-2 text-left max-w-[280px] mx-auto">
            <p className="text-[12px] text-gray-400 font-semibold uppercase tracking-wide">{t(isHi, 'How to get started:', 'शुरू कैसे करें:')}</p>
            <p className="text-[13px] text-gray-600">1. {t(isHi, 'Ask your child to open Alfanumrik', 'अपने बच्चे को Alfanumrik खोलने को कहें')}</p>
            <p className="text-[13px] text-gray-600">2. {t(isHi, 'They can take a quiz or ask Foxy a question', 'वे एक क्विज़ दे सकते हैं या Foxy से सवाल पूछ सकते हैं')}</p>
            <p className="text-[13px] text-gray-600">3. {t(isHi, 'Come back here to see their progress!', 'उनकी प्रगति देखने के लिए यहाँ वापस आएं!')}</p>
          </div>
        </div>
      )}

      {/* Plain-Language Summary — trust-building, no jargon */}
      {!hasNoActivity && (
        <div className={`bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-4 border-l-[3px] ${accuracyColor}`}>
          <p className="text-[15px] font-semibold text-gray-900 mb-1.5">
            {(s.accuracy || 0) >= 70
              ? t(isHi, `${childName} is doing well!`, `${childName} अच्छा प्रदर्शन कर रहा है!`)
              : (s.accuracy || 0) >= 40
              ? t(isHi, `${childName} is making progress, but needs practice.`, `${childName} प्रगति कर रहा है, लेकिन अभ्यास की जरूरत है।`)
              : t(isHi, `${childName} needs extra support right now.`, `${childName} को अभी अतिरिक्त सहायता की जरूरत है।`)}
          </p>
          <p className="text-[13px] text-gray-500 m-0 leading-relaxed">
            {(s.streak || 0) >= 3
              ? t(isHi, `Studying consistently for ${s.streak} days. `, `${s.streak} दिनों से लगातार पढ़ाई कर रहा है। `)
              : s.streak === 0
              ? t(isHi, 'Not active today. ', 'आज सक्रिय नहीं है। ')
              : t(isHi, `Started a ${s.streak}-day streak. `, `${s.streak}-दिन की स्ट्रीक शुरू की। `)}
            {(s.totalQuizzes || 0) > 0
              ? t(isHi, `Completed ${s.totalQuizzes} quizzes with ${s.accuracy || 0}% accuracy. `, `${s.totalQuizzes} क्विज़ ${s.accuracy || 0}% सटीकता के साथ पूरी की। `)
              : t(isHi, 'No quizzes taken yet. ', 'अभी तक कोई क्विज़ नहीं दी। ')}
            {(s.avgScore || 0) >= 80
              ? t(isHi, 'Scoring above 80% — great progress!', '80% से ऊपर स्कोर — बहुत अच्छी प्रगति!')
              : (s.avgScore || 0) >= 50
              ? t(isHi, `Average score is ${s.avgScore}% — room to improve.`, `औसत स्कोर ${s.avgScore}% — सुधार की गुंजाइश है।`)
              : (s.avgScore || 0) > 0
              ? t(isHi, `Average score is ${s.avgScore}% — consider encouraging more practice.`, `औसत स्कोर ${s.avgScore}% — अधिक अभ्यास के लिए प्रोत्साहित करें।`)
              : ''}
          </p>
        </div>
      )}

      {/* This Week's Highlights */}
      {dash.weekSummary && !hasNoActivity && (
        <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-[14px] px-[18px] py-4 border border-orange-200 mb-4">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-2.5">{t(isHi, "This Week's Highlights", 'इस सप्ताह की मुख्य बातें')}</h3>
          <div className="flex flex-col gap-2">
            {(dash.weekSummary.quizzes || 0) > 0 && (
              <div className="flex items-center gap-2 text-[13px] text-gray-600">
                <span className="text-emerald-600 font-bold text-sm">&#x2713;</span>
                {t(isHi,
                  `Completed ${dash.weekSummary.quizzes} quiz${dash.weekSummary.quizzes > 1 ? 'zes' : ''} this week`,
                  `इस सप्ताह ${dash.weekSummary.quizzes} क्विज़ पूरी की`
                )}
              </div>
            )}
            {(dash.weekSummary.avgScore || 0) > 0 && (
              <div className="flex items-center gap-2 text-[13px] text-gray-600">
                <span className={`font-bold text-sm ${(dash.weekSummary.avgScore || 0) >= 70 ? 'text-emerald-600' : 'text-amber-600'}`}>&#x2713;</span>
                {t(isHi,
                  `Weekly average score: ${dash.weekSummary.avgScore}%`,
                  `साप्ताहिक औसत स्कोर: ${dash.weekSummary.avgScore}%`
                )}
              </div>
            )}
            {(dash.weekSummary.activeDays || 0) > 0 && (
              <div className="flex items-center gap-2 text-[13px] text-gray-600">
                <span className="text-emerald-600 font-bold text-sm">&#x2713;</span>
                {t(isHi,
                  `Active for ${dash.weekSummary.activeDays} out of 7 days`,
                  `7 में से ${dash.weekSummary.activeDays} दिन सक्रिय`
                )}
              </div>
            )}
            {(s.totalChats || 0) > 0 && (
              <div className="flex items-center gap-2 text-[13px] text-gray-600">
                <span className="text-purple-600 font-bold text-sm">&#x2713;</span>
                {t(isHi,
                  `Used Foxy AI tutor ${s.totalChats} time${s.totalChats > 1 ? 's' : ''}`,
                  `Foxy AI ट्यूटर का ${s.totalChats} बार उपयोग किया`
                )}
              </div>
            )}
          </div>
          {(dash.weekSummary.quizzes || 0) === 0 && (dash.weekSummary.activeDays || 0) === 0 && (
            <p className="text-[13px] text-amber-600 mt-2">
              {t(isHi,
                `${childName} hasn't been active this week. A gentle reminder to practice can help!`,
                `${childName} इस सप्ताह सक्रिय नहीं रहा है। अभ्यास के लिए एक कोमल अनुस्मारक मदद कर सकता है!`
              )}
            </p>
          )}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        <Stat icon="&#x2B50;" label="XP" value={s.xp || 0} color="#F59E0B" />
        <Stat icon="&#x1F525;" label={t(isHi, 'Streak', 'स्ट्रीक')} value={`${s.streak || 0}d`} color="#EF4444" />
        <Stat icon="&#x1F3AF;" label={t(isHi, 'Accuracy', 'सटीकता')} value={`${s.accuracy || 0}%`} color="#059669" />
        <Stat icon="&#x1F4DA;" label={t(isHi, 'Quizzes', 'क्विज़')} value={s.totalQuizzes || 0} color="#6366F1" />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-2.5 mb-4">
        <Stat icon="&#x23F1;" label={t(isHi, 'Study time', 'अध्ययन समय')} value={`${s.minutes || 0}m`} color="#8B5CF6" />
        <Stat icon="&#x1F4AC;" label={t(isHi, 'Foxy chats', 'Foxy चैट')} value={s.totalChats || 0} color="#EC4899" />
        <Stat icon="&#x1F4CA;" label={t(isHi, 'Avg score', 'औसत स्कोर')} value={`${s.avgScore || 0}%`} color="#2563EB" />
      </div>

      {/* ── Performance Scores Section ── */}
      {perfScores.length > 0 && (
        <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-4">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-3">
            {t(isHi, 'Performance Scores', 'प्रदर्शन स्कोर')}
          </h3>
          <p className="text-[13px] text-gray-500 mb-3 leading-relaxed">
            {(() => {
              // Find the highest score subject for the summary line
              const sorted = [...perfScores].sort((a, b) => b.overall_score - a.overall_score);
              const top = sorted[0];
              const avg = Math.round(perfScores.reduce((sum, p) => sum + p.overall_score, 0) / perfScores.length);
              if (top) {
                return isHi
                  ? `अगर ${childName} आज ${top.subject} की परीक्षा दे, तो संभावित स्कोर लगभग ${top.overall_score}/100 होगा। कुल औसत: ${avg}/100`
                  : `If ${childName} took the ${top.subject} exam today, they'd likely score around ${top.overall_score}/100. Overall average: ${avg}/100`;
              }
              return '';
            })()}
          </p>
          <div className="grid grid-cols-1 gap-3">
            {perfScores.map((ps) => {
              // Map common subjects to Hindi names
              const subjectHiMap: Record<string, string> = {
                math: 'गणित', science: 'विज्ञान', english: 'अंग्रेज़ी',
                hindi: 'हिंदी', social: 'सामाजिक विज्ञान', evs: 'पर्यावरण',
                physics: 'भौतिकी', chemistry: 'रसायन', biology: 'जीवविज्ञान',
              };
              const subjectKey = ps.subject.toLowerCase();
              const subjectHi = subjectHiMap[subjectKey] || ps.subject;
              return (
                <ScoreCard
                  key={ps.subject}
                  subject={ps.subject}
                  subjectHi={subjectHi}
                  score={ps.overall_score}
                  isHi={isHi}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Weekly Activity */}
      {dash.dailyActivity && <WeeklyChart data={dash.dailyActivity} />}

      {/* Week Summary */}
      {dash.weekSummary && (
        <div className="bg-white rounded-[14px] px-5 py-3.5 border border-orange-200 mb-3.5 flex justify-around text-center">
          <div><span className="text-xl font-bold text-orange-500">{dash.weekSummary.quizzes}</span><br /><span className="text-[11px] text-gray-500">{t(isHi, 'quizzes this week', 'इस सप्ताह क्विज़')}</span></div>
          <div className="w-px bg-orange-200" />
          <div><span className="text-xl font-bold text-emerald-600">{dash.weekSummary.avgScore}%</span><br /><span className="text-[11px] text-gray-500">{t(isHi, 'avg score', 'औसत स्कोर')}</span></div>
          <div className="w-px bg-orange-200" />
          <div><span className="text-xl font-bold text-amber-600">{dash.weekSummary.activeDays}/7</span><br /><span className="text-[11px] text-gray-500">{t(isHi, 'active days', 'सक्रिय दिन')}</span></div>
        </div>
      )}

      {/* BKT Adaptive Mastery */}
      {dash.bktMastery && dash.bktMastery.total > 0 && (
        <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-3.5">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-3">{t(isHi, 'Learning Progress', 'सीखने की प्रगति')}</h3>
          <MasteryRing levels={dash.bktMastery.levels} total={dash.bktMastery.total} />
          <p className="text-xs text-gray-500 mt-2.5 mb-0">
            {t(isHi,
              `${dash.bktMastery.total} concepts being tracked across all subjects`,
              `सभी विषयों में ${dash.bktMastery.total} अवधारणाओं की ट्रैकिंग`
            )}
          </p>
        </div>
      )}

      {/* Active Bursts / Adventures */}
      {dash.activeBursts && dash.activeBursts.length > 0 && (
        <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-3.5">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-3">{t(isHi, 'Active learning adventures', 'सक्रिय शिक्षण अभियान')}</h3>
          {dash.activeBursts.map((b: ActiveBurst, i: number) => (
            <div key={i} className={`flex items-center gap-3 py-2 ${i < (dash.activeBursts?.length ?? 0) - 1 ? 'border-b border-orange-200' : ''}`}>
              <span className="text-xl">{b.type === 'boss_battle' ? '\u2694\uFE0F' : b.type === 'mystery_solve' ? '\uD83D\uDD0D' : '\uD83C\uDFF0'}</span>
              <div className="flex-1">
                <span className="text-[13px] font-semibold text-gray-900">{b.title}</span>
                <div className="flex gap-1 mt-1">
                  <div className="flex-1 h-1.5 bg-orange-50 rounded-sm overflow-hidden">
                    <div className="h-full bg-orange-500 rounded-sm" style={{ width: `${Math.round((b.progress / b.goal) * 100)}%` }} />
                  </div>
                  <span className="text-[11px] text-gray-500 min-w-[40px]">{b.progress}/{b.goal}</span>
                </div>
              </div>
              <span className="text-xs text-amber-500 font-semibold">+{b.xp} XP</span>
            </div>
          ))}
        </div>
      )}

      {/* Insights */}
      {dash.insights && dash.insights.length > 0 && (
        <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-3.5">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-3">{t(isHi, 'Insights for you', 'आपके लिए सुझाव')}</h3>
          {dash.insights.map((insight: string, i: number) => (
            <p key={i} className="text-[13px] text-gray-600 my-1.5 px-3 py-2 bg-orange-50 rounded-lg leading-relaxed">{insight}</p>
          ))}
        </div>
      )}

      {/* Tips toggle */}
      <button onClick={() => setShowTips(!showTips)} className="w-full px-4 py-2.5 bg-white text-orange-500 border border-orange-200 rounded-[10px] text-[13px] font-semibold cursor-pointer mb-3.5">
        {showTips ? t(isHi, 'Hide parenting tips', 'पेरेंटिंग टिप्स छुपाएं') : t(isHi, 'Show parenting tips', 'पेरेंटिंग टिप्स दिखाएं')}
      </button>
      {showTips && tips.length > 0 && (
        <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-3.5">
          {tips.map((tip: ParentTip) => (
            <div key={tip.id} className="py-2.5 border-b border-orange-200">
              <span className="text-sm font-semibold text-gray-900">{tip.title}</span>
              <p className="text-[13px] text-gray-500 mt-1 mb-0">{tip.description}</p>
            </div>
          ))}
        </div>
      )}

      {/* Quick nav links */}
      <div className="flex gap-3 mb-4 justify-center flex-wrap">
        <a href="/parent/children" className="flex items-center gap-1.5 px-4 py-2.5 bg-white text-orange-500 border border-orange-200 rounded-[10px] text-[13px] font-semibold no-underline">
          &#x1F467; {t(isHi, 'My Children', 'मेरे बच्चे')}
        </a>
        <a href="/parent/reports" className="flex items-center gap-1.5 px-4 py-2.5 bg-white text-orange-500 border border-orange-200 rounded-[10px] text-[13px] font-semibold no-underline">
          &#x1F4CA; {t(isHi, 'Reports', 'रिपोर्ट')}
        </a>
        <a
          href="/parent/reports#labs"
          className="flex items-center gap-1.5 min-h-[44px] px-4 py-2.5 bg-white text-orange-500 border border-orange-200 rounded-[10px] text-[13px] font-semibold no-underline"
          aria-label={t(isHi, 'View lab activity', 'लैब गतिविधि देखें')}
        >
          &#x1F52C; {t(isHi, 'Lab Activity', 'लैब गतिविधि')}
          {labStreak !== null && labStreak > 0 && (
            <span className="ml-1 inline-flex items-center gap-0.5 bg-amber-100 text-amber-700 text-[11px] font-bold px-1.5 py-0.5 rounded">
              &#x1F525;{labStreak}
            </span>
          )}
        </a>
        <a href="/parent/calendar" className="flex items-center gap-1.5 px-4 py-2.5 bg-white text-orange-500 border border-orange-200 rounded-[10px] text-[13px] font-semibold no-underline">
          &#x1F4C5; {t(isHi, 'Calendar', 'कैलेंडर')}
        </a>
      </div>

      <p className="text-center text-[11px] text-gray-500 my-5">
        Alfanumrik Learning OS | {t(isHi, 'Parent Portal', 'अभिभावक पोर्टल')} | {t(isHi, 'Logged in as', 'लॉग इन')} {guardian.name}
      </p>
    </div>
  );
}

// ============================================================
// MAIN PAGE COMPONENT
// ============================================================
export default function ParentPage() {
  const auth = useAuth();
  const [guardian, setGuardian] = useState<ParentSession | null>(null);
  const [student, setStudent] = useState<StudentSession | null>(null);
  const [allChildren, setAllChildren] = useState<StudentSession[]>([]);
  const [checking, setChecking] = useState(true);

  // D-authunify (ff_parent_unified_auth_v1, Wave D, Finding #5). When ON, the
  // Supabase guardian-JWT (auth.guardian) is the SINGLE source of truth for the
  // parent session — the HMAC sessionStorage cache (loadParentSession) is never
  // consulted. The real auth boundary is already server-side: the parent-portal
  // Edge Function requires a Bearer JWT on every action and /api/parent/report
  // uses authorizeRequest, so the HMAC payload was only ever a client cache.
  // When OFF (default), the existing dual path below is byte-identical.
  // Read via the same useFeatureFlags() SWR hook used for ff_parent_glance_v1.
  const { data: flags } = useFeatureFlags();
  const unifiedAuth = flags?.[CONSUMER_MINIMALISM_FLAGS.PARENT_UNIFIED_AUTH_V1] === true;

  // Fetch all children for this guardian so the multi-child selector works
  const fetchAllChildren = useCallback(async (guardianId: string, primaryStudent: StudentSession) => {
    try {
      const res = await api('get_children', { guardian_id: guardianId });
      if (res?.children && Array.isArray(res.children)) {
        const normalized: StudentSession[] = res.children.map((c: Record<string, unknown>) => ({
          id: String(c.id || ''),
          name: String(c.name || 'Child'),
          grade: String(c.grade || ''),
        }));
        setAllChildren(normalized.length > 0 ? normalized : [primaryStudent]);
      } else if (res?.students && Array.isArray(res.students)) {
        const normalized: StudentSession[] = res.students.map((c: Record<string, unknown>) => ({
          id: String(c.id || ''),
          name: String(c.name || 'Child'),
          grade: String(c.grade || ''),
        }));
        setAllChildren(normalized.length > 0 ? normalized : [primaryStudent]);
      } else {
        setAllChildren([primaryStudent]);
      }
    } catch {
      setAllChildren([primaryStudent]);
    }
  }, []);

  // D-authunify (flag ON only): resolve the parent session purely from the
  // guardian-JWT. The primary student is seeded from get_children (served by
  // the parent-portal Edge Function, which requires the Bearer JWT) instead of
  // the HMAC sessionStorage cache. No loadParentSession() call on this path.
  const resolveGuardianFromJwt = useCallback(async (g: ParentSession) => {
    try {
      const res = await api('get_children', { guardian_id: g.id });
      const raw = (res?.children ?? res?.students);
      const normalized: StudentSession[] = Array.isArray(raw)
        ? raw.map((c: Record<string, unknown>) => ({
            id: String(c.id || ''),
            name: String(c.name || 'Child'),
            grade: String(c.grade || ''),
          }))
        : [];
      setAllChildren(normalized);
      setStudent(normalized.length > 0 ? normalized[0] : null);
    } catch {
      setAllChildren([]);
      setStudent(null);
    }
  }, []);

  useEffect(() => {
    if (auth.isLoading) return;

    // ── D-authunify ON: guardian-JWT is the single source of truth ──────────
    // No HMAC sessionStorage fallback. If there's no auth.guardian, leave
    // guardian/student null so the normal LoginScreen (unauthenticated state)
    // renders — we never silently revive a stale HMAC cache.
    if (unifiedAuth) {
      if (auth.guardian) {
        setGuardian(auth.guardian);
        resolveGuardianFromJwt(auth.guardian).then(() => setChecking(false));
      } else {
        setGuardian(null);
        setStudent(null);
        setChecking(false);
      }
      return;
    }

    // ── Flag OFF (default): existing dual path, byte-identical to today ──────
    // First check if user is logged in via Supabase with guardian role
    if (auth.guardian) {
      setGuardian(auth.guardian);
      // Student data will be fetched by the dashboard API; load from verified session if available
      loadParentSession().then(session => {
        if (session) {
          setStudent(session.student);
          fetchAllChildren(auth.guardian!.id, session.student);
        }
        setChecking(false);
      });
      return;
    }

    // Fallback: check sessionStorage for link-code-based login (HMAC-verified, expiry-checked)
    loadParentSession().then(session => {
      if (session) {
        setGuardian(session.guardian);
        setStudent(session.student);
        fetchAllChildren(session.guardian.id, session.student);
      }
      setChecking(false);
    });
  }, [auth.isLoading, auth.guardian, fetchAllChildren, unifiedAuth, resolveGuardianFromJwt]);

  if (checking || auth.isLoading) return (
    <div className="max-w-[600px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-gray-900 bg-[#FFF8F0] min-h-screen">
      <div className="text-center py-20 text-gray-500">Loading...</div>
    </div>
  );

  const isHi = auth.isHi ?? false;

  if (!guardian || !student) {
    // If guardian profile exists from signup, pre-fill name
    const prefillName = auth.guardian?.name || '';
    return <LoginScreen onLogin={(g, s) => { setGuardian(g); setStudent(s); fetchAllChildren(g.id, s); }} isHi={isHi} authUserId={auth.authUserId} prefillName={prefillName || undefined} />;
  }

  // canFetchMessages: only guardian-mode parents (a real Supabase JWT) can hit
  // /api/parent/messages. Link-code parents have an anonymous HMAC session and
  // would 401 — the cosmic teacher-note card is gated off for them.
  const canFetchMessages = !!auth.guardian;
  return (
    <AtlasParentDispatcher
      guardian={guardian}
      student={student}
      allChildren={allChildren}
      isHi={isHi}
      canFetchMessages={canFetchMessages}
    />
  );
}

/**
 * Reads the cosmic + Editorial Atlas flags and hands off to the right home.
 *
 * Dispatch priority:
 *   1. ff_cosmic_redesign_v1 ON  → <Dashboard> (it owns the data fetch + the
 *      internal cosmic branch). Cosmic outranks Atlas so the CEO-approved
 *      cosmic skin always wins when enabled.
 *   2. Editorial Atlas ON        → <AtlasParent>
 *   3. otherwise (both OFF)      → <Dashboard> legacy DOM (byte-identical today)
 *
 * Uses the shared `useAtlasFlag` hook so the Atlas decision is synchronous (no
 * flash). The cosmic flag is read inside <Dashboard> via useCosmicTheme(),
 * which is sync-from-cache on repeat visits (mirrors the student dashboard).
 */
function AtlasParentDispatcher(props: {
  guardian: ParentSession;
  student: StudentSession;
  allChildren: StudentSession[];
  isHi: boolean;
  canFetchMessages: boolean;
}) {
  const { cosmicEnabled } = useCosmicTheme();
  const atlas = useAtlasFlag('parent');
  // Cosmic wins over Atlas. Route through <Dashboard> (which fetches the data
  // the cosmic home needs and renders the cosmic branch when enabled).
  if (!cosmicEnabled && atlas) return <AtlasParent guardian={props.guardian} student={props.student} allChildren={props.allChildren} isHi={props.isHi} />;
  return (
    <Dashboard
      guardian={props.guardian}
      initialStudent={props.student}
      allChildren={props.allChildren}
      isHi={props.isHi}
      canFetchMessages={props.canFetchMessages}
    />
  );
}
