'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase, getFeatureFlags, getNextTopics, generateNotifications } from '@/lib/supabase';
import { useDashboardData } from '@/lib/swr';
import { Card, SectionHeader, Avatar, BottomNav } from '@/components/ui';
import TrustFooter from '@/components/TrustFooter';
import { DashboardSkeleton } from '@/components/Skeleton';
import { calculateLevel } from '@/lib/xp-config';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import type { StudentLearningProfile, CurriculumTopic } from '@/lib/types';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import { ReselectBanner } from '@/components/subjects/ReselectBanner';
import { PlanBadge } from '@/components/PlanBadge';
import PendingLinkApproval, { type PendingLink } from '@/components/dashboard/PendingLinkApproval';
import ReviewsDueCard from '@/components/dashboard/ReviewsDueCard';
import CoinBalance from '@/components/coins/CoinBalance';
import XPDailyStatus from '@/components/xp/XPDailyStatus';

/* ─────────────────────────────────────────────────────────────
 * LAZY-LOADED BELOW-FOLD SECTIONS
 *
 * Per the launch-readiness audit (2026-05-05): the founder-visible
 * dashboard MUST show ≤5 widgets above the fold. Everything else is
 * grouped into 5 collapsed `<details>` sections that lazy-load their
 * heavy data-fetching subtrees only when the student opens the section.
 *
 * Why next/dynamic + ssr:false:
 *   - Defers the bundle weight (each section is ~5–15 kB gzipped).
 *   - Defers the data fetching (BKT/SWR/leaderboard queries don't fire
 *     on first paint — they wait until expansion). This addresses the
 *     audit's N+1 BKT-query concern.
 *
 * Each chunk has its own Skeleton fallback so opening a section feels
 * snappy even on Indian 4G (2-5 Mbps).
 * ──────────────────────────────────────────────────────────── */

const SectionSkeleton = () => (
  <div className="animate-pulse rounded-2xl p-4 space-y-2"
    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
    <div className="h-4 rounded w-1/3" style={{ background: 'var(--border)' }} />
    <div className="h-3 rounded w-2/3" style={{ background: 'var(--border)' }} />
    <div className="h-3 rounded w-1/2" style={{ background: 'var(--border)' }} />
  </div>
);

const ProgressSection = dynamic(
  () => import('@/components/dashboard/sections/ProgressSection'),
  { ssr: false, loading: () => <SectionSkeleton /> }
);
const TodaysFocusSection = dynamic(
  () => import('@/components/dashboard/sections/TodaysFocusSection'),
  { ssr: false, loading: () => <SectionSkeleton /> }
);
const UpcomingSection = dynamic(
  () => import('@/components/dashboard/sections/UpcomingSection'),
  { ssr: false, loading: () => <SectionSkeleton /> }
);
const CompeteSection = dynamic(
  () => import('@/components/dashboard/sections/CompeteSection'),
  { ssr: false, loading: () => <SectionSkeleton /> }
);
const QuickActionsSection = dynamic(
  () => import('@/components/dashboard/sections/QuickActionsSection'),
  { ssr: false, loading: () => <SectionSkeleton /> }
);

/* ─────────────────────────────────────────────────────────────
 * Reusable collapsible section. Closed by default for new users;
 * remembers per-section open state in localStorage for returning
 * users so the dashboard "feels lived in" on the second visit.
 * Uses native <details> so it works without JS and is zero-bundle.
 * ──────────────────────────────────────────────────────────── */
function CollapsibleSection({
  id,
  icon,
  title,
  titleHi,
  isHi,
  children,
}: {
  id: string;
  icon: string;
  title: string;
  titleHi: string;
  isHi: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const storageKey = `dash_section_${id}`;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setOpen(window.localStorage.getItem(storageKey) === '1');
    } catch {
      // localStorage may be blocked — keep default closed
    }
  }, [storageKey]);

  return (
    <details
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(next);
        try { window.localStorage.setItem(storageKey, next ? '1' : '0'); } catch { /* noop */ }
      }}
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
    >
      <summary
        className="px-4 py-3 cursor-pointer select-none flex items-center gap-2 list-none"
        style={{ minHeight: 44 }}
      >
        <span className="text-lg" aria-hidden>{icon}</span>
        <span className="text-sm font-bold flex-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
          {isHi ? titleHi : title}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-3)' }} aria-hidden>
          {open ? '▴' : '▾'}
        </span>
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-3">
        {open && children}
      </div>
    </details>
  );
}

