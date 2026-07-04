'use client';

/**
 * StudentOSDashboard — the "Alfa OS" flagship redesign of the student landing
 * (ff_student_os_v1). Renders ONLY when the flag resolves ON; the legacy
 * AtlasDashboard renders otherwise (see page.tsx for the flag dispatch).
 *
 * Design philosophy: decision-first, mastery-centric. The page answers "what
 * should I do right now?" before anything else. Phase 3a rebuilt the frame on
 * canonical primitives (DD-16) with strict above-the-fold discipline.
 *
 * ABOVE THE FOLD (exactly ONE primary action):
 *   1. Header rail   — Avatar + greeting + Badge(streak/XP) + language toggle.
 *   2. Pending link  — <PendingLinkApproval> consent (self-hides when empty).
 *   3. PRIMARY hero  — <TodaysMission>, the single dominant CTA + WHY line.
 *   4. Growth strip  — <GrowthStrip>, the "what improved" positive signal.
 *
 * BELOW THE FOLD (demoted glance panels — retained AS-IS, Phase 3b rebuilds):
 *   <MasterySnapshot> · <BoardScoreWidget> · <RevisionRail> · <SubjectRoadmaps>.
 *
 * This is a PRESENTATION layer over unchanged engines. No scoring/XP/mastery
 * formula is computed here — every number comes from the existing snapshot /
 * useMasteryOverview / today outputs. Rendered under Cosmic-LIGHT + student
 * palette via useCosmicLightSurface (dark mode is killed for this surface).
 *
 * Shell (D1 fix): AppShell variant="mobile" reserves NO left rail — the global
 * DesktopSidebar is the sole left rail (variant="split" previously
 * double-rendered a left column). Single content column at every width.
 *
 * Bilingual via AuthContext.isHi. Loading / empty handled per child.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getNextTopics, getPendingParentLinks } from '@/lib/supabase';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import { useCosmicLightSurface } from '@/lib/use-cosmic-light-surface';
import { DashboardSkeleton } from '@/components/Skeleton';
import { AppShell } from '@/components/responsive';
import { Avatar, Badge, Button, IconButton } from '@/components/ui/primitives';
import type { CurriculumTopic } from '@/lib/types';
import TodaysMission from '@/components/dashboard/os/TodaysMission';
import GrowthStrip from '@/components/dashboard/os/GrowthStrip';
import MasterySnapshot from '@/components/dashboard/os/MasterySnapshot';
import RevisionRail from '@/components/dashboard/os/RevisionRail';
import SubjectRoadmaps from '@/components/dashboard/os/SubjectRoadmaps';
import BoardScoreWidget from '@/components/dashboard/os/BoardScoreWidget';
import PendingLinkApproval, { type PendingLink } from '@/components/dashboard/PendingLinkApproval';

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
        className="flex flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ minHeight: '60vh' }}
        role="alert"
      >
        <p
          className="max-w-xs text-fluid-base font-semibold text-foreground"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {isHi
            ? 'हम आपकी प्रोफ़ाइल लोड नहीं कर पाए। पुनः प्रयास करें।'
            : "We couldn't load your profile. Tap to retry."}
        </p>
        <Button
          variant="primary"
          loading={retrying}
          onClick={() => void handleRetry()}
        >
          {retrying
            ? isHi
              ? 'प्रयास हो रहा है…'
              : 'Retrying…'
            : isHi
              ? 'पुनः प्रयास करें'
              : 'Retry'}
        </Button>
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

  // Compact header rail — avatar + greeting + glanceable streak/XP badges +
  // language toggle. All chrome (colour, on-accent, 44px, focus) is owned by
  // the canonical primitives; this rail carries no hardcoded colours (DD-16).
  const headerRail = (
    <div className="flex w-full items-center gap-3 px-4 py-4">
      <Avatar name={firstName} alt={firstName} size="md" />

      <div className="min-w-0 flex-1">
        <p
          className="truncate text-fluid-lg font-extrabold text-foreground"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {isHi ? `नमस्ते, ${firstName}` : `Hi, ${firstName}`}
        </p>
        <p className="text-fluid-sm text-muted-foreground">
          {isHi ? 'आज क्या सीखें?' : 'What will you master today?'}
        </p>
      </div>

      <Badge
        tone="warning"
        variant="soft"
        icon={<span aria-hidden="true">🔥</span>}
        aria-label={isHi ? `${streak} दिन की लय` : `${streak}-day streak`}
      >
        <span className="tabular-nums">{streak}</span>
      </Badge>

      <Badge
        tone="warning"
        variant="soft"
        icon={<span aria-hidden="true">⚡</span>}
        aria-label={isHi ? `कुल ${totalXp} XP` : `${totalXp} total XP`}
      >
        <span className="tabular-nums">{totalXp.toLocaleString('en-IN')}</span>
        <span className="ms-1 opacity-70">XP</span>
      </Badge>

      <IconButton
        variant="ghost"
        size="sm"
        label={isHi ? 'Switch to English' : 'हिन्दी में बदलें'}
        icon={<span className="text-fluid-xs font-bold">{isHi ? 'EN' : 'हि'}</span>}
        onClick={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
      />
    </div>
  );

  return (
    // D1 fix: content-only shell. The global DesktopSidebar is the SOLE left
    // rail; AppShell no longer renders its own rail/aside (variant="split" was
    // double-rendering a left column). MasterySnapshot + RevisionRail move into
    // the demoted below-fold region until Phase 3b rebuilds those glance panels.
    <AppShell
      variant="mobile"
      className="student-os-shell"
      header={headerRail}
      oneHandToggle
    >
      <div className="flex flex-col gap-5 px-4 pt-2 pb-6">
        {/* ═══ ABOVE THE FOLD — exactly ONE primary action ═══ */}

        {/* Pending parent-link consent — first actionable thing the child sees
            when a parent has requested a link. Self-hides when empty (P7). */}
        <PendingLinkApproval links={pendingLinks} onApproved={loadPendingLinks} isHi={isHi} />

        {/* PRIMARY hero — the single dominant "do this now". */}
        <TodaysMission
          isHi={isHi}
          studentName={student.name}
          grade={student.grade}
          subjectCode={subjectCode}
          todaysTopic={todaysTopic}
        />

        {/* GROWTH strip — the "what improved" positive signal, directly under
            the primary action. Read-only over server values (P1/P2 untouched). */}
        <GrowthStrip
          isHi={isHi}
          studentId={student.id}
          streak={streak}
          totalXp={totalXp}
        />

        {/* ═══ BELOW THE FOLD — demoted glance panels (Phase 3b rebuilds) ═══
            Retained AS-IS for now; visually demoted behind a divider so the
            above-the-fold keeps a single primary CTA. */}
        <section
          aria-label={isHi ? 'तुम्हारी प्रगति एक नज़र में' : 'Your progress at a glance'}
          className="mt-3 flex flex-col gap-5 border-t border-surface-3 pt-5"
        >
          <MasterySnapshot isHi={isHi} studentId={student.id} />

          {/* BoardScore™ self-gates via ff_board_score_v1 (teaser when OFF). */}
          <BoardScoreWidget isHi={isHi} studentId={student.id} />

          <RevisionRail isHi={isHi} studentId={student.id} />

          {/* Subject roadmaps — the mastery-centric skill trees. */}
          <SubjectRoadmaps
            isHi={isHi}
            studentId={student.id}
            subjectCodeByName={subjectCodeByName}
          />
        </section>
      </div>
    </AppShell>
  );
}
