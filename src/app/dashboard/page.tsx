'use client';

/**
 * Student Dashboard — Wave 2 launch-readiness rewrite (2026-05-05).
 *
 * Above-the-fold (visible without scroll, mobile 360x700):
 *   1. Header: greeting + name + plan badge + stream chip + lang/notif/avatar
 *   2. Primary CTA — "Start Today's Quiz" (purple gradient button)
 *   3. Streak chip — flame + day count
 *   4. Today's XP strip — XPDailyStatus (200 cap visible)
 *   5. Continue learning card — last BKT topic OR zero-state subject hint
 *
 * Below-the-fold — five collapsed <details> accordions, lazy-loaded:
 *   - Your progress      (perf scores, Bloom, mastery, gaps, error analysis)
 *   - Today's focus      (focus zone, getting started, daily challenge, nudges)
 *   - Upcoming           (board countdown, exam list, pending parent links)
 *   - Compete            (leaderboard, weekly challenge)
 *   - Quick actions      (shortcuts grid + scan/profile/billing)
 *
 * Heavy sections use next/dynamic with ssr:false so the icon, BKT, and exam
 * date math don't inflate first paint.
 *
 * P7 (bilingual): every visible string branches on `isHi`.
 * P10 (bundle): collapsed sections are dynamic imports.
 * P14 (review chain): assessment owns scoring/XP shown inside ProgressSection.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/AuthContext';
import {
  supabase,
  getFeatureFlags,
  getNextTopics,
  generateNotifications,
} from '@/lib/supabase';
import { useDashboardData } from '@/lib/swr';
import { Avatar, BottomNav } from '@/components/ui';
import TrustFooter from '@/components/TrustFooter';
import { DashboardSkeleton } from '@/components/Skeleton';
import { calculateLevel } from '@/lib/xp-config';
import { getLevelFromScore } from '@/lib/score-config';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import type { StudentLearningProfile, CurriculumTopic } from '@/lib/types';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import { ReselectBanner } from '@/components/subjects/ReselectBanner';
import { PlanBadge } from '@/components/PlanBadge';
import CoinBalance from '@/components/coins/CoinBalance';
import AboveFoldHero from '@/components/dashboard/sections/AboveFoldHero';
import type { PendingLink } from '@/components/dashboard/PendingLinkApproval';

// ─── Lazy-loaded below-fold sections ─────────────────────────────────────
// Each section keeps its widgets out of the first-paint bundle. Loading
// fallback is a thin skeleton — accordion is closed by default anyway.
const SectionFallback = () => (
  <div
    className="h-24 rounded-2xl animate-pulse"
    style={{ background: 'var(--surface-2)' }}
    aria-hidden="true"
  />
);

const ProgressSection = dynamic(
  () => import('@/components/dashboard/sections/ProgressSection'),
  { ssr: false, loading: () => <SectionFallback /> },
);
const TodaysFocusSection = dynamic(
  () => import('@/components/dashboard/sections/TodaysFocusSection'),
  { ssr: false, loading: () => <SectionFallback /> },
);
const UpcomingSection = dynamic(
  () => import('@/components/dashboard/sections/UpcomingSection'),
  { ssr: false, loading: () => <SectionFallback /> },
);
const CompeteSection = dynamic(
  () => import('@/components/dashboard/sections/CompeteSection'),
  { ssr: false, loading: () => <SectionFallback /> },
);
const QuickActionsSection = dynamic(
  () => import('@/components/dashboard/sections/QuickActionsSection'),
  { ssr: false, loading: () => <SectionFallback /> },
);

// Pedagogy v2 — Wave 1B. Component renders nothing when /api/rhythm/today
// returns 404 (flag off / no profile), so dashboard is unchanged for
// non-flagged users. ssr:false keeps the bundle out of first paint.
const DailyRhythmQueue = dynamic(
  () => import('@/components/dashboard/sections/DailyRhythmQueue'),
  { ssr: false, loading: () => <SectionFallback /> },
);

// ─── Stream picker config (grades 11-12) ─────────────────────────────────
const STREAM_OPTIONS = [
  { key: 'science' as const, icon: '⚗️', label: 'Science', labelHi: 'विज्ञान', desc: 'Physics · Chemistry · Biology · Math', color: '#2563EB' },
  { key: 'commerce' as const, icon: '📊', label: 'Commerce', labelHi: 'वाणिज्य', desc: 'Accountancy · Economics · Business', color: '#D97706' },
  { key: 'humanities' as const, icon: '🌍', label: 'Humanities', labelHi: 'मानविकी', desc: 'History · Geography · Political Science', color: '#7C3AED' },
];

// ─── Accordion primitive ─────────────────────────────────────────────────
function Accordion({
  id,
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  id: string;
  title: string;
  icon: string;
  children: React.ReactNode;
  /** Render the accordion expanded on first paint. Use sparingly — collapsed
   *  state is the perf-friendly default (sections inside use next/dynamic). */
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-2xl group"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      data-testid={`dashboard-accordion-${id}`}
    >
      <summary
        className="cursor-pointer list-none flex items-center justify-between px-4 py-3.5 rounded-2xl select-none"
        style={{ minHeight: 56 }}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg" aria-hidden="true">{icon}</span>
          <span
            className="text-sm font-bold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
          >
            {title}
          </span>
        </div>
        <span
          className="text-[var(--text-3)] text-base transition-transform group-open:rotate-180"
          aria-hidden="true"
        >
          ▾
        </span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