export default function Dashboard() {
  const { student, snapshot, isLoggedIn, isLoading, isHi, language, setLanguage, refreshSnapshot, activeRole } = useAuth();
  const router = useRouter();
  const { unlocked: allowedSubjects } = useAllowedSubjects();
  const [profiles, setProfiles] = useState<StudentLearningProfile[]>([]);
  const [nextTopics, setNextTopics] = useState<CurriculumTopic[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [greeting, setGreeting] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [showSubjectPicker, setShowSubjectPicker] = useState(false);
  const [knowledgeGaps, setKnowledgeGaps] = useState<Array<{ id: string; topic_title?: string; severity: string; description: string; description_hi?: string }>>([]);
  const [velocityTrend, setVelocityTrend] = useState<'fast' | 'steady' | 'slow' | null>(null);
  const [bloomLevel, setBloomLevel] = useState<{ bloom_level: string; mastery: number } | null>(null);
  const [errorBreakdown, setErrorBreakdown] = useState<{ careless: number; conceptual: number; misinterpretation: number } | null>(null);
  const [retentionScore, setRetentionScore] = useState<number | null>(null);
  const [cbseReadiness, setCbseReadiness] = useState<number | null>(null);
  const [upcomingExams, setUpcomingExams] = useState<Array<{ id: string; exam_name: string; exam_type: string; subject: string; exam_date: string; days_left: number }>>([]);
  const [nudges, setNudges] = useState<Array<{ id: string; nudge_type: string; message: string; message_hi?: string; priority: number }>>([]);
  const [studentRank, setStudentRank] = useState<number | null>(null);
  // BKT mastery: average mastery_probability per subject from concept_mastery table.
  // This is the real adaptive mastery signal, not the XP/accuracy proxy.
  const [bktMastery, setBktMastery] = useState<Record<string, number>>({});
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);

  // Performance Score system state
  const [perfScores, setPerfScores] = useState<Array<{
    subject: string;
    overall_score: number;
    level_name: string;
  }>>([]);
  const [coinBalance, setCoinBalance] = useState<number>(0);

  // STEM Lab streak — fed by `student_lab_streaks` table maintained by the
  // `complete_experiment` RPC. Null until the first fetch resolves; rendered
  // only when the student has either an active streak or any past experiments.
  const [labStreak, setLabStreak] = useState<{
    current_streak: number;
    longest_streak: number;
    total_experiments: number;
  } | null>(null);

  // Daily challenge (Concept Chain) state
  const [challengeUnlocked, setChallengeUnlocked] = useState(false);
  const [challengeStreak, setChallengeStreak] = useState(0);
  const [challengeSolved, setChallengeSolved] = useState(false);
  const [todaySubject, setTodaySubject] = useState<string | undefined>();
  const [todaySubjectHi, setTodaySubjectHi] = useState<string | undefined>();
  const [todayTopic, setTodayTopic] = useState<string | undefined>();

  // Stream selector — grades 11-12 only, persisted to localStorage
  const [selectedStream, setSelectedStream] = useState<'science' | 'commerce' | 'humanities' | null>(null);
  const [showStreamPicker, setShowStreamPicker] = useState(false);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
    // Redirect non-student roles to their correct dashboard
    if (!isLoading && isLoggedIn && activeRole === 'teacher') router.replace('/teacher');
    if (!isLoading && isLoggedIn && activeRole === 'guardian') router.replace('/parent');
    // institution_admin (Wave 1) routes to their own panel
    if (!isLoading && isLoggedIn && activeRole === 'institution_admin') router.replace('/institution-admin');
    // Redirect students who haven't completed onboarding (grade/board not set)
    if (!isLoading && isLoggedIn && activeRole === 'student' && student && !student.onboarding_completed) {
      router.replace('/onboarding');
    }
    // Edge case: logged in, but student profile is missing AND no other role assigned.
    // The render-time fallback at the bottom can't call router.replace() during render
    // (React anti-pattern: setState/router during render triggers strict-mode warnings),
    // so we kick the redirect from here.
    if (!isLoading && isLoggedIn && !student && activeRole !== 'teacher' && activeRole !== 'guardian' && activeRole !== 'institution_admin') {
      router.replace('/login');
    }
  }, [isLoading, isLoggedIn, activeRole, student, router]);

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(isHi
      ? (h < 12 ? 'शुभ प्रभात' : h < 17 ? 'नमस्ते' : 'शुभ संध्या')
      : (h < 12 ? 'Good morning' : h < 17 ? 'Hello' : 'Good evening'));
  }, [isHi]);

  // SWR: auto-caching, dedup, background revalidation, reconnect-resilient
  const { data: dashData } = useDashboardData(student?.id);

  const loadStaticData = useCallback(async () => {
    if (!student) return;
    const [feats, nextTopicsResult] = await Promise.all([
      getFeatureFlags(),
      getNextTopics(student.id, student.preferred_subject, student.grade),
    ]);
    setFlags(feats);
    setNextTopics(nextTopicsResult.slice(0, 3));

    // Fetch BKT mastery per subject: average mastery_probability from concept_mastery.
    // concept_mastery has no direct subject column — join via curriculum_topics.
    // We select topic_id, mastery_probability and join subject from curriculum_topics.
    try {
      const { data: cmData } = await supabase
        .from('concept_mastery')
        .select('mastery_probability, curriculum_topics!inner(subject_id, subjects!inner(code))')
        .eq('student_id', student.id)
        .gt('mastery_probability', 0);
      if (cmData && cmData.length > 0) {
        // Group by subject code and compute average mastery_probability
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
      // Non-fatal: falls back to XP-based progress bar
    }
    // Fetch Performance Scores per subject from performance_scores table
    try {
      const { data: psData } = await supabase
        .from('performance_scores')
        .select('subject, overall_score, level_name')
        .eq('student_id', student.id);
      if (psData && psData.length > 0) {
        setPerfScores(psData.map((row: any) => ({
          subject: row.subject as string,
          overall_score: Number(row.overall_score) || 0,
          level_name: (row.level_name as string) || 'Curious Cub',
        })));
      }
    } catch {
      // Non-fatal: falls back to showing score of 0
    }

    // Fetch Foxy Coin balance from coin_balances table
    try {
      const { data: cbData } = await supabase
        .from('coin_balances')
        .select('balance')
        .eq('student_id', student.id)
        .single();
      if (cbData) {
        setCoinBalance(Number(cbData.balance) || 0);
      }
    } catch {
      // Non-fatal: coin balance defaults to 0
    }

    // Fetch STEM Lab streak. RLS allows the student's own row; if none exists
    // (never run an experiment) the row is simply absent and the card hides.
    try {
      const { data: lsData } = await supabase
        .from('student_lab_streaks')
        .select('current_streak, longest_streak, total_experiments')
        .eq('student_id', student.id)
        .maybeSingle();
      if (lsData) {
        setLabStreak({
          current_streak: Number(lsData.current_streak) || 0,
          longest_streak: Number(lsData.longest_streak) || 0,
          total_experiments: Number(lsData.total_experiments) || 0,
        });
      }
    } catch {
      // Non-fatal: lab streak card simply does not render
    }

    const rawSelected = (student.selected_subjects || [student.preferred_subject].filter(Boolean)) as string[];
    setSelectedSubjects(rawSelected);
    generateNotifications(student.id).catch((err: unknown) => {
      console.warn('[dashboard] notification generation failed:', err instanceof Error ? err.message : String(err));
    });
  }, [student]);

  // Narrow selectedSubjects to only those the student is allowed — drops legacy
  // grade/plan-mismatched codes once the subjects service hook has loaded.
  useEffect(() => {
    if (allowedSubjects.length === 0) return;
    const allowedCodes = new Set(allowedSubjects.map(s => s.code));
    setSelectedSubjects(prev => {
      const next = prev.filter(code => allowedCodes.has(code));
      return next.length === prev.length ? prev : next;
    });
  }, [allowedSubjects]);

  // Process dashboard RPC data when SWR returns it
  useEffect(() => {
    if (!dashData) return;
    const d = dashData;
    setProfiles(d.profiles ?? []);
    setDueCount(d.due_count ?? 0);
    setUnreadCount(d.unread_count ?? 0);
    const gaps = d.knowledge_gaps ?? [];
    setKnowledgeGaps(gaps.map((g: any) => ({
      id: g.id,
      topic_title: g.target_concept_name,
      severity: (g.confidence_score ?? 0) > 0.7 ? 'critical' : 'moderate',
      description: `Missing prerequisite: ${g.missing_prerequisite_name}`,
      description_hi: `पूर्व ज्ञान की कमी: ${g.missing_prerequisite_name}`,
    })));
    if (d.velocity != null) {
      const v = Number(d.velocity);
      setVelocityTrend(v > 0.05 ? 'fast' : v > 0.02 ? 'steady' : 'slow');
    }
    if (d.bloom) {
      const level = d.bloom.current_bloom_level || 'remember';
      setBloomLevel({ bloom_level: level, mastery: Number(d.bloom[`${level}_mastery`]) || 0 });
    }
    if (d.cbse_readiness != null) setCbseReadiness(Math.round(d.cbse_readiness));
    const today = new Date();
    setUpcomingExams((d.exams ?? []).map((e: any) => ({
      ...e,
      days_left: Math.max(0, Math.ceil((new Date(e.exam_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))),
    })));
    setNudges(d.nudges ?? []);
    if (d.retention_score != null) setRetentionScore(Math.round(d.retention_score));
    // Leaderboard rank (if RPC returns it)
    if (d.leaderboard_rank != null) setStudentRank(d.leaderboard_rank);
    if (d.error_breakdown) setErrorBreakdown({
      careless: d.error_breakdown.careless ?? 0,
      conceptual: d.error_breakdown.conceptual ?? 0,
      misinterpretation: d.error_breakdown.misinterpretation ?? 0,
    });
  }, [dashData]);

  useEffect(() => {
    if (student) { loadStaticData(); refreshSnapshot(); }
  }, [student?.id, loadStaticData, refreshSnapshot]);

  // Fetch pending parent link requests for this student
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
      // Non-fatal: pending links are a non-critical feature
    }
  }, [student]);

  useEffect(() => {
    if (student) { fetchPendingLinks(); }
  }, [student?.id, fetchPendingLinks]);

  // Fetch daily challenge state for Concept Chain widget (consumed by
  // TodaysFocusSection below the fold).
  useEffect(() => {
    if (!student) return;
    let cancelled = false;

    (async () => {
      try {
        // Get today in IST
        const now = new Date();
        const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
        const today = ist.toISOString().slice(0, 10);

        // Parallel: challenge, streak, attempt, unlock check
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

        // Subject/topic from today's challenge
        if (challengeRes.data) {
          setTodaySubject(challengeRes.data.subject ?? undefined);
          setTodaySubjectHi(challengeRes.data.subject_hi ?? undefined);
          setTodayTopic(challengeRes.data.topic ?? undefined);
        }

        // Streak
        if (streakRes.data) {
          setChallengeStreak(streakRes.data.current_streak ?? 0);
        }

        // Solved status
        if (attemptRes.data && attemptRes.data.solved) {
          setChallengeSolved(true);
          setChallengeUnlocked(true);
          return;
        }

        // Unlock check: quiz session today with >= 5 questions
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
          // Grace period check
          const createdDate = new Date(student.created_at);
          const daysSince = Math.floor(
            (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          if (daysSince <= 3) {
            setChallengeUnlocked(true);
          }
        }
      } catch {
        // Non-fatal: challenge card defaults to locked/hidden
      }
    })();

    return () => { cancelled = true; };
  }, [student?.id, student?.grade, student?.created_at]);

  // Stream selector: show picker on first visit for grades 11-12
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

  const STREAM_SUBJECTS: Record<string, string[]> = {
    science: ['math', 'physics', 'chemistry', 'biology', 'english', 'computer_science'],
    commerce: ['math', 'economics', 'accountancy', 'business_studies', 'english', 'computer_science'],
    humanities: ['history_sr', 'geography', 'political_science', 'economics', 'english', 'hindi'],
  };

  // Show skeleton while loading, but don't block non-student roles — they'll be redirected
  if (isLoading) return <DashboardSkeleton />;
  if (!student) {
    // Non-student role (teacher/guardian/institution_admin) — redirect is already in flight from useEffect.
    return <DashboardSkeleton />;
  }

  const totalXp = snapshot?.total_xp ?? profiles.reduce((a, p) => a + (p.xp ?? 0), 0);
  const streak = snapshot?.current_streak ?? Math.max(...profiles.map((p) => p.streak_days ?? 0), 0);
  const mastered = snapshot?.topics_mastered ?? 0;

  // Phase 1.2: build the Foxy entry URL with subject + grade pre-filled so a
  // student doesn't have to pick a subject before sending their first message.
  // The Foxy page itself re-validates subject against allowedSubjects (it has
  // the authoritative list once loaded), so this is a best-effort hint.
  const buildFoxyHref = (): string => {
    const allowedCodes = new Set(allowedSubjects.map((s) => s.code));
    let subject: string | undefined;
    if (student.preferred_subject && allowedCodes.has(student.preferred_subject)) {
      subject = student.preferred_subject;
    } else if (allowedSubjects.length > 0) {
      subject = allowedSubjects[0].code;
    }
    if (!subject) return '/foxy';
    const params = new URLSearchParams({ subject, source: 'dashboard' });
    if (student.grade) params.set('grade', String(student.grade).replace('Grade ', '').trim());
    return `/foxy?${params.toString()}`;
  };
  const foxyHref = buildFoxyHref();

  // Filter subjects by stream for grades 11-12 — used by SubjectProgress in
  // the lazy-loaded ProgressSection below the fold.
  const streamFilteredSubjects = (() => {
    const g = student?.grade ?? '9';
    if ((g === '11' || g === '12') && selectedStream) {
      return allowedSubjects.filter(s => (STREAM_SUBJECTS[selectedStream] ?? []).includes(s.code));
    }
    return allowedSubjects;
  })();

  // Smart "Continue Learning" target. Picks last-worked-on chapter from
  // BKT-derived nextTopics; falls back to a subject hint for zero-state.
  const continueTopic = nextTopics[0];
  const continueSubjectMeta = allowedSubjects.find((s) => s.code === student.preferred_subject);
  const continueHref = continueTopic?.chapter_number
    ? `/learn/${student.preferred_subject}/${continueTopic.chapter_number}`
    : foxyHref;

  // Primary CTA href. Smart subject pick from BKT (preferred_subject is the
  // BKT-validated last-active subject; falls back to /quiz which then routes
  // to subject picker). Includes ?source=dashboard for funnel attribution.
  const startQuizHref = student.preferred_subject
    ? `/quiz?subject=${student.preferred_subject}&grade=${String(student.grade || '9').replace('Grade ', '').trim()}&source=dashboard`
    : '/quiz';

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* Stream Picker Modal — grades 11-12 first visit */}
      {showStreamPicker && (student?.grade === '11' || student?.grade === '12') && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm rounded-3xl p-6 shadow-2xl"
            style={{ background: 'var(--warm-cream, #FFF9F0)', border: '1px solid var(--border)' }}>
            <div className="text-center mb-5">
              <div className="text-4xl mb-2">🎓</div>
              <h2 className="font-bold text-xl" style={{ color: 'var(--text-1)' }}>
                {isHi ? 'अपनी स्ट्रीम चुनें' : 'Choose Your Stream'}
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
                {isHi ? 'कक्षा ' + student.grade + ' · CBSE' : 'Class ' + student.grade + ' · CBSE'}
              </p>
            </div>
            <div className="space-y-3">
              {[
                { key: 'science', icon: '⚗️', label: 'Science', labelHi: 'विज्ञान', desc: 'Physics · Chemistry · Biology · Math', color: '#2563EB' },
                { key: 'commerce', icon: '📊', label: 'Commerce', labelHi: 'वाणिज्य', desc: 'Accountancy · Economics · Business', color: '#D97706' },
                { key: 'humanities', icon: '🌍', label: 'Humanities', labelHi: 'मानविकी', desc: 'History · Geography · Political Science', color: '#7C3AED' },
              ].map(st => (
                <button
                  key={st.key}
                  onClick={() => {
                    const s = st.key as 'science' | 'commerce' | 'humanities';
                    setSelectedStream(s);
                    localStorage.setItem('alfanumrik_stream', s);
                    setShowStreamPicker(false);
                  }}
                  className="w-full flex items-center gap-4 p-4 rounded-2xl text-left transition-all hover:scale-[1.01]"
                  style={{
                    background: 'var(--surface-1)',
                    border: `2px solid ${st.color}30`,
                  }}
                >
                  <span className="text-3xl">{st.icon}</span>
                  <div>
                    <p className="font-bold text-base" style={{ color: st.color }}>
                      {isHi ? st.labelHi : st.label}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-2)' }}>{st.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Header — slim. Greeting/avatar/level-chip lives in the page body
          (above-the-fold widget #1) so the CTA stays paired with it. */}
      <header className="page-header">
        <div className="page-header-inner flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PlanBadge planCode={student.subscription_plan} size="sm" />
            {(student.grade === '11' || student.grade === '12') && selectedStream && (
              <button
                onClick={() => setShowStreamPicker(true)}
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{
                  background: selectedStream === 'science' ? '#2563EB15' : selectedStream === 'commerce' ? '#D9770615' : '#7C3AED15',
                  color: selectedStream === 'science' ? '#2563EB' : selectedStream === 'commerce' ? '#D97706' : '#7C3AED',
                  border: `1px solid ${selectedStream === 'science' ? '#2563EB30' : selectedStream === 'commerce' ? '#D9770630' : '#7C3AED30'}`,
                }}
              >
                {selectedStream === 'science' ? '⚗️' : selectedStream === 'commerce' ? '📊' : '🌍'}
                {' '}{isHi
                  ? (selectedStream === 'science' ? 'विज्ञान' : selectedStream === 'commerce' ? 'वाणिज्य' : 'मानविकी')
                  : (selectedStream === 'science' ? 'Science' : selectedStream === 'commerce' ? 'Commerce' : 'Humanities')}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <CoinBalance balance={coinBalance} isHi={isHi} />
            <button
              onClick={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
              className="text-xs px-3 py-1.5 rounded-xl border transition-colors"
              style={{ borderColor: 'var(--border-mid)', color: 'var(--text-3)' }}
              aria-label={isHi ? 'भाषा बदलो' : 'Change language'}
            >
              {language === 'hi' ? '🌐 EN' : '🇮🇳 हिं'}
            </button>
            <button
              onClick={() => router.push('/notifications')}
              className="relative p-1.5"
              aria-label={isHi ? 'सूचनाएं' : 'Notifications'}
            >
              <span className="text-lg">🔔</span>
              {unreadCount > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: 'var(--danger)', fontSize: 10, lineHeight: 1 }}
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <button onClick={() => router.push('/profile')} aria-label={isHi ? 'प्रोफ़ाइल' : 'Profile'}>
              <Avatar name={student.name} />
            </button>
          </div>
        </div>
      </header>

      <main className="app-container py-4 space-y-4">
       <SectionErrorBoundary section="Dashboard">

        {/* ═══ PENDING PARENT LINK APPROVAL ═══
            Compact alert. Renders nothing when there are no pending links —
            does not eat above-the-fold real estate in the common case. */}
        {pendingLinks.length > 0 && (
          <PendingLinkApproval
            links={pendingLinks}
            onApproved={fetchPendingLinks}
            isHi={isHi}
          />
        )}

        {/* ═══════════════════════════════════════════════════════════
            ABOVE-THE-FOLD WIDGETS — exactly 5, in this fixed order.
            Audit (2026-05-05): "A new student opens this and bounces.
            Founder will flag this on first look." Keep this section
            ruthlessly minimal. Each widget has a single job.
            ═══════════════════════════════════════════════════════════ */}

        {/* (1) GREETING — name + level chip. Stacks on mobile (360px). */}
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>{greeting},</p>
            <h1 className="text-xl md:text-2xl font-bold truncate" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
              {isHi ? `${student.name}, सीखने को तैयार?` : `${student.name}, ready to learn?`}
            </h1>
          </div>
          <div className="flex-shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: 'var(--text-3)' }}>
              {isHi ? 'स्तर' : 'Level'}
            </div>
            <div className="text-lg font-extrabold" style={{ color: 'var(--orange)', fontFamily: 'var(--font-display)' }}>
              {calculateLevel(totalXp)}
            </div>
          </div>
        </div>

        {/* (2) PRIMARY CTA — single big purple button. No second-tier
            chrome here. Choice paralysis is the #1 audit complaint. */}
        <button
          onClick={() => router.push(startQuizHref)}
          className="w-full py-4 rounded-2xl text-base font-bold text-white transition-all active:scale-[0.98] shadow-lg"
          style={{
            background: 'linear-gradient(135deg, var(--purple, #7C3AED), #5B21B6)',
            minHeight: 56,
          }}
        >
          {isHi ? '▶ आज का क्विज़ शुरू करो' : "▶ Start today's quiz"}
        </button>

        {/* (3) STREAK — flame + days. One row, no card chrome. */}
        <div className="flex items-center justify-center gap-2 py-1">
          <span className="text-2xl streak-flame" aria-hidden>🔥</span>
          <span className="text-2xl font-extrabold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
            {streak}
          </span>
          <span className="text-sm" style={{ color: 'var(--text-3)' }}>
            {isHi
              ? `दिन की लय`
              : `day${streak === 1 ? '' : 's'} streak`}
          </span>
        </div>

        {/* (4) TODAY'S PROGRESS STRIP — XP today / 200 cap.
            XPDailyStatus self-fetches, has its own loading skeleton, and
            renders nothing harmful for zero-state students. */}
        <SectionErrorBoundary section="XP Daily">
          <XPDailyStatus studentId={student.id} streak={streak} isHi={isHi} />
        </SectionErrorBoundary>

        {/* (5) CONTINUE LEARNING — last topic from BKT, OR zero-state
            "Pick a subject to start". For zero-state grades 11-12, this
            is also where the Stream Picker re-entry lives. */}
        {continueTopic ? (
          <Card
            hoverable
            onClick={() => router.push(continueHref)}
            className="flex items-center gap-4 !p-4"
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
              style={{ background: `${continueSubjectMeta?.color ?? 'var(--orange)'}15` }}
              aria-hidden
            >
              {continueSubjectMeta?.icon ?? '📚'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'जारी रखो' : 'Continue'}
              </div>
              <div className="font-semibold text-sm md:text-base truncate" style={{ color: 'var(--text-1)' }}>
                {continueTopic.title}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                {continueTopic.chapter_number
                  ? (isHi ? `अध्याय ${continueTopic.chapter_number}` : `Chapter ${continueTopic.chapter_number}`)
                  : (isHi ? 'Foxy के साथ सीखो' : 'Learn with Foxy')}
              </div>
            </div>
            <span style={{ color: 'var(--text-3)' }} aria-hidden>→</span>
          </Card>
        ) : (
          // Zero-state: prompt to pick subjects (or re-pick if drift).
          (allowedSubjects.length === 0 || selectedSubjects.length === 0) ? (
            <ReselectBanner isHi={isHi} onReselect={() => setShowSubjectPicker(true)} />
          ) : (
            <Card hoverable onClick={() => setShowSubjectPicker(true)} className="flex items-center gap-4 !p-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: 'rgba(232,88,28,0.1)' }} aria-hidden>📚</div>
              <div className="flex-1">
                <div className="font-semibold text-sm md:text-base" style={{ color: 'var(--text-1)' }}>
                  {isHi ? 'विषय चुनकर शुरू करो' : 'Pick a subject to start'}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                  {isHi ? 'अपनी पढ़ाई का सफ़र अभी शुरू करो' : 'Begin your learning journey now'}
                </div>
              </div>
              <span style={{ color: 'var(--text-3)' }} aria-hidden>→</span>
            </Card>
          )
        )}

        {/* ═══════════════════════════════════════════════════════════
            BELOW-THE-FOLD — collapsed by default. Each section is
            lazy-loaded via next/dynamic so the data fetches only fire
            when the student opens the section. This addresses the audit's
            N+1 BKT-query and bundle-weight concerns simultaneously.
            ═══════════════════════════════════════════════════════════ */}

        {/* Spaced-repetition CTA stays above the accordions because it's
            time-sensitive (concept_mastery.next_review_date is due NOW).
            ReviewsDueCard renders nothing when dueCount === 0. */}
        <ReviewsDueCard />

        <CollapsibleSection id="progress" icon="📊" title="Your progress" titleHi="आपकी प्रगति" isHi={isHi}>
          <ProgressSection
            isHi={isHi}
            student={student}
            snapshot={snapshot ?? null}
            profiles={profiles}
            allowedSubjects={streamFilteredSubjects}
            selectedSubjects={selectedSubjects}
            bktMastery={bktMastery}
            perfScores={perfScores}
            bloomLevel={bloomLevel}
            errorBreakdown={errorBreakdown}
            retentionScore={retentionScore}
            cbseReadiness={cbseReadiness}
            velocityTrend={velocityTrend}
            knowledgeGaps={knowledgeGaps}
            totalXp={totalXp}
            mastered={mastered}
            streak={streak}
            dueCount={dueCount}
            foxyHref={foxyHref}
          />
        </CollapsibleSection>

        <CollapsibleSection id="focus" icon="🎯" title="Today's focus" titleHi="आज का फ़ोकस" isHi={isHi}>
          <TodaysFocusSection
            isHi={isHi}
            student={student}
            totalXp={totalXp}
            streak={streak}
            level={calculateLevel(totalXp)}
            preferredSubject={student.preferred_subject ?? ''}
            dueCount={dueCount}
            knowledgeGaps={knowledgeGaps}
            nextTopics={nextTopics}
            nudges={nudges}
            onDismissNudge={(id) => setNudges(prev => prev.filter(n => n.id !== id))}
            challenge={{
              unlocked: challengeUnlocked,
              streak: challengeStreak,
              solved: challengeSolved,
              todaySubject,
              todaySubjectHi,
              todayTopic,
            }}
          />
        </CollapsibleSection>

        <CollapsibleSection id="upcoming" icon="📅" title="Upcoming" titleHi="आगामी" isHi={isHi}>
          <UpcomingSection
            isHi={isHi}
            grade={student.grade}
            cbseReadiness={cbseReadiness}
            upcomingExams={upcomingExams}
            allowedSubjects={allowedSubjects}
          />
        </CollapsibleSection>

        <CollapsibleSection id="compete" icon="🏆" title="Compete" titleHi="प्रतियोगिता" isHi={isHi}>
          <CompeteSection
            isHi={isHi}
            studentRank={studentRank}
            totalXp={totalXp}
          />
        </CollapsibleSection>

        <CollapsibleSection id="quick" icon="⚡" title="Quick actions" titleHi="त्वरित" isHi={isHi}>
          <QuickActionsSection
            isHi={isHi}
            foxyHref={foxyHref}
            labStreak={labStreak}
            allowedSubjects={allowedSubjects}
            selectedSubjects={selectedSubjects}
            onOpenSubjectPicker={() => setShowSubjectPicker(true)}
            preferredSubject={student.preferred_subject}
            onSetPreferredSubject={async (code) => {
              await fetch('/api/student/preferences', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set_preferred_subject', subject: code }),
              });
              if (typeof window !== 'undefined') localStorage.setItem('alfanumrik_subject', code);
              router.push('/learn');
            }}
          />
        </CollapsibleSection>

        {/* Subject Picker Modal — opened from above-the-fold zero-state
            card OR from the Quick Actions section. Lives at root so it
            overlays everything. */}
        {showSubjectPicker && (
          <>
            <div className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.3)' }} onClick={() => setShowSubjectPicker(false)} />
            <div className="fixed bottom-0 left-0 right-0 z-[60] rounded-t-3xl max-h-[80vh] flex flex-col" style={{ background: 'var(--surface-1)', boxShadow: '0 -8px 40px rgba(0,0,0,0.1)' }}>
              <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} /></div>
              <div className="px-4 pb-2">
                <h3 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? 'विषय चुनो' : 'Choose Your Subjects'}</h3>
                <p className="text-xs text-[var(--text-3)]">{isHi ? 'जो विषय पढ़ना है वो चुनो' : 'Select the subjects you want to study'}</p>
              </div>
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                <div className="grid grid-cols-2 gap-2">
                  {allowedSubjects.map((s) => {
                    const sel = selectedSubjects.includes(s.code);
                    return (
                      <button key={s.code} onClick={() => {
                        setSelectedSubjects(prev => sel ? prev.filter(x => x !== s.code) : [...prev, s.code]);
                      }} className="p-3 rounded-xl text-left transition-all active:scale-[0.97] flex items-center gap-2"
                        style={{ background: sel ? `${s.color}12` : 'var(--surface-2)', border: `1.5px solid ${sel ? s.color : 'var(--border)'}` }}>
                        <span className="text-lg">{s.icon}</span>
                        <span className="text-sm font-semibold" style={{ color: sel ? s.color : 'var(--text-2)' }}>{s.name}</span>
                        {sel && <span className="ml-auto text-xs" style={{ color: s.color }}>&#10003;</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="px-4 pb-4 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <button onClick={async () => {
                  const subs = selectedSubjects.length > 0 ? selectedSubjects : [student.preferred_subject];
                  await fetch('/api/student/preferences', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'set_selected_subjects', subjects: subs, preferred_subject: subs[0] }),
                  });
                  setShowSubjectPicker(false);
                  loadStaticData();
                }} disabled={selectedSubjects.length === 0} className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
                  style={{ background: 'var(--orange)' }}>
                  {isHi ? `${selectedSubjects.length} विषय सेव करो` : `Save ${selectedSubjects.length} Subject${selectedSubjects.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </>
        )}

       </SectionErrorBoundary>
      </main>

      <TrustFooter />
      <BottomNav />
    </div>
  );
}
