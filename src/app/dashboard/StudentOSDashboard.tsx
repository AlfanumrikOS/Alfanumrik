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
 *   4. <RevisionRail>        — secondary spaced-repetition surface (reuses
 *                              ReviewsDueCard + useReviewCards).
 *   5. <SubjectRoadmaps>     — per-subject skill trees (SkillTree primitive).
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

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getNextTopics } from '@/lib/supabase';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import { useCosmicLightSurface } from '@/lib/use-cosmic-light-surface';
import { DashboardSkeleton } from '@/components/Skeleton';
import { AppShell } from '@/components/responsive';
import { StreakBadge } from '@/components/ui';
import type { CurriculumTopic } from '@/lib/types';
import TodaysMission from '@/components/dashboard/os/TodaysMission';
import MasterySnapshot from '@/components/dashboard/os/MasterySnapshot';
import RevisionRail from '@/components/dashboard/os/RevisionRail';
import SubjectRoadmaps from '@/components/dashboard/os/SubjectRoadmaps';

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
  } = useAuth();
  const { subjects: allowedSubjects } = useAllowedSubjects();

  // Activate Cosmic-LIGHT + student palette for the lifetime of this surface.
  useCosmicLightSurface();

  const [todaysTopic, setTodaysTopic] = useState<CurriculumTopic | undefined>();

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

  if (isLoading || !student) return <DashboardSkeleton />;

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

      {/* XP demoted to a small glanceable chip. */}
      <span
        className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full"
        style={{
          background: 'rgba(232,88,28,0.08)',
          color: 'var(--orange, #E8581C)',
          border: '1px solid rgba(232,88,28,0.15)',
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

        {/* 3. Revision rail — inline on mobile/tablet, in the aside on desktop. */}
        <div className="student-os-revision-inline xl:hidden">
          <RevisionRail isHi={isHi} studentId={student.id} />
        </div>

        {/* 4. Subject roadmaps — the mastery-centric skill trees. */}
        <SubjectRoadmaps
          isHi={isHi}
          studentId={student.id}
          subjectCodeByName={subjectCodeByName}
        />
      </div>
    </AppShell>
  );
}