export default function Dashboard() {
  const {
    student,
    snapshot,
    isLoggedIn,
    isLoading,
    isHi,
    language,
    setLanguage,
    theme,
    toggleTheme,
    refreshSnapshot,
    activeRole,
  } = useAuth();
  const router = useRouter();
  const { unlocked: allowedSubjects } = useAllowedSubjects();

  // ─── Local state ───────────────────────────────────────────────────────
  const [profiles, setProfiles] = useState<StudentLearningProfile[]>([]);
  const [nextTopics, setNextTopics] = useState<CurriculumTopic[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [greeting, setGreeting] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [showSubjectPicker, setShowSubjectPicker] = useState(false);
  const [knowledgeGaps, setKnowledgeGaps] = useState<
    Array<{ id: string; topic_title?: string; severity: string; description: string; description_hi?: string }>
  >([]);
  const [velocityTrend, setVelocityTrend] = useState<'fast' | 'steady' | 'slow' | null>(null);
  const [errorBreakdown, setErrorBreakdown] = useState<{
    careless: number;
    conceptual: number;
    misinterpretation: number;
  } | null>(null);
  const [retentionScore, setRetentionScore] = useState<number | null>(null);
  const [cbseReadiness, setCbseReadiness] = useState<number | null>(null);
  const [upcomingExams, setUpcomingExams] = useState<
    Array<{ id: string; exam_name: string; exam_type: string; subject: string; exam_date: string; days_left: number }>
  >([]);
  const [nudges, setNudges] = useState<
    Array<{ id: string; nudge_type: string; message: string; message_hi?: string; priority: number }>
  >([]);
  const [studentRank, setStudentRank] = useState<number | null>(null);
  // BKT mastery: average mastery_probability per subject from concept_mastery.
  const [bktMastery, setBktMastery] = useState<Record<string, number>>({});
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  // Performance Score system state
  const [perfScores, setPerfScores] = useState<
    Array<{ subject: string; overall_score: number; level_name: string }>
  >([]);
  const [coinBalance, setCoinBalance] = useState<number>(0);
  // Daily challenge (Concept Chain) state
  const [challengeUnlocked, setChallengeUnlocked] = useState(false);
  const [challengeStreak, setChallengeStreak] = useState(0);
  const [challengeSolved, setChallengeSolved] = useState(false);
  const [todaySubject, setTodaySubject] = useState<string | undefined>();
  const [todaySubjectHi, setTodaySubjectHi] = useState<string | undefined>();
  const [todayTopic, setTodayTopic] = useState<string | undefined>();
  const [challengeBadges, setChallengeBadges] = useState<string[]>([]);
  // Stream selector — grades 11-12 only
  const [selectedStream, setSelectedStream] = useState<'science' | 'commerce' | 'humanities' | null>(null);
  const [showStreamPicker, setShowStreamPicker] = useState(false);

  // ─── Auth + role-aware redirects ───────────────────────────────────────
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
    if (!isLoading && isLoggedIn && activeRole === 'teacher') router.replace('/teacher');
    if (!isLoading && isLoggedIn && activeRole === 'guardian') router.replace('/parent');
    if (
      !isLoading &&
      isLoggedIn &&
      activeRole === 'student' &&
      student &&
      !student.onboarding_completed
    ) {
      router.replace('/onboarding');
    }
  }, [isLoading, isLoggedIn, activeRole, student, router]);

  // Greeting (time-of-day, bilingual)
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(
      isHi
        ? h < 12
          ? 'शुभ प्रभात'
          : h < 17
            ? 'नमस्ते'
            : 'शुभ संध्या'
        : h < 12
          ? 'Good morning'
          : h < 17
            ? 'Hello'
            : 'Good evening',
    );
  }, [isHi]);

  // SWR: dashboard RPC payload
  const { data: dashData } = useDashboardData(student?.id);

  // Static one-shot data (BKT, perf scores, coins, feature flags, next topics)
  const loadStaticData = useCallback(async () => {
    if (!student) return;
    const [feats, nextTopicsResult] = await Promise.all([
      getFeatureFlags(),
      getNextTopics(student.id, student.preferred_subject, student.grade),
    ]);
    setFlags(feats);
    setNextTopics(nextTopicsResult.slice(0, 3));

    // BKT mastery per subject
    try {
      const { data: cmData } = await supabase
        .from('concept_mastery')
        .select('mastery_probability, curriculum_topics!inner(subject_id, subjects!inner(code))')
        .eq('student_id', student.id)
        .gt('mastery_probability', 0);
      if (cmData && cmData.length > 0) {
        const bySubject: Record<string, number[]> = {};
        for (const row of cmData as any[]) {
          const code = row.curriculum_topics?.subjects?.code as string | undefined;
          if (code && row.mastery_probability != null) {
            (bySubject[code] = bySubject[code] || []).push(row.mastery_probability as number);
          }
        }
        const avgMastery: Record<string, number> = {};
        for (const [code, vals] of Object.entries(bySubject)) {
          avgMastery[code] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100);
        }
        setBktMastery(avgMastery);
      }
    } catch {
      /* non-fatal */
    }

    // Performance Scores
    try {
      const { data: psData } = await supabase
        .from('performance_scores')
        .select('subject, overall_score, level_name')
        .eq('student_id', student.id);
      if (psData && psData.length > 0) {
        setPerfScores(
          psData.map((row: any) => ({
            subject: row.subject as string,
            overall_score: Number(row.overall_score) || 0,
            level_name: (row.level_name as string) || 'Curious Cub',
          })),
        );
      }
    } catch {
      /* non-fatal */
    }

    // Foxy Coin balance
    try {
      const { data: cbData } = await supabase
        .from('coin_balances')
        .select('balance')
        .eq('student_id', student.id)
        .single();
      if (cbData) setCoinBalance(Number(cbData.balance) || 0);
    } catch {
      /* non-fatal */
    }

    const rawSelected = (student.selected_subjects || [student.preferred_subject].filter(Boolean)) as string[];
    setSelectedSubjects(rawSelected);
    generateNotifications(student.id).catch((err: unknown) => {
      console.warn(
        '[dashboard] notification generation failed:',
        err instanceof Error ? err.message : String(err),
      );
    });
  }, [student]);

  // Narrow selectedSubjects to only those allowed (drops legacy codes)
  useEffect(() => {
    if (allowedSubjects.length === 0) return;
    const allowedCodes = new Set(allowedSubjects.map((s) => s.code));
    setSelectedSubjects((prev) => {
      const next = prev.filter((code) => allowedCodes.has(code));
      return next.length === prev.length ? prev : next;
    });
  }, [allowedSubjects]);

  // Process dashboard RPC data
  useEffect(() => {
    if (!dashData) return;
    const d = dashData;
    setProfiles(d.profiles ?? []);
    setDueCount(d.due_count ?? 0);
    setUnreadCount(d.unread_count ?? 0);
    const gaps = d.knowledge_gaps ?? [];
    setKnowledgeGaps(
      gaps.map((g: any) => ({
        id: g.id,
        topic_title: g.target_concept_name,
        severity: (g.confidence_score ?? 0) > 0.7 ? 'critical' : 'moderate',
        description: `Missing prerequisite: ${g.missing_prerequisite_name}`,
        description_hi: `पूर्व ज्ञान की कमी: ${g.missing_prerequisite_name}`,
      })),
    );
    if (d.velocity != null) {
      const v = Number(d.velocity);
      setVelocityTrend(v > 0.05 ? 'fast' : v > 0.02 ? 'steady' : 'slow');
    }
    if (d.cbse_readiness != null) setCbseReadiness(Math.round(d.cbse_readiness));
    const today = new Date();
    setUpcomingExams(
      (d.exams ?? []).map((e: any) => ({
        ...e,
        days_left: Math.max(
          0,
          Math.ceil((new Date(e.exam_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
        ),
      })),
    );
    setNudges(d.nudges ?? []);
    if (d.retention_score != null) setRetentionScore(Math.round(d.retention_score));
    if (d.leaderboard_rank != null) setStudentRank(d.leaderboard_rank);
    if (d.error_breakdown)
      setErrorBreakdown({
        careless: d.error_breakdown.careless ?? 0,
        conceptual: d.error_breakdown.conceptual ?? 0,
        misinterpretation: d.error_breakdown.misinterpretation ?? 0,
      });
  }, [dashData]);

  useEffect(() => {
    if (student) {
      loadStaticData();
      refreshSnapshot();
    }
  }, [student?.id, loadStaticData, refreshSnapshot]);

  // Pending parent-link approvals
  const fetchPendingLinks = useCallback(async () => {
    if (!student) return;
    try {
      const { data } = await supabase
        .from('guardian_student_links')
        .select('id, created_at, guardians:guardian_id(name)')
        .eq('student_id', student.id)
        .eq('status', 'pending');
      if (data && data.length > 0) {
        const normalized: PendingLink[] = data.map((row: any) => ({
          id: row.id,
          parentName: row.guardians?.name || 'Parent',
          requestedAt: row.created_at || new Date().toISOString(),
        }));
        setPendingLinks(normalized);
      } else {
        setPendingLinks([]);
      }
    } catch {
      /* non-fatal */
    }
  }, [student]);

  useEffect(() => {
    if (student) fetchPendingLinks();
  }, [student?.id, fetchPendingLinks]);

  // Daily challenge (Concept Chain) state
  useEffect(() => {
    if (!student) return;
    let cancelled = false;

    (async () => {
      try {
        const now = new Date();
        const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
        const today = ist.toISOString().slice(0, 10);

        const [challengeRes, streakRes, attemptRes] = await Promise.all([
          supabase
            .from('daily_challenges')
            .select('subject, subject_hi, topic')
            .eq('grade', student.grade)
            .eq('challenge_date', today)
            .in('status', ['approved', 'live', 'auto_generated'])
            .limit(1)
            .maybeSingle(),
          supabase
            .from('challenge_streaks')
            .select('current_streak, badges')
            .eq('student_id', student.id)
            .limit(1)
            .maybeSingle(),
          supabase
            .from('challenge_attempts')
            .select('solved')
            .eq('student_id', student.id)
            .eq('challenge_date', today)
            .limit(1)
            .maybeSingle(),
        ]);

        if (cancelled) return;

        if (challengeRes.data) {
          setTodaySubject(challengeRes.data.subject ?? undefined);
          setTodaySubjectHi(challengeRes.data.subject_hi ?? undefined);
          setTodayTopic(challengeRes.data.topic ?? undefined);
        }
        if (streakRes.data) {
          setChallengeStreak(streakRes.data.current_streak ?? 0);
          setChallengeBadges(streakRes.data.badges ?? []);
        }
        if (attemptRes.data && attemptRes.data.solved) {
          setChallengeSolved(true);
          setChallengeUnlocked(true);
          return;
        }

        const todayStart = `${today}T00:00:00+05:30`;
        const { data: quizToday } = await supabase
          .from('quiz_sessions')
          .select('id')
          .eq('student_id', student.id)
          .gte('created_at', todayStart)
          .eq('status', 'completed')
          .gte('total_questions', 5)
          .limit(1);

        if (cancelled) return;

        if (quizToday && quizToday.length > 0) {
          setChallengeUnlocked(true);
        } else if (student.created_at) {
          const createdDate = new Date(student.created_at);
          const daysSince = Math.floor(
            (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24),
          );
          if (daysSince <= 3) setChallengeUnlocked(true);
        }
      } catch {
        /* non-fatal */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [student?.id, student?.grade, student?.created_at]);

  // Stream selector for grades 11-12 (localStorage)
  useEffect(() => {
    if (!student) return;
    const g = student.grade;
    if (g !== '11' && g !== '12') return;
    const stored = localStorage.getItem('alfanumrik_stream');
    if (stored === 'science' || stored === 'commerce' || stored === 'humanities') {
      setSelectedStream(stored);
    } else {
      setShowStreamPicker(true);
    }
  }, [student?.grade, student?.id]);

  // ─── Loading & guard ───────────────────────────────────────────────────
  if (isLoading) return <DashboardSkeleton />;
  if (!student) {
    if (activeRole === 'teacher' || activeRole === 'guardian') return <DashboardSkeleton />;
    router.replace('/login');
    return <DashboardSkeleton />;
  }

  // ─── Derived metrics ───────────────────────────────────────────────────
  const totalXp = snapshot?.total_xp ?? profiles.reduce((a, p) => a + (p.xp ?? 0), 0);
  const streak = snapshot?.current_streak ?? Math.max(...profiles.map((p) => p.streak_days ?? 0), 0);
  const mastered = snapshot?.topics_mastered ?? 0;
  const overallPerfScore =
    perfScores.length > 0
      ? Math.round(perfScores.reduce((sum, ps) => sum + ps.overall_score, 0) / perfScores.length)
      : 0;
  const overallPerfLevel = getLevelFromScore(overallPerfScore);
  const dismissNudge = async (nudgeId: string) => {
    await fetch('/api/student/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss_nudge', nudge_id: nudgeId }),
    });
    setNudges((prev) => prev.filter((n) => n.id !== nudgeId));
  };

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* Stream Picker Modal — grades 11-12 first visit */}
      {showStreamPicker && (student.grade === '11' || student.grade === '12') && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
        >
          <div
            className="w-full max-w-sm rounded-3xl p-6 shadow-2xl"
            style={{ background: 'var(--warm-cream, #FFF9F0)', border: '1px solid var(--border)' }}
          >
            <div className="text-center mb-5">
              <div className="text-4xl mb-2" aria-hidden="true">🎓</div>
              <h2 className="font-bold text-xl" style={{ color: 'var(--text-1)' }}>
                {isHi ? 'अपनी स्ट्रीम चुनें' : 'Choose Your Stream'}
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
                {isHi ? `कक्षा ${student.grade} · CBSE` : `Class ${student.grade} · CBSE`}
              </p>
            </div>
            <div className="space-y-3">
              {STREAM_OPTIONS.map((st) => (
                <button
                  key={st.key}
                  onClick={() => {
                    setSelectedStream(st.key);
                    localStorage.setItem('alfanumrik_stream', st.key);
                    setShowStreamPicker(false);
                  }}
                  className="w-full flex items-center gap-4 p-4 rounded-2xl text-left transition-all hover:scale-[1.01]"
                  style={{ background: 'var(--surface-1)', border: `2px solid ${st.color}30` }}
                >
                  <span className="text-3xl" aria-hidden="true">{st.icon}</span>
                  <div>
                    <p className="font-bold text-base" style={{ color: st.color }}>
                      {isHi ? st.labelHi : st.label}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                      {st.desc}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Header — name, plan, lang toggle, notifications, avatar */}
      <header className="page-header">
        <div className="page-header-inner flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--text-3)]">{greeting},</p>
            <div className="flex items-center gap-2 flex-wrap">
              <h1
                className="text-lg md:text-xl font-bold"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {student.name} 👋
              </h1>
              <PlanBadge planCode={student.subscription_plan} size="sm" />
              {(student.grade === '11' || student.grade === '12') && selectedStream && (
                <button
                  onClick={() => setShowStreamPicker(true)}
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    background:
                      selectedStream === 'science'
                        ? '#2563EB15'
                        : selectedStream === 'commerce'
                          ? '#D9770615'
                          : '#7C3AED15',
                    color:
                      selectedStream === 'science'
                        ? '#2563EB'
                        : selectedStream === 'commerce'
                          ? '#D97706'
                          : '#7C3AED',
                    border: `1px solid ${
                      selectedStream === 'science'
                        ? '#2563EB30'
                        : selectedStream === 'commerce'
                          ? '#D9770630'
                          : '#7C3AED30'
                    }`,
                  }}
                >
                  {selectedStream === 'science' ? '⚗️' : selectedStream === 'commerce' ? '📊' : '🌍'}{' '}
                  {isHi
                    ? selectedStream === 'science'
                      ? 'विज्ञान'
                      : selectedStream === 'commerce'
                        ? 'वाणिज्य'
                        : 'मानविकी'
                    : selectedStream === 'science'
                      ? 'Science'
                      : selectedStream === 'commerce'
                        ? 'Commerce'
                        : 'Humanities'}
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CoinBalance balance={coinBalance} isHi={isHi} />
            <button
              onClick={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
              className="text-xs px-3 py-1.5 rounded-xl border transition-colors"
              style={{ borderColor: 'var(--border-mid)', color: 'var(--text-3)' }}
            >
              {language === 'hi' ? '🌐 EN' : '🇮🇳 हिं'}
            </button>
            {/* Theme toggle removed 2026-05-11 — product is light-only.
                See src/lib/AuthContext.tsx::resolveTheme. toggleTheme/theme
                are still imported above (no-op + always 'light') so the
                hook destructure doesn't break callers; remove on the
                follow-up sweep that strips `dark:` Tailwind variants. */}
            <button
              onClick={() => router.push('/notifications')}
              className="relative p-1.5"
              aria-label={isHi ? 'सूचनाएँ' : 'Notifications'}
            >
              <span className="text-lg" aria-hidden="true">🔔</span>
              {unreadCount > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: 'var(--danger)', fontSize: 10, lineHeight: 1 }}
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => router.push('/profile')}
              aria-label={isHi ? 'प्रोफ़ाइल' : 'Profile'}
            >
              <Avatar name={student.name} />
            </button>
          </div>
        </div>
      </header>

      <main className="app-container py-4 space-y-4">
        <SectionErrorBoundary section="Dashboard">
          {/* Pedagogy v2 — Wave 1B daily rhythm.
              Renders nothing when ff_pedagogy_v2_daily_rhythm is off,
              so the legacy AboveFoldHero remains the visual top of feed
              for non-flagged users. */}
          <SectionErrorBoundary section="Dashboard:DailyRhythm">
            <DailyRhythmQueue />
          </SectionErrorBoundary>

          {/* ════════════════════════════════════════════════════════════
              ABOVE THE FOLD — exactly 5 widgets (header counts as #1):
                1. Header (name + plan + lang/notif/avatar) — above
                2. Primary CTA "Start Today's Quiz"           ┐
                3. Streak chip                                ├─ AboveFoldHero
                4. XPDailyStatus (today's XP cap)             │
                5. Continue learning card                     ┘
              ════════════════════════════════════════════════════════════ */}
          <AboveFoldHero
            student={student}
            streak={streak}
            isHi={isHi}
            nextTopics={nextTopics}
            allowedSubjects={allowedSubjects}
            selectedSubjects={selectedSubjects}
            onPickSubjects={() => setShowSubjectPicker(true)}
          />

          {/* Reselect banner — only when student has zero unlocked or zero
              selected subjects. This is a recovery affordance, not a widget. */}
          {(allowedSubjects.length === 0 || selectedSubjects.length === 0) && (
            <ReselectBanner isHi={isHi} onReselect={() => setShowSubjectPicker(true)} />
          )}

          {/* ════════════════════════════════════════════════════════════
              BELOW THE FOLD — 5 collapsed accordions, lazy-loaded.
              Order: Progress → Today's Focus → Upcoming → Compete → Quick.
              ════════════════════════════════════════════════════════════ */}
          <SectionErrorBoundary section="Dashboard:Progress">
            <Accordion
              id="progress"
              icon="📈"
              title={isHi ? 'मेरी प्रगति' : 'Your Progress'}
            >
              <ProgressSection
                isHi={isHi}
                router={router}
                profiles={profiles}
                allowedSubjects={allowedSubjects}
                selectedSubjects={selectedSubjects}
                bktMastery={bktMastery}
                perfScores={perfScores}
                overallPerfScore={overallPerfScore}
                overallPerfLevel={overallPerfLevel}
                velocityTrend={velocityTrend}
                cbseReadiness={cbseReadiness}
                retentionScore={retentionScore}
                mastered={mastered}
                dueCount={dueCount}
                quizzesTaken={snapshot?.quizzes_taken ?? 0}
                knowledgeGaps={knowledgeGaps}
                errorBreakdown={errorBreakdown}
              />
            </Accordion>
          </SectionErrorBoundary>

          <SectionErrorBoundary section="Dashboard:Focus">
            <Accordion
              id="focus"
              icon="🎯"
              title={isHi ? 'आज का फोकस' : "Today's Focus"}
            >
              <TodaysFocusSection
                isHi={isHi}
                router={router}
                studentId={student.id}
                studentName={student.name}
                studentGrade={student.grade || '9'}
                preferredSubject={student.preferred_subject}
                totalXp={totalXp}
                level={calculateLevel(totalXp)}
                streak={streak}
                snapshot={snapshot}
                profilesLength={profiles.length}
                challengeUnlocked={challengeUnlocked}
                challengeStreak={challengeStreak}
                challengeSolved={challengeSolved}
                todaySubject={todaySubject}
                todaySubjectHi={todaySubjectHi}
                todayTopic={todayTopic}
                dueCount={dueCount}
                spacedRepetitionEnabled={!!flags.spaced_repetition}
                nudges={nudges}
                onDismissNudge={dismissNudge}
                knowledgeGaps={knowledgeGaps}
                nextTopics={nextTopics}
              />
            </Accordion>
          </SectionErrorBoundary>

          <SectionErrorBoundary section="Dashboard:Upcoming">
            <Accordion
              id="upcoming"
              icon="📅"
              title={isHi ? 'आगामी' : 'Upcoming'}
            >
              <UpcomingSection
                isHi={isHi}
                router={router}
                studentGrade={student.grade || ''}
                cbseReadiness={cbseReadiness}
                upcomingExams={upcomingExams}
                allowedSubjects={allowedSubjects}
                pendingLinks={pendingLinks}
                onLinkApproved={fetchPendingLinks}
              />
            </Accordion>
          </SectionErrorBoundary>

          <SectionErrorBoundary section="Dashboard:Compete">
            <Accordion
              id="compete"
              icon="🏆"
              title={isHi ? 'मुकाबला' : 'Compete'}
            >
              <CompeteSection
                isHi={isHi}
                router={router}
                studentRank={studentRank}
                totalXp={totalXp}
                challengeStreak={challengeStreak}
                challengeBadges={challengeBadges}
              />
            </Accordion>
          </SectionErrorBoundary>

          <SectionErrorBoundary section="Dashboard:QuickActions">
            {/* Default-open: shortcuts are core navigation — keeping them
                behind a collapsed accordion made them effectively invisible.
                Audit 2026-05-11 §0 F4. */}
            <Accordion
              id="quick"
              icon="⚡"
              title={isHi ? 'त्वरित क्रियाएँ' : 'Quick Actions'}
              defaultOpen
            >
              <QuickActionsSection isHi={isHi} router={router} />
            </Accordion>
          </SectionErrorBoundary>
        </SectionErrorBoundary>

        {/* Subject Picker Modal — bottom sheet, opens from AboveFoldHero
            zero-state hint or the ReselectBanner. */}
        {showSubjectPicker && (
          <>
            <div
              className="fixed inset-0 z-50"
              style={{ background: 'rgba(0,0,0,0.3)' }}
              onClick={() => setShowSubjectPicker(false)}
            />
            <div
              className="fixed bottom-0 left-0 right-0 z-[60] rounded-t-3xl max-h-[80vh] flex flex-col"
              style={{ background: 'var(--surface-1)', boxShadow: '0 -8px 40px rgba(0,0,0,0.1)' }}
            >
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
              </div>
              <div className="px-4 pb-2">
                <h3
                  className="text-base font-bold"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {isHi ? 'विषय चुनो' : 'Choose Your Subjects'}
                </h3>
                <p className="text-xs text-[var(--text-3)]">
                  {isHi ? 'जो विषय पढ़ना है वो चुनो' : 'Select the subjects you want to study'}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                <div className="grid grid-cols-2 gap-2">
                  {allowedSubjects.map((s) => {
                    const sel = selectedSubjects.includes(s.code);
                    return (
                      <button
                        key={s.code}
                        onClick={() => {
                          setSelectedSubjects((prev) =>
                            sel ? prev.filter((x) => x !== s.code) : [...prev, s.code],
                          );
                        }}
                        className="p-3 rounded-xl text-left transition-all active:scale-[0.97] flex items-center gap-2"
                        style={{
                          background: sel ? `${s.color}12` : 'var(--surface-2)',
                          border: `1.5px solid ${sel ? s.color : 'var(--border)'}`,
                        }}
                      >
                        <span className="text-lg" aria-hidden="true">{s.icon}</span>
                        <span
                          className="text-sm font-semibold"
                          style={{ color: sel ? s.color : 'var(--text-2)' }}
                        >
                          {s.name}
                        </span>
                        {sel && (
                          <span className="ml-auto text-xs" style={{ color: s.color }}>
                            &#10003;
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div
                className="px-4 pb-4 pt-2 border-t"
                style={{ borderColor: 'var(--border)' }}
              >
                <button
                  onClick={async () => {
                    const subs =
                      selectedSubjects.length > 0
                        ? selectedSubjects
                        : [student.preferred_subject];
                    await fetch('/api/student/preferences', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        action: 'set_selected_subjects',
                        subjects: subs,
                        preferred_subject: subs[0],
                      }),
                    });
                    setShowSubjectPicker(false);
                    loadStaticData();
                  }}
                  disabled={selectedSubjects.length === 0}
                  className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
                  style={{ background: 'var(--orange)' }}
                >
                  {isHi
                    ? `${selectedSubjects.length} विषय सेव करो`
                    : `Save ${selectedSubjects.length} Subject${selectedSubjects.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </>
        )}
      </main>

      <TrustFooter />
      <BottomNav />
    </div>
  );
}
