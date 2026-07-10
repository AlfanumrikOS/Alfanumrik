'use client';

/**
 * StudentOSDashboard — the "Alfa OS" flagship redesign of the student landing
 * (ff_student_os_v1). Renders ONLY when the flag resolves ON; the legacy
 * AtlasDashboard renders otherwise (see page.tsx for the flag dispatch).
 *
 * Design philosophy: decision-first, mastery-centric. The page answers "what
 * should I do right now?" before anything else.
 *
 *   1. Compact header rail   — greeting + StreakBadge + XP (demoted, glanceable).
 *   2. PRIMARY hero          — <TodaysMission> wrapping the existing
 *                              DailyRhythmQueue as the single dominant CTA.
 *   3. <MasterySnapshot>     — Mastered / Learning / Needs-Revision buckets.
 *   4. <BoardScoreWidget>    — BoardScore™ predictive board-exam marks (ff_board_score_v1).
 *   5. <RevisionRail>        — secondary spaced-repetition surface (reuses
 *                              ReviewsDueCard + useReviewCards).
 *   6. <SubjectRoadmaps>     — per-subject skill trees (SkillTree primitive).
 *
 * This is a PRESENTATION layer over unchanged engines. No scoring/XP/mastery
 * formula is computed here — every number comes from the existing snapshot /
 * useMasteryOverview / rhythm outputs. Rendered under Cosmic-LIGHT + student
 * palette via useCosmicLightSurface (dark mode is killed for this surface).
 *
 * Responsive (AppShell variant="split"):
 *   - mobile : single priority stack + MobileNav bottom nav.
 *   - tablet : left rail (mastery snapshot) + content (mission + roadmaps).
 *   - desktop: adds right aside (revision rail / quick links).
 *
 * Bilingual via AuthContext.isHi. Loading / empty handled per child.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { getNextTopics, getPendingParentLinks } from '@alfanumrik/lib/supabase';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';
import { useCosmicLightSurface } from '@alfanumrik/lib/use-cosmic-light-surface';
import { DashboardSkeleton } from '@alfanumrik/ui/Skeleton';
import { AppShell } from '@alfanumrik/ui/responsive';
import { StreakBadge } from '@alfanumrik/ui/ui';
import type { CurriculumTopic } from '@alfanumrik/lib/types';
import TodaysMission from '@alfanumrik/ui/dashboard/os/TodaysMission';
import MasterySnapshot from '@alfanumrik/ui/dashboard/os/MasterySnapshot';
import RevisionRail from '@alfanumrik/ui/dashboard/os/RevisionRail';
import SubjectRoadmaps from '@alfanumrik/ui/dashboard/os/SubjectRoadmaps';
import BoardScoreWidget from '@alfanumrik/ui/dashboard/os/BoardScoreWidget';
import PendingLinkApproval, { type PendingLink } from '@alfanumrik/ui/dashboard/PendingLinkApproval';

export default function StudentOSDashboard() {
  const router = useRouter();
  const {
    student,
    snapshot,
    isLoggedIn,
    isLoading,
    isHi,
    language,
    setLanguage,
    activeRole,
    authUserId,
    refreshStudent,
  } = useAuth();
  const { subjects: allowedSubjects } = useAllowedSubjects();

  // Activate Cosmic-LIGHT + student palette for the lifetime of this surface.
  useCosmicLightSurface();

  const [todaysTopic, setTodaysTopic] = useState<CurriculumTopic | undefined>();

  // Recovery affordance for the "logged-in but student momentarily null" state
  // (symptom of an AuthContext race; root cause fixed separately). Re-runs the
  // profile fetch; falls back to a hard reload if no refresh fn is wired.
  const [retrying, setRetrying] = useState(false);
  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      if (typeof refreshStudent === 'function') {
        await refreshStudent();
      } else {
        window.location.reload();
      }
    } catch {
      window.location.reload();
    } finally {
      setRetrying(false);
    }
  }, [refreshStudent]);

  // Pending guardian-link requests awaiting this student's consent. The card
  // self-hides when the list is empty (PendingLinkApproval returns null), so
  // there is zero visual cost when nothing is pending. Fail-soft: a fetch
  // error leaves the list empty and never blocks the dashboard (P15).
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);

  const loadPendingLinks = useCallback(async () => {
    if (!authUserId) return;
    const links = await getPendingParentLinks(authUserId);
    setPendingLinks(links);
  }, [authUserId]);

  useEffect(() => {
    void loadPendingLinks();
  }, [loadPendingLinks]);

  // ─── Auth + role redirects (same semantics as the legacy dashboard) ──────
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
    if (!isLoading && isLoggedIn && activeRole === 'teacher') router.replace('/teacher');
    if (!isLoading && isLoggedIn && activeRole === 'guardian') router.replace('/parent');
    if (!isLoading && isLoggedIn && activeRole === 'institution_admin') router.replace('/school-admin');
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

  // Resolve today's next topic for the mission hero CTA.
  useEffect(() => {
    if (!student) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await getNextTopics(student.id, student.preferred_subject, student.grade);
        if (!cancelled) setTodaysTopic(next[0]);
      } catch {
        /* non-fatal — hero falls back to a generic CTA */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on the primitive student fields (not the object) to avoid a
    // refetch loop on every render — same pattern as AtlasDashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, student?.preferred_subject, student?.grade]);

  // ─── Explicit loading / error / empty gating (was a single conflated gate) ──
  // 1. Genuinely loading → skeleton.
  if (isLoading) return <DashboardSkeleton />;

  // 2. Logged in but profile failed to resolve → actionable recovery surface
  //    instead of an infinite skeleton (the bug symptom). Bilingual (P7).
  if (isLoggedIn && !student) {
    return (
      <div
        className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 text-center"
        role="alert"
      >
        <p
          className="text-base font-semibold max-w-xs"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
        >
          {isHi
            ? 'हम आपकी प्रोफ़ाइल लोड नहीं कर पाए। पुनः प्रयास करें।'
            : "We couldn't load your profile. Tap to retry."}
        </p>
        <button
          type="button"
          onClick={() => void handleRetry()}
          disabled={retrying}
          aria-busy={retrying}
          className="text-sm font-bold px-5 py-2.5 rounded-full transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60"
          style={{ background: 'var(--accent-warm, #E8581C)', color: '#fff', minHeight: 44 }}
        >
          {retrying
            ? isHi
              ? 'प्रयास हो रहा है…'
              : 'Retrying…'
            : isHi
              ? 'पुनः प्रयास करें'
              : 'Retry'}
        </button>
      </div>
    );
  }

  // 3. Not logged in → the redirect effect above is already navigating to
  //    /login; show the skeleton for that brief window (matches prior behavior).
  if (!student) return <DashboardSkeleton />;

  const firstName = student.name.split(' ')[0] || student.name;
  const streak = snapshot?.current_streak ?? 0;
  const totalXp = student.xp_total ?? snapshot?.total_xp ?? 0;
  const subjectCode = student.preferred_subject ?? 'science';

  // Subject display-name → code map so roadmap node taps deep-link Foxy
  // (get_mastery_overview returns the subject NAME; Foxy URL-context wants the
  // CODE). Built from the allowed-subjects service hook.
  const subjectCodeByName: Record<string, string> = {};
  for (const s of allowedSubjects) subjectCodeByName[s.name] = s.code;

  // Compact header rail — greeting + streak + demoted XP + language toggle.
  const headerRail = (
    <div className="flex items-center gap-3 px-4 py-4 w-full">
      <div className="flex-1 min-w-0">
        <p
          className="text-xl font-extrabold truncate"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
        >
          {isHi ? `नमस्ते, ${firstName}` : `Hi, ${firstName}`}
        </p>
        <p className="text-sm" style={{ color: 'var(--text-3)' }}>
          {isHi ? 'आज क्या सीखें?' : 'What will you master today?'}
        </p>
      </div>

      <StreakBadge count={streak} compact />

      {/* XP demoted to a small glanceable warm chip. Warm tints route through
          the stable --accent-warm channel (--orange-rgb is violet here). */}
      <span
        className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full"
        style={{
          background: 'rgb(var(--accent-warm-rgb) / 0.08)',
          color: 'var(--accent-warm, #E8581C)',
          border: '1px solid rgb(var(--accent-warm-rgb) / 0.18)',
        }}
        aria-label={isHi ? `कुल ${totalXp} XP` : `${totalXp} total XP`}
      >
        <span style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
          {totalXp.toLocaleString('en-IN')}
        </span>
        <span style={{ opacity: 0.7 }}>XP</span>
      </span>

      <button
        type="button"
        onClick={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
        aria-label={isHi ? 'Switch to English' : 'हिन्दी में बदलें'}
        className="text-xs font-bold px-2.5 py-1 rounded-full transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{ background: 'var(--surface-2)', color: 'var(--text-2)', minHeight: 32 }}
      >
        {isHi ? 'EN' : 'हि'}
      </button>
    </div>
  );

  return (
    <AppShell
      variant="split"
      className="student-os-shell"
      header={headerRail}
      oneHandToggle
      rail={
        // Tablet+ left rail: the mastery snapshot lives here so "where am I?"
        // sits alongside "what now?".
        <div className="p-2">
          <MasterySnapshot isHi={isHi} studentId={student.id} />
        </div>
      }
      aside={
        // Desktop-only right aside: the secondary revision surface.
        <div className="p-2">
          <RevisionRail isHi={isHi} studentId={student.id} />
        </div>
      }
    >
      <div className="flex flex-col gap-5 px-4 pt-2 pb-6">
        {/* 0. Pending parent-link consent — first actionable thing the child
            sees when a parent has requested a link. Self-hides when empty
            (bilingual handled inside the component, P7). */}
        <PendingLinkApproval links={pendingLinks} onApproved={loadPendingLinks} isHi={isHi} />

        {/* 1. PRIMARY hero — single dominant CTA. */}
        <TodaysMission
          isHi={isHi}
          studentName={student.name}
          grade={student.grade}
          subjectCode={subjectCode}
          todaysTopic={todaysTopic}
        />

        {/* 2. Mastery snapshot — repeated in the content column on mobile
            (the rail is hidden below tablet), hidden on tablet+ where the rail
            shows it. CSS handles the visibility so there's no duplicate render
            cost beyond markup. */}
        <div className="student-os-snapshot-inline lg:hidden">
          <MasterySnapshot isHi={isHi} studentId={student.id} />
        </div>

        {/* 3. BoardScore™ — self-gating via ff_board_score_v1 (widget renders
             a 'Coming Soon' teaser when flag is OFF, full prediction when ON). */}
        <BoardScoreWidget isHi={isHi} studentId={student.id} />

        {/* 4. Revision rail — inline on mobile/tablet, in the aside on desktop. */}
        <div className="student-os-revision-inline xl:hidden">
          <RevisionRail isHi={isHi} studentId={student.id} />
        </div>

        {/* 5. Subject roadmaps — the mastery-centric skill trees. */}
        <SubjectRoadmaps
          isHi={isHi}
          studentId={student.id}
          subjectCodeByName={subjectCodeByName}
        />
      </div>
    </AppShell>
  );
}
