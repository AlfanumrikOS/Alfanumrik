'use client';

/**
 * /me — screen 16 "Me" (Wave B).
 *
 * Flag-gated by `ff_me_v2`, the same shape `/tests` uses for
 * `ff_exam_schedule_v1` (client read via useFeatureFlags; while the flag is
 * off we `router.replace('/profile')` and render nothing — `/profile` is the
 * existing, already-shipped equivalent this screen is an additive
 * presentation layer over, not a replacement of).
 *
 * Data sources — all already-built, no new read/write mechanism invented:
 *   - Identity + stats: AuthContext's `student` + `snapshot` (same source
 *     apps/host/src/app/(student)/profile/page.tsx already reads).
 *   - Subjects: useAllowedSubjects() (grade + stream + plan aware).
 *   - Parent link code: same `students.invite_code` /
 *     `guardian_student_links.invite_code` read the legacy profile page's
 *     ConnectionsCard already performs.
 *   - Downloads: useOfflineState() (IndexedDB-backed, client-only, design 14).
 *   - Language write: direct `students.preferred_language` update +
 *     AuthContext.setLanguage() — confirmed this is the real, already-used
 *     path (apps/host/src/app/(student)/profile/page.tsx handleSave); the
 *     one PATCH route that exists for preferences
 *     (api/student/preferences/route.ts) does NOT support language, only
 *     subject/stream/nudge actions, so inventing a new PATCH action for this
 *     single column would duplicate a working path rather than fix a gap.
 *   - Export: same read-only Promise.all over students/learning
 *     profiles/quiz_sessions/concept_mastery/achievements the legacy profile
 *     page already performs — no new tables touched.
 *
 *   - Plan modal (ff_plan_v2): the Plan settings row opens
 *     `@alfanumrik/ui/billing/v2/PlanModal` (screen 15) instead of navigating
 *     away, once the flag resolves ON. Every prop it needs is read from
 *     already-built mechanisms — no new authority invented:
 *       - usage: `checkDailyUsage()` (`@alfanumrik/lib/usage`), the SAME
 *         server-authoritative read `/foxy` already uses for its usage badge
 *         (GET /api/usage/daily under the hood).
 *       - isMinor / parentConsentEmail: `getMinorSignal()`
 *         (`@alfanumrik/lib/onboarding/use-setup`), the same signup-time
 *         signal `/onboarding` already surfaces.
 *       - checkout itself lives inside PlanModal via `useCheckout()`,
 *         unchanged — this page never touches the payment call.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useFeatureFlags } from '@alfanumrik/lib/swr';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';
import { useOfflineState } from '@alfanumrik/lib/offline/use-offline-state';
import { supabase } from '@alfanumrik/lib/supabase';
import { checkDailyUsage } from '@alfanumrik/lib/usage';
import { getMinorSignal, type MinorSignal } from '@alfanumrik/lib/onboarding/use-setup';
import { Skeleton } from '@alfanumrik/ui/ui';
import type { ProfileScreenStudent, ProfileScreenStats } from '@alfanumrik/ui/profile/v2/ProfileScreen';
import type { PlanModalUsageEntry } from '@alfanumrik/ui/billing/v2/PlanModal';

const ProfileScreen = dynamic(() => import('@alfanumrik/ui/profile/v2/ProfileScreen'), {
  loading: () => <Skeleton height={400} rounded="rounded-2xl" />,
});
const PlanModal = dynamic(() => import('@alfanumrik/ui/billing/v2/PlanModal'), {
  ssr: false,
});

function MePageInner() {
  const router = useRouter();
  const { isHi, isLoading, isLoggedIn, student, snapshot, language, setLanguage, refreshStudent, signOut } = useAuth();
  const { data: flags, isLoading: flagsLoading } = useFeatureFlags();
  const flagOn = flags?.ff_me_v2 === true;

  const { unlocked: allSubjects } = useAllowedSubjects();
  const offline = useOfflineState();

  const [parentLinkCode, setParentLinkCode] = useState<string | null>(null);
  const [parentLinkCodeLoading, setParentLinkCodeLoading] = useState(true);
  const [languageSaving, setLanguageSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dataError, setDataError] = useState(false);

  // Plan modal (ff_plan_v2) — gate + data the modal needs. See the file
  // header for why each read is an already-existing mechanism.
  const planModalEnabled = flags?.ff_plan_v2 === true;
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planUsage, setPlanUsage] = useState<PlanModalUsageEntry[]>([]);
  const [planUsageLoading, setPlanUsageLoading] = useState(true);
  const [planUsageError, setPlanUsageError] = useState(false);
  const [minorSignal, setMinorSignal] = useState<MinorSignal>({ isMinor: false, parentConsentEmail: null });

  // Auth + flag gate — same shape as /tests.
  useEffect(() => {
    if (isLoading || flagsLoading) return;
    if (!isLoggedIn) {
      router.replace('/login');
      return;
    }
    if (!flagOn) {
      router.replace('/profile');
    }
  }, [isLoading, flagsLoading, isLoggedIn, flagOn, router]);

  // Parent link code — same read ConnectionsCard (legacy /profile) performs.
  useEffect(() => {
    if (!flagOn || !isLoggedIn || !student?.id) return;
    let cancelled = false;
    setParentLinkCodeLoading(true);
    (async () => {
      try {
        const { data: studentData } = await supabase
          .from('students')
          .select('invite_code')
          .eq('id', student.id)
          .single();
        if (cancelled) return;
        if (studentData?.invite_code) {
          setParentLinkCode(studentData.invite_code);
        } else {
          const { data: existing } = await supabase
            .from('guardian_student_links')
            .select('invite_code')
            .eq('student_id', student.id)
            .not('invite_code', 'is', null)
            .limit(1)
            .single();
          if (!cancelled) setParentLinkCode(existing?.invite_code ?? null);
        }
      } catch {
        if (!cancelled) setParentLinkCode(null);
      } finally {
        if (!cancelled) setParentLinkCodeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flagOn, isLoggedIn, student?.id]);

  // Plan modal data — usage via the same server-authoritative `checkDailyUsage`
  // read /foxy already uses (GET /api/usage/daily under the hood), plus the
  // signup-time minor signal. Only fetched once the flag is confirmed ON, so a
  // student who never sees the modal never pays for the extra requests.
  const loadPlanModalData = useCallback(async () => {
    if (!student?.id) return;
    setPlanUsageLoading(true);
    setPlanUsageError(false);
    try {
      const plan = student.subscription_plan || 'free';
      const [quizUsage, chatUsage, signal] = await Promise.all([
        checkDailyUsage(student.id, 'quiz', plan),
        checkDailyUsage(student.id, 'foxy_chat', plan),
        getMinorSignal(),
      ]);
      setPlanUsage([
        { feature: 'quiz', limit: quizUsage.limit, count: quizUsage.count, remaining: quizUsage.remaining, allowed: quizUsage.allowed },
        { feature: 'foxy_chat', limit: chatUsage.limit, count: chatUsage.count, remaining: chatUsage.remaining, allowed: chatUsage.allowed },
      ]);
      setMinorSignal(signal);
    } catch {
      setPlanUsageError(true);
    } finally {
      setPlanUsageLoading(false);
    }
  }, [student?.id, student?.subscription_plan]);

  useEffect(() => {
    if (!planModalEnabled || !isLoggedIn || !student?.id) return;
    void loadPlanModalData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planModalEnabled, isLoggedIn, student?.id]);

  const handleChangeLanguage = useCallback(
    async (lang: 'en' | 'hi') => {
      if (!student?.id || language === lang) return;
      setLanguageSaving(true);
      // Flip immediately so this screen (and the rest of the app) re-renders
      // in the new language without waiting on the network write.
      setLanguage(lang);
      try {
        await supabase.from('students').update({ preferred_language: lang }).eq('id', student.id);
      } catch {
        // Best-effort persistence; the in-session language toggle already
        // applied. A failed write just means the choice doesn't survive a
        // fresh login — not a broken UI in this session.
      }
      setLanguageSaving(false);
    },
    [student?.id, language, setLanguage],
  );

  const handleExportData = useCallback(async () => {
    if (!student?.id) return;
    setExporting(true);
    try {
      const [{ data: profile }, { data: learning }, { data: quizzes }, { data: mastery }, { data: achv }] =
        await Promise.all([
          supabase.from('students').select('*').eq('id', student.id).single(),
          supabase.from('student_learning_profiles').select('*').eq('student_id', student.id).limit(20),
          supabase.from('quiz_sessions').select('*').eq('student_id', student.id).order('created_at', { ascending: false }).limit(20),
          supabase.from('concept_mastery').select('*').eq('student_id', student.id).order('updated_at', { ascending: false }).limit(100),
          supabase.from('student_achievements').select('*, achievements(*)').eq('student_id', student.id),
        ]);

      const exportData = {
        exported_at: new Date().toISOString(),
        profile,
        learning_profiles: learning ?? [],
        quiz_sessions: quizzes ?? [],
        concept_mastery: mastery ?? [],
        achievements: achv ?? [],
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `alfanumrik-data-${student.id.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Export is best-effort; no destructive state to roll back.
    }
    setExporting(false);
  }, [student?.id]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    router.replace('/login');
  }, [signOut, router]);

  const selectedCodes = useMemo(() => new Set(student?.selected_subjects ?? []), [student]);
  const selectedSubjects = useMemo(
    () => allSubjects.filter((s) => selectedCodes.has(s.code)),
    [allSubjects, selectedCodes],
  );

  const screenStudent: ProfileScreenStudent | null = student
    ? {
        name: student.name,
        grade: student.grade,
        board: student.board,
        schoolName: student.school_name,
        city: student.city,
        state: student.state,
        subscriptionPlan: student.subscription_plan,
        parentName: student.parent_name,
        parentPhone: student.parent_phone,
        memberSince: student.created_at
          ? new Date(student.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
          : '',
      }
    : null;

  const stats: ProfileScreenStats = {
    totalXp: snapshot?.total_xp ?? student?.xp_total ?? 0,
    streak: snapshot?.current_streak ?? student?.streak_days ?? 0,
    mastered: snapshot?.topics_mastered ?? 0,
    quizzesTaken: snapshot?.quizzes_taken ?? 0,
  };

  // ── Pre-gate render: while resolving auth/flags, or about to redirect. ──
  if (isLoading || flagsLoading || !isLoggedIn || !flagOn) {
    return (
      <main className="app-container py-6" data-testid="me-gate-loading">
        <Skeleton height={28} width="30%" className="mb-4" />
        <Skeleton height={140} rounded="rounded-2xl" className="mb-4" />
        <Skeleton height={220} rounded="rounded-2xl" />
      </main>
    );
  }

  return (
    <>
      <ProfileScreen
        isHi={isHi}
        loading={!student}
        error={dataError}
        onRetry={() => {
          setDataError(false);
          void refreshStudent();
        }}
        student={screenStudent}
        stats={stats}
        selectedSubjects={selectedSubjects}
        language={language}
        languageSaving={languageSaving}
        onChangeLanguage={handleChangeLanguage}
        parentLinkCode={parentLinkCode}
        parentLinkCodeLoading={parentLinkCodeLoading}
        downloadsCount={offline.chapters.length}
        savedExplanationsCount={offline.savedExplanations.length}
        exporting={exporting}
        onExportData={handleExportData}
        onSignOut={handleSignOut}
        editProfileHref="/profile"
        pricingHref="/pricing"
        planModalEnabled={planModalEnabled}
        onOpenPlan={() => setPlanModalOpen(true)}
      />
      {/* PlanModal (screen 15, ff_plan_v2) — mounted only once the flag is
          confirmed ON; the Plan row above is the only trigger. */}
      {planModalEnabled && (
        <PlanModal
          isOpen={planModalOpen}
          onClose={() => setPlanModalOpen(false)}
          isHi={isHi}
          loading={planUsageLoading}
          error={planUsageError}
          onRetry={() => void loadPlanModalData()}
          currentPlanCode={student?.subscription_plan ?? null}
          usage={planUsage}
          isMinor={minorSignal.isMinor}
          parentConsentEmail={minorSignal.parentConsentEmail}
          pricingHref="/pricing"
          onUpgradeSuccess={() => {
            setPlanModalOpen(false);
            void refreshStudent();
          }}
        />
      )}
    </>
  );
}

export default function MePage() {
  return <MePageInner />;
}
