'use client';

/**
 * StudentOSDashboard — the "Alfa OS" flagship redesign of the student landing
 * (formerly gated by ff_student_os_v1). This is now the ONLY /dashboard
 * implementation — page.tsx renders it unconditionally (no flag dispatch).
 * The legacy AtlasDashboard has been deleted.
 *
 * Design philosophy: decision-first, mastery-centric. The page answers "what
 * should I do right now?" before anything else.
 *
 *   1. Compact header rail   — greeting + StreakBadge + XP (demoted, glanceable).
 *   2. PRIMARY hero          — <TodaysMission>, the single dominant CTA. It
 *                              reads /api/v2/today's resolver output (the
 *                              learner-loop queue); its headline derives from
 *                              the queue primary's chapter title, never a
 *                              parallel getNextTopics client chain (RCA W1).
 *   3. <MasterySnapshot>     — Mastered / Learning / Needs-Revision buckets.
 *   4. <BoardScoreWidget>    — BoardScore™ predictive board-exam marks (ff_board_score_v1).
 *                              Gauge + coverage in first paint; chapter breakdown
 *                              and recovery plan collapsed behind one disclosure
 *                              (2026-08-06 declutter).
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
import { supabase, getPendingParentLinks } from '@alfanumrik/lib/supabase';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';
import { useCosmicLightSurface } from '@alfanumrik/lib/use-cosmic-light-surface';
import { useTodayQueue } from '@alfanumrik/lib/today/use-today-queue';
import { DashboardSkeleton } from '@alfanumrik/ui/Skeleton';
import { AppShell } from '@alfanumrik/ui/responsive';
import { StreakBadge } from '@alfanumrik/ui/ui';
import TodaysMission from '@alfanumrik/ui/dashboard/os/TodaysMission';
import MasterySnapshot from '@alfanumrik/ui/dashboard/os/MasterySnapshot';
import RevisionRail from '@alfanumrik/ui/dashboard/os/RevisionRail';
import SubjectRoadmaps from '@alfanumrik/ui/dashboard/os/SubjectRoadmaps';
import BoardScoreWidget from '@alfanumrik/ui/dashboard/os/BoardScoreWidget';
import PendingLinkApproval, { type PendingLink } from '@alfanumrik/ui/dashboard/PendingLinkApproval';
// Phase 4 U1: tap-gated "Ask Foxy" embed. The launcher renders a compact CTA
// button on first paint; the FoxyPanel module is dynamic-imported (ssr:false)
// only when the student taps. First-load JS delta ≈ 0.
import FoxyPanelLauncher from '@alfanumrik/ui/foxy-launcher/FoxyPanelLauncher';
import {
  WARM_08,
  WARM_18,
  WARM_STRONG,
  ACCENT_SURFACE,
  ON_ACCENT,
} from '@alfanumrik/ui/dashboard/os/palette';

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

  // Recovery affordance for the "logged-in but student momentarily null" state
  // (symptom of an AuthContext race; root cause fixed separately). Re-runs the
  // profile fetch; falls back to a hard reload if no refresh fn is wired.
  const [retrying, setRetrying] = useState(false);
  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      // Re-trigger bootstrap to create the missing profile (not just re-fetch).
      // The bootstrap route is idempotent — safe to call even if profile exists.
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (token && authUserId) {
        const { data: { user } } = await supabase.auth.getUser();
        const meta = user?.user_metadata ?? {};
        await fetch('/api/auth/bootstrap', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            role: meta.role || 'student',
            name: meta.name || 'Student',
            grade: meta.grade || '9',
            board: meta.board || 'CBSE',
          }),
        });
      }
      // Then refresh student data from DB
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
  }, [refreshStudent, authUserId]);

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

  // Today's queue — single source of truth for the hero's primary action AND
  // the Foxy embed's chapter context (RCA W1: the legacy getNextTopics client
  // chain — 4-5 sequential PostgREST round-trips — is deleted; the queue the
  // resolver already computes carries chapterTitle/chapterNumber). SWR dedupes
  // against TodaysMission's identical key, so this adds zero network requests.
  const { data: queueData } = useTodayQueue(student?.id);
  const heroChapter = queueData?.primary?.chapterTitle ?? null;

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
          className="text-fluid-base font-semibold max-w-xs"
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
          className="inline-flex items-center justify-center min-h-tap-min text-fluid-sm font-bold px-5 py-2.5 rounded-full transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-70"
          style={{
            // AA-verified CTA pairing. This was #fff on bare --accent-warm
            // (#E8581C) = 3.59:1 — a fail, on the one control that recovers a
            // student whose profile did not load.
            background: ACCENT_SURFACE,
            color: ON_ACCENT,
          }}
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
  //
  // TWO ROWS on purpose. All four of these used to share one 360 px row, which
  // left the greeting column ~130 px wide: the English sub-line ("What will you
  // master today?") wrapped to three lines and the Hindi greeting truncated
  // mid-word. Identity now owns row 1 and the glanceable stats own row 2, so
  // neither has to shrink.
  //
  // `pe-14` on row 1 reserves the slot that AppShell's one-handed-mode toggle
  // occupies. That control is `position: absolute; top: 8px; right: ~16px;
  // 36x36` (globals.css .app-shell-onehand-toggle) and is hidden from 768px up,
  // so on a phone it was landing directly on top of the language toggle — two
  // live controls in the same pixels. `md:pe-0` gives the space back once the
  // toggle is display:none.
  //
  // `dashboard-header-row` / `dashboard-header-greeting` are the hooks
  // globals.css already defines for the compact-on-scroll header (it tightens
  // the row padding and hides the greeting). The dashboard had never opted in,
  // so the header animated down to --shell-header-h-compact with its full-size
  // content still inside it.
  const headerRail = (
    <div className="dashboard-header-row w-full px-4 py-3">
      <div className="dashboard-header-greeting pe-14 md:pe-0">
        <p
          className="text-fluid-xl font-extrabold truncate"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
        >
          {isHi ? `नमस्ते, ${firstName}` : `Hi, ${firstName}`}
        </p>
        <p className="text-fluid-sm truncate" style={{ color: 'var(--text-3)' }}>
          {isHi ? 'आज क्या सीखें?' : 'What will you master today?'}
        </p>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <StreakBadge count={streak} compact />

        {/* XP demoted to a small glanceable warm chip. Warm tints route through
            the stable --accent-warm channel. The number is set in `font-data`
            (Sora — the design system's declared numeric voice); it used to ask
            for `--font-mono`, a token only declared inside the
            html[data-design="cosmic"] scope that this surface removes, so it
            was silently falling back to the OS monospace face. */}
        <span
          className="inline-flex items-center gap-1 text-fluid-2xs font-bold px-2.5 py-1 rounded-full"
          style={{
            background: WARM_08,
            // WARM_STRONG, not WARM: #E8581C on this tint is ~3.5:1 and fails
            // AA for a bold 12px label; #C2440F clears 4.5:1 on the same wash.
            color: WARM_STRONG,
            border: `1px solid ${WARM_18}`,
          }}
          aria-label={isHi ? `कुल ${totalXp} XP` : `${totalXp} total XP`}
        >
          <span className="font-data tabular-nums">
            {totalXp.toLocaleString('en-IN')}
          </span>
          {/* "XP" is content (P7: never translated), not decoration — it was
              dimmed to 70%, which reads ~2.9:1 on the warm chip. */}
          <span>XP</span>
        </span>

        {/* 44x44 in BOTH axes. It carried `minHeight: 44` but only `px-2.5`
            horizontally, so the actual tap box was ~38x44 — under the minimum
            on the narrow axis. */}
        <button
          type="button"
          onClick={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
          aria-label={isHi ? 'Switch to English' : 'हिन्दी में बदलें'}
          className="ms-auto inline-flex items-center justify-center min-w-tap-min min-h-tap-min px-3 text-fluid-xs font-bold rounded-full transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            background: 'var(--surface-2)',
            color: 'var(--text-2)',
            border: '1px solid var(--border)',
          }}
        >
          {isHi ? 'EN' : 'हि'}
        </button>
      </div>
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
        />

        {/* Phase 4 U1: "Ask Foxy" tap-gated launcher next to the hero.
            The panel module is dynamic-imported on first tap only.
            2026-08-06 declutter: wrapper margins tightened so the pill sits
            flush under the hero instead of floating in its own row. */}
        <div className="mt-1 mb-1 flex justify-start">
          <FoxyPanelLauncher
            subject={subjectCode || 'science'}
            grade={student.grade}
            chapter={heroChapter}
            mode="doubt"
            context="today"
            isHi={isHi}
            language={isHi ? 'hi' : 'en'}
            studentId={student.id}
            studentName={student.name}
            style={{
              // Deliberately the SECONDARY treatment: a tinted outline pill
              // against the hero's filled accent action, so the two CTAs sitting
              // 8px apart are not competing. WARM_STRONG keeps the label legible
              // on the wash (bare --accent-warm is ~3.5:1 here).
              background: WARM_08,
              color: WARM_STRONG,
              border: `1px solid ${WARM_18}`,
              // FoxyPanelLauncher's default CTA class is `px-4 py-2 text-sm`,
              // which computes to a ~36px tall button — under the 44px minimum
              // on a phone. The launcher spreads this style onto that button,
              // so the floor can be applied from here without touching the
              // shared component. (A durable fix belongs in the launcher — see
              // the handoff note.)
              minHeight: 'var(--tap-min)',
            }}
          />
        </div>

        {/* 2. Mastery snapshot — repeated in the content column on mobile,
            hidden from tablet up where AppShell's rail shows it instead.
            The rail appears at `min-width: 768px` (globals.css), so this must
            hide at Tailwind `md`, NOT `lg`. It previously hid at `lg:hidden`
            (1024px), which rendered MasterySnapshot TWICE at 768-1023px.
            Note: `student-os-snapshot-inline` has no CSS rule anywhere — it
            is a markup hook only, so the Tailwind class is the sole control. */}
        <div className="student-os-snapshot-inline md:hidden">
          <MasterySnapshot isHi={isHi} studentId={student.id} />
        </div>

        {/* 3. BoardScore™ — self-gating via ff_board_score_v1 (widget renders
             a 'Coming Soon' teaser when flag is OFF, full prediction when ON). */}
        <BoardScoreWidget isHi={isHi} studentId={student.id} />

        {/* 4. Revision rail — inline on mobile/tablet, in the aside on desktop.
            AppShell's aside appears at `min-width: 1024px` (globals.css), so
            this must hide at Tailwind `lg`, NOT `xl`. It previously hid at
            `xl:hidden` (1280px), which rendered RevisionRail TWICE at
            1024-1279px. */}
        <div className="student-os-revision-inline lg:hidden">
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
