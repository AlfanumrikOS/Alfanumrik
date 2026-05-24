import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, type UserRole } from '@/lib/AuthContext';
import { ROLE_CONFIG } from '@/lib/constants';
import { useDashboardData, useFeatureFlags } from '@/lib/swr';
import { supabase } from '@/lib/supabase';

// Module-level cache: avoid re-querying upcoming_exams on every nav render.
// Keyed by student_id, value is { t: timestamp_ms, v: hasUpcomingExam }.
// TTL: 5 minutes.
const examCache = new Map<string, { t: number; v: boolean }>();

/* ═══ NAVIGATION ARCHITECTURE ═══
 * Research-backed: Duolingo 5-tab model (the gold standard for EdTech)
 * - 5 bottom tabs max on mobile (thumb-zone optimized)
 * - Center position = primary action (Foxy AI tutor)
 * - "More" sheet for secondary features (no hidden features)
 * - Desktop sidebar groups by function with section headers
 * - Every page reachable in ≤ 2 taps
 */

/** Pure helper: determine whether a nav item is grade-locked for a student.
 *  Exported for unit testing the grade-gating policy without rendering the
 *  full nav shell. */
export interface NavGradeGatedItem {
  gradeMin?: number;
  [key: string]: unknown;
}
export function getItemLockForGrade(
  item: NavGradeGatedItem | null | undefined,
  studentGrade: number,
): { locked: boolean; gradeMin?: number } {
  const gMin = item?.gradeMin;
  if (typeof gMin === 'number' && studentGrade < gMin) {
    return { locked: true, gradeMin: gMin };
  }
  return { locked: false };
}

/** Pure helper: is a flag-gated nav item visible? Items without a
 *  flagName are always visible. Items WITH a flagName are visible only
 *  when the flag is enabled. Exported for unit testing the visibility
 *  policy without rendering the full nav shell. */
export interface NavFlagGatedItem {
  flagName?: string;
  [key: string]: unknown;
}
export function isItemVisibleForFlags(
  item: NavFlagGatedItem | null | undefined,
  flags: Record<string, boolean> | undefined | null,
): boolean {
  const name = item?.flagName;
  if (!name) return true;
  return flags?.[name] === true;
}

const CORE_TABS = [
  { href: '/dashboard', icon: '🏠', activeIcon: '🏠', label: 'Home', labelHi: 'होम' },
  { href: '/quiz', icon: '✏️', activeIcon: '✏️', label: 'Practice', labelHi: 'अभ्यास' },
  { href: '/foxy', icon: '🦊', activeIcon: '🦊', label: 'Foxy', labelHi: 'फॉक्सी', isFab: true },
  { href: '/progress', icon: '📈', activeIcon: '📈', label: 'Progress', labelHi: 'प्रगति' },
];

// Phase 5 Study-Menu v2 (now permanent — Phase 6.4 retired the flag).
// Drops /study-plan, /review (Flashcard Review label), and /revise; adds
// /refresh and /exam-prep (latter gated by upcoming-exam). /learn keeps
// its slot but is re-labeled "Library" to match the Study group.
const MORE_ITEMS = [
  { href: '/simulations', icon: '🔬', label: 'STEM Lab', labelHi: 'STEM लैब' },
  { href: '/pyq', icon: '📄', label: 'PYQ Papers', labelHi: 'पिछले साल के प्रश्न', gradeMin: 9 },
  { href: '/mock-exam', icon: '📋', label: 'Mock Exam', labelHi: 'मॉक परीक्षा', gradeMin: 9 },
  { href: '/leaderboard', icon: '🏆', label: 'Leaderboard', labelHi: 'लीडरबोर्ड' },
  { href: '/learn', icon: '📚', label: 'Library', labelHi: 'अध्ययन सामग्री' },
  { href: '/refresh', icon: '🔁', label: 'Refresh', labelHi: 'ताज़ा करो' },
  { href: '/exam-prep', icon: '🎯', label: 'Exam Sprint', labelHi: 'परीक्षा की तैयारी', requiresUpcomingExam: true },
  { href: '/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
  { href: '/notifications', icon: '🔔', label: 'Settings & Notifications', labelHi: 'सेटिंग्स और सूचनाएँ' },
  { href: '/help', icon: '❓', label: 'Help & Support', labelHi: 'सहायता और सपोर्ट' },
  { href: '/support', icon: '📨', label: 'My Tickets', labelHi: 'मेरे टिकट' },
];

// Phase 5 Study-Menu v2 (now permanent — Phase 6.4 retired the flag).
// Collapses the historical 4-item "Review" group down to a 3-item "Study"
// group: Library (was Subjects & Chapters), Refresh (consolidates
// /review + /revise), and Exam Sprint (replaces /study-plan; only shown
// when the student has an upcoming exam within 30 days).
// CEO-approved Hindi labels per spec §10:
//   Study=पढ़ाई, Library=अध्ययन सामग्री, Refresh=ताज़ा करो, Exam Sprint=परीक्षा की तैयारी.
const SIDEBAR_SECTIONS = [
  {
    title: 'Home', titleHi: 'होम',
    items: [
      { href: '/dashboard', icon: '🏠', label: 'Home', labelHi: 'होम' },
      { href: '/foxy', icon: '🦊', label: 'Foxy AI Tutor', labelHi: 'फॉक्सी AI ट्यूटर' },
      { href: '/progress', icon: '📈', label: 'My Progress', labelHi: 'मेरी प्रगति' },
    ],
  },
  {
    title: 'Practice', titleHi: 'अभ्यास',
    items: [
      { href: '/quiz', icon: '✏️', label: 'Practice', labelHi: 'अभ्यास' },
      { href: '/simulations', icon: '🔬', label: 'STEM Lab', labelHi: 'STEM लैब' },
      { href: '/pyq', icon: '📄', label: 'PYQ Papers', labelHi: 'पिछले साल के प्रश्न', gradeMin: 9 },
      { href: '/mock-exam', icon: '📋', label: 'Mock Exam', labelHi: 'मॉक परीक्षा', gradeMin: 9 },
    ],
  },
  {
    title: 'Study', titleHi: 'पढ़ाई',
    items: [
      { href: '/learn',     icon: '📚', label: 'Library',     labelHi: 'अध्ययन सामग्री' },
      { href: '/refresh',   icon: '🔁', label: 'Refresh',     labelHi: 'ताज़ा करो' },
      { href: '/exam-prep', icon: '🎯', label: 'Exam Sprint', labelHi: 'परीक्षा की तैयारी', requiresUpcomingExam: true },
    ],
  },
  {
    title: 'Account', titleHi: 'खाता',
    items: [
      { href: '/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
      { href: '/help', icon: '❓', label: 'Help & Support', labelHi: 'सहायता और सपोर्ट' },
      { href: '/support', icon: '📨', label: 'My Tickets', labelHi: 'मेरे टिकट' },
    ],
  },
];

function getCoreTabs(role: UserRole) {
  if (role === 'teacher') {
    const nav = ROLE_CONFIG.teacher.nav;
    return [
      { href: nav[0].href, icon: nav[0].icon, activeIcon: nav[0].icon, label: nav[0].label, labelHi: nav[0].labelHi },
      { href: nav[1].href, icon: nav[1].icon, activeIcon: nav[1].icon, label: nav[1].label, labelHi: nav[1].labelHi },
      { href: nav[2].href, icon: nav[2].icon, activeIcon: nav[2].icon, label: nav[2].label, labelHi: nav[2].labelHi },
      { href: nav[3].href, icon: nav[3].icon, activeIcon: nav[3].icon, label: nav[3].label, labelHi: nav[3].labelHi },
    ];
  }
  if (role === 'guardian') {
    const nav = ROLE_CONFIG.guardian.nav;
    return [
      { href: nav[0].href, icon: nav[0].icon, activeIcon: nav[0].icon, label: nav[0].label, labelHi: nav[0].labelHi },
      { href: nav[1].href, icon: nav[1].icon, activeIcon: nav[1].icon, label: nav[1].label, labelHi: nav[1].labelHi },
      { href: nav[2].href, icon: nav[2].icon, activeIcon: nav[2].icon, label: nav[2].label, labelHi: nav[2].labelHi },
      { href: nav[3].href, icon: nav[3].icon, activeIcon: nav[3].icon, label: nav[3].label, labelHi: nav[3].labelHi },
    ];
  }
  return CORE_TABS; // default student tabs
}

function getMoreItems(role: UserRole) {
  if (role === 'teacher') {
    const nav = ROLE_CONFIG.teacher.nav;
    return nav.slice(4).map(item => ({
      href: item.href, icon: item.icon, label: item.label, labelHi: item.labelHi,
    }));
  }
  if (role === 'guardian') {
    const nav = ROLE_CONFIG.guardian.nav;
    return nav.slice(4).map(item => ({
      href: item.href, icon: item.icon, label: item.label, labelHi: item.labelHi,
    }));
  }
  // Default student items — Study Menu v2 is now permanent.
  return MORE_ITEMS;
}

function getSidebarSections(role: UserRole) {
  if (role === 'teacher') {
    const nav = ROLE_CONFIG.teacher.nav;
    return [
      {
        title: 'Teaching', titleHi: 'शिक्षण',
        items: nav.slice(0, 4).map(n => ({ href: n.href, icon: n.icon, label: n.label, labelHi: n.labelHi })),
      },
      {
        title: 'Account', titleHi: 'खाता',
        items: nav.slice(4).map(n => ({ href: n.href, icon: n.icon, label: n.label, labelHi: n.labelHi })),
      },
    ];
  }
  if (role === 'guardian') {
    const nav = ROLE_CONFIG.guardian.nav;
    return [
      {
        title: 'Family', titleHi: 'परिवार',
        items: nav.slice(0, 4).map(n => ({ href: n.href, icon: n.icon, label: n.label, labelHi: n.labelHi })),
      },
      {
        title: 'Account', titleHi: 'खाता',
        items: nav.slice(4).map(n => ({ href: n.href, icon: n.icon, label: n.label, labelHi: n.labelHi })),
      },
    ];
  }
  // Default student sections — Study Menu v2 is now permanent.
  return SIDEBAR_SECTIONS;
}

export default function BottomNavComponent() {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const isHi = auth?.isHi ?? false;
  const { roles, activeRole, setActiveRole } = auth;
  const [showMore, setShowMore] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Hick's Law: collapse secondary sidebar sections by default to reduce choices
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({ Account: true });
  const moreSheetRef = useRef<HTMLDivElement>(null);

  // ─── Hide-on-scroll for the mobile bar (visible-mobile-first redesign)
  // rAF-throttled scroll listener that flips a data attribute on the nav.
  // CSS reads the attribute and applies a translateY(110%) hide. Threshold
  // mirrors MobileNav (8px delta to ignore touchpad jitter, always show
  // within 80px of top). Respects prefers-reduced-motion.
  const [navHidden, setNavHidden] = useState(false);
  const lastScrollYRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduced) return;
    const onScroll = () => {
      if (rafIdRef.current != null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const y = window.scrollY;
        const last = lastScrollYRef.current;
        const delta = y - last;
        if (Math.abs(delta) < 8) return;
        if (y < 80) setNavHidden(false);
        else if (delta > 0) setNavHidden(true);
        else setNavHidden(false);
        lastScrollYRef.current = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafIdRef.current != null) window.cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // Focus management and keyboard support for More sheet
  useEffect(() => {
    if (showMore && moreSheetRef.current) {
      const firstButton = moreSheetRef.current.querySelector('button');
      firstButton?.focus();
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showMore) setShowMore(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showMore]);

  // ADR-001 Phase 4 — feature-flag visibility for nav entries (e.g.
  // `/revise` only appears when ff_revise_route_v1 is ON). Items
  // without a flagName are always visible. (ff_study_menu_v2 was retired
  // in Phase 6.4; sidebar + more-sheet shape is now unconditional v2.)
  const { data: navFlags } = useFeatureFlags();

  // Phase 5 Study-Menu v2 — gate the "Exam Sprint" entry on whether the
  // student actually has an upcoming exam in the next 30 days. We default
  // to TRUE so the item shows on first paint (better to show + 404-late
  // than hide a real-CTA on a soft network). The useEffect below queries
  // upcoming_exams once per student-id and caches for 5 minutes.
  const [hasUpcomingExam, setHasUpcomingExam] = useState(true);
  useEffect(() => {
    if (!auth.student?.id) return;
    const studentId = auth.student.id;
    // 5-min in-memory cache
    const cached = examCache.get(studentId);
    if (cached && Date.now() - cached.t < 5 * 60_000) {
      setHasUpcomingExam(cached.v);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const horizon = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
        const { count } = await supabase
          .from('upcoming_exams')
          .select('id', { count: 'exact', head: true })
          .eq('student_id', studentId)
          .gte('exam_date', today)
          .lte('exam_date', horizon);
        const v = (count ?? 0) > 0;
        if (!cancelled) {
          setHasUpcomingExam(v);
          examCache.set(studentId, { t: Date.now(), v });
        }
      } catch { /* non-fatal — keep default true */ }
    })();
    return () => { cancelled = true; };
  }, [auth.student?.id]);

  const tabs = getCoreTabs(activeRole);
  const allSidebarSections = getSidebarSections(activeRole);
  // Grade-gated items (PYQ, Mock Exam: grade 9+) are now SHOWN as visibly locked
  // instead of silently hidden — surfaces future value for younger students. See
  // Phase 5B UX mission: "locked state > missing state".
  const studentGrade = parseInt((auth as any)?.student?.grade ?? '6', 10);
  const getItemLock = (item: any) => getItemLockForGrade(item, studentGrade);
  // Phase 5B Surface 3 — show a proactive Upgrade pill in the More sheet
  // for free-plan students. Pro/starter/unlimited never see it.
  const subscriptionPlan = ((auth as any)?.student?.subscription_plan as string | null | undefined) ?? null;
  const showUpgradePill = activeRole === 'student' && (subscriptionPlan === null || subscriptionPlan === 'free');

  // Phase 5 Study-Menu v2 — drop the Exam Sprint entry from sidebar/more
  // when the student has no exams in the 30-day horizon. We treat
  // `requiresUpcomingExam` like a soft flag: if true and no upcoming exam,
  // the item is hidden entirely (not visibly locked — there's nothing to
  // unlock here, just nothing to prep for).
  const passesExamGate = (item: any): boolean =>
    !(item?.requiresUpcomingExam === true && !hasUpcomingExam);

  // Sidebar SECTION-level gating (rare) still filters the section entirely —
  // a whole-section lockout is too heavy to render as locked items.
  // After filtering sections by gradeMin, we also filter each section's
  // items by their optional flagName and by the exam-gate.
  const sidebarSections = allSidebarSections
    .filter(s => {
      const gMin = (s as any).gradeMin;
      return gMin == null || studentGrade >= gMin;
    })
    .map(section => ({
      ...section,
      items: section.items
        .filter(item => isItemVisibleForFlags(item as NavFlagGatedItem, navFlags))
        .filter(passesExamGate),
    }));
  // More-sheet items: drop flag-gated entries whose flag is off,
  // and drop exam-gated entries when there's no upcoming exam.
  const moreItems = getMoreItems(activeRole)
    .filter(item => isItemVisibleForFlags(item as NavFlagGatedItem, navFlags))
    .filter(passesExamGate);

  // Due-review count for the Review tab badge (SWR-cached — no extra request if dashboard already loaded)
  const { data: dashData } = useDashboardData((auth as any)?.student?.id);
  const dueCount: number = (dashData as any)?.due_count ?? 0;

  // Streak count from snapshot (already loaded in AuthContext — no extra request)
  const streakCount: number = (auth as any)?.snapshot?.current_streak ?? 0;

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href));

  // ─── Focused-Foxy route: suppress the fixed desktop sidebar rail ───
  // /foxy renders its own full-screen chat shell (dark header with a
  // back-arrow, conversation sidebar, subject tabs, chapter list) via
  // <AppShell variant="mobile" bleed>. The global desktop rail is
  // redundant there AND harmful: when the <aside className="sidebar-nav">
  // is in the DOM, the global `body:has(.sidebar-nav) .app-shell` rule
  // (globals.css) reserves a 240px (var(--sidebar-width)) left margin on
  // the root-layout wrapper, leaving a blank gutter and shifting Foxy
  // right. By NOT rendering the aside on /foxy, `body:has(.sidebar-nav)`
  // no longer matches, the margin is removed by the existing CSS, and
  // Foxy paints edge-to-edge. Scoped to /foxy only — every other route
  // keeps its rail and `.app-shell` margin unchanged. Foxy's own
  // back-arrow preserves navigation; the mobile bottom bar is retained
  // (AppShell reserves bottom clearance for it so ChatInput is never
  // overlapped — see src/app/foxy/page.tsx).
  const isFocusedFoxy = pathname === '/foxy' || pathname.startsWith('/foxy');
  // isMoreActive should only consider items the user can actually reach.
  const isMoreActive = moreItems.some(m => !getItemLock(m).locked && isActive(m.href));
  const hasMultipleRoles = roles.length > 1;

  const handleRoleSwitch = (role: UserRole) => {
    setActiveRole(role);
    const config = ROLE_CONFIG[role];
    if (config?.homePath) {
      setShowMore(false);
      router.push(config.homePath);
    }
  };

  return (
    <>
      {/* ─── MORE SHEET (mobile overlay) ──────────────── */}
      {showMore && (
        <>
          <div
            className="fixed inset-0 z-[60]"
            style={{ background: 'rgba(0,0,0,0.3)' }}
            onClick={() => setShowMore(false)}
            role="presentation"
            aria-hidden="true"
          />
          <div
            ref={moreSheetRef}
            role="dialog"
            aria-label="More navigation options"
            className="fixed bottom-0 left-0 right-0 z-[70] rounded-t-3xl"
            style={{
              background: 'var(--surface-1)',
              paddingBottom: 'env(safe-area-inset-bottom, 16px)',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.12)',
            }}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border-mid, #ccc)' }} />
            </div>
            <div className="px-5 pb-4 space-y-1">
              {moreItems.map(item => {
                const lock = getItemLock(item);
                const active = !lock.locked && isActive(item.href);
                const gradeChipLabel = lock.locked
                  ? (isHi ? `कक्षा ${lock.gradeMin}+` : `Grade ${lock.gradeMin}+`)
                  : null;
                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={lock.locked
                      ? undefined
                      : () => { setShowMore(false); router.push(item.href); }}
                    aria-disabled={lock.locked || undefined}
                    aria-label={lock.locked
                      ? `${isHi ? item.labelHi : item.label} — ${isHi ? 'अभी उपलब्ध नहीं' : 'locked'} · ${gradeChipLabel}`
                      : undefined}
                    className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl text-left transition-all active:scale-[0.98]"
                    style={{
                      background: active ? 'rgb(var(--orange-rgb) / 0.08)' : 'transparent',
                      color: lock.locked ? 'var(--text-3)' : (active ? 'var(--orange)' : 'var(--text-2)'),
                      opacity: lock.locked ? 0.75 : 1,
                      cursor: lock.locked ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <span className="text-xl w-7 text-center" aria-hidden="true">{item.icon}</span>
                    <span className="text-sm font-semibold">{isHi ? item.labelHi : item.label}</span>
                    {lock.locked ? (
                      <span
                        className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{
                          background: 'var(--surface-3)',
                          color: 'var(--text-3)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        <span aria-hidden="true">🔒</span>
                        {gradeChipLabel}
                      </span>
                    ) : item.href === '/review' && dueCount > 0 && activeRole === 'student' ? (
                      <span className="ml-auto min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold text-white px-1"
                        style={{ background: '#DC2626' }}>
                        {dueCount > 9 ? '9+' : dueCount}
                      </span>
                    ) : active ? (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: 'var(--orange)' }} />
                    ) : null}
                  </button>
                );
              })}
              {/* Phase 5B Surface 3 — Upgrade pill (free-plan students only) */}
              {showUpgradePill && (
                <div className="pt-3 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
                  <a
                    href="/pricing"
                    onClick={() => {
                      setShowMore(false);
                      if (typeof window !== 'undefined') {
                        try {
                          window.dispatchEvent(new CustomEvent('alfanumrik:upgrade-cta-click', {
                            detail: { source: 'nav_more_sheet', variant: 'pill', timestamp: Date.now() },
                          }));
                        } catch { /* non-blocking */ }
                      }
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple)] focus-visible:ring-offset-2"
                    style={{
                      background: 'linear-gradient(135deg, rgb(var(--purple-rgb) / 0.10), rgb(var(--orange-rgb) / 0.08))',
                      border: '1px solid rgb(var(--purple-rgb) / 0.25)',
                    }}
                    data-testid="nav-upgrade-pill"
                  >
                    <span
                      className="inline-flex items-center justify-center w-8 h-8 rounded-xl shrink-0"
                      style={{
                        background: 'linear-gradient(135deg, var(--purple), var(--purple-light))',
                        color: 'white',
                      }}
                      aria-hidden="true"
                    >
                      ✨
                    </span>
                    <span className="flex flex-col flex-1 min-w-0">
                      <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                        {isHi ? 'प्रीमियम पर अपग्रेड करें' : 'Upgrade to Premium'}
                      </span>
                      <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        {isHi ? 'और चैट, अनलिमिटेड क्विज़' : 'More chats, unlimited quizzes'}
                      </span>
                    </span>
                    <span className="text-xs font-bold" style={{ color: 'var(--purple)' }} aria-hidden="true">→</span>
                  </a>
                </div>
              )}
              {/* Role Switcher for multi-role users */}
              {hasMultipleRoles && (
                <div className="pt-2 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
                  <p className="text-[11px] font-bold text-[var(--text-3)] uppercase tracking-widest px-4 mb-1.5">
                    {isHi ? 'भूमिका बदलें' : 'Switch Role'}
                  </p>
                  {roles.filter(r => r !== 'none').map(role => {
                    const cfg = ROLE_CONFIG[role];
                    const isCurrent = role === activeRole;
                    return (
                      <button
                        key={role}
                        onClick={() => handleRoleSwitch(role)}
                        className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl text-left transition-all active:scale-[0.98]"
                        style={{
                          background: isCurrent ? `${cfg.color}12` : 'transparent',
                          color: isCurrent ? cfg.color : 'var(--text-2)',
                        }}
                      >
                        <span className="text-xl w-7 text-center">{cfg.icon}</span>
                        <span className="text-sm font-semibold">{isHi ? cfg.labelHi : cfg.label}</span>
                        {isCurrent && <span className="ml-auto text-xs px-2 py-0.5 rounded-full" style={{ background: `${cfg.color}20`, color: cfg.color }}>{isHi ? 'सक्रिय' : 'Active'}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ─── Mobile Bottom Nav (refreshed visual, 2026-05-19) ────
         Editorial mobile-first redesign:
           - 5 slots max (tabs + More). Foxy is the center FAB, raised
             above the baseline. Other slots show an orange underline
             when active (CSS slide via .bottom-nav-mobile__slot::after).
           - Active label: bold + orange. Inactive: ink-3 + semibold.
           - safe-area-inset-bottom fallback dropped to 0 (was 6px) so
             the bar sits flush on Android-without-gesture-bar devices
             and lifts naturally over iPhone home indicators.
           - 44px min tap area enforced by .touchable below each slot.
           - rAF-throttled scroll listener (above) drives the
             data-scroll-hidden attribute → translateY(110%) hide. */}
      <nav
        className="bottom-nav-mobile fixed bottom-0 left-0 right-0 z-50"
        aria-label="Main navigation"
        role="navigation"
        data-scroll-hidden={navHidden ? 'true' : 'false'}
        style={{
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div className="flex items-end justify-around px-2 pt-2 pb-1">
          {tabs.map((item) => {
            const active = isActive(item.href);

            /* ── Foxy FAB (center) ── only for student role */
            if (activeRole === 'student' && 'isFab' in item && item.isFab) {
              return (
                <button
                  key={item.href}
                  onClick={() => router.push(item.href)}
                  aria-label={`${isHi ? item.labelHi : item.label} - AI Tutor`}
                  aria-current={active ? 'page' : undefined}
                  className="touchable flex flex-col items-center -mt-3 active:scale-95 transition-transform bg-transparent border-0"
                  style={{ minWidth: 'var(--tap-comfort)' }}
                >
                  <span
                    className="flex items-center justify-center rounded-2xl"
                    style={{
                      width: 52,
                      height: 52,
                      marginTop: -12,
                      background: active
                        ? 'linear-gradient(135deg, var(--accent), var(--gold))'
                        : 'linear-gradient(135deg, var(--accent), #D84315)',
                      boxShadow: '0 8px 20px rgb(var(--orange-rgb) / 0.42)',
                      color: '#fff',
                      fontSize: 26,
                      lineHeight: 1,
                    }}
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>
                  <span
                    className="font-bold mt-1"
                    style={{
                      fontSize: 'var(--text-2xs)',
                      letterSpacing: '0.02em',
                      color: active ? 'var(--accent)' : 'var(--ink-2)',
                    }}
                  >
                    {isHi ? item.labelHi : item.label}
                  </span>
                </button>
              );
            }

            /* ── Regular tabs ──
               - .touchable enforces 44×44 hit area
               - .bottom-nav-mobile__slot enables the CSS underline
               - data-active drives the underline width transition */
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                aria-label={isHi ? item.labelHi : item.label}
                aria-current={active ? 'page' : undefined}
                data-active={active ? 'true' : 'false'}
                className="touchable bottom-nav-mobile__slot flex flex-col items-center gap-0.5 py-1.5 px-2 bg-transparent border-0 relative"
                style={{
                  color: active ? 'var(--accent)' : 'var(--ink-3)',
                  minWidth: 'var(--tap-comfort)',
                }}
              >
                <span
                  className="relative inline-block"
                  style={{
                    fontSize: 22,
                    lineHeight: 1,
                    transform: active ? 'translateY(-1px) scale(1.06)' : 'scale(1)',
                    transition: 'transform 200ms cubic-bezier(.22,1,.36,1)',
                    filter: active ? 'drop-shadow(0 0 6px rgb(var(--orange-rgb) / 0.3))' : 'none',
                  }}
                  aria-hidden="true"
                >
                  {active ? item.activeIcon : item.icon}
                  {/* Streak badge on Home tab */}
                  {item.href === '/dashboard' && streakCount > 0 && activeRole === 'student' && (
                    <span
                      className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[16px] rounded-full flex items-center justify-center text-[9px] font-bold px-0.5"
                      style={{
                        background: '#F59E0B',
                        color: '#fff',
                        border: '1.5px solid var(--bg)',
                      }}
                      aria-label={`${streakCount} day streak`}
                    >
                      {streakCount}
                    </span>
                  )}
                </span>
                <span
                  className="tracking-wide"
                  style={{
                    fontSize: 'var(--text-2xs)',
                    fontWeight: active ? 700 : 600,
                    letterSpacing: '0.02em',
                  }}
                >
                  {isHi ? item.labelHi : item.label}
                </span>
              </button>
            );
          })}

          {/* ── More button (replaces hidden items) ── */}
          <button
            onClick={() => setShowMore(!showMore)}
            aria-label={isHi ? 'अधिक विकल्प' : 'More options'}
            aria-expanded={showMore}
            data-active={isMoreActive ? 'true' : 'false'}
            className="touchable bottom-nav-mobile__slot flex flex-col items-center gap-0.5 py-1.5 px-2 bg-transparent border-0 relative"
            style={{
              color: isMoreActive ? 'var(--accent)' : 'var(--ink-3)',
              minWidth: 'var(--tap-comfort)',
            }}
          >
            <span
              aria-hidden="true"
              style={{ fontSize: 22, lineHeight: 1 }}
            >
              &#x2630;
            </span>
            <span
              className="tracking-wide"
              style={{
                fontSize: 'var(--text-2xs)',
                fontWeight: isMoreActive ? 700 : 600,
                letterSpacing: '0.02em',
              }}
            >
              {isHi ? 'और' : 'More'}
            </span>
          </button>
        </div>
      </nav>

      {/* ─── Desktop Sidebar ──────────────── */}
      {/* Suppressed on the focused-Foxy route so the global
          `body:has(.sidebar-nav) .app-shell` margin-left rule stops
          matching and Foxy paints full-width (see isFocusedFoxy above). */}
      {!isFocusedFoxy && <aside
        className={`sidebar-nav flex-col border-r ${collapsed ? 'sidebar-collapsed' : ''}`}
        style={{
          background: 'var(--surface-1)',
          borderColor: 'var(--border)',
          width: collapsed ? '56px' : 'var(--sidebar-width)',
          height: '100dvh',
          position: 'fixed',
          top: 0,
          left: 0,
          zIndex: 50,
          padding: collapsed ? '20px 6px' : '20px 12px',
          justifyContent: 'space-between',
          overflowY: 'auto',
          overflowX: 'hidden',
          transition: 'width 0.25s ease, padding 0.25s ease',
        }}
      >
        {/* Brand */}
        <div>
          <button
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-2.5 px-3 mb-6 transition-opacity hover:opacity-80"
          >
            <span className="text-2xl">🦊</span>
            {!collapsed && <div>
              <div className="text-base font-bold gradient-text" style={{ fontFamily: 'var(--font-display)' }}>
                Alfanumrik
              </div>
              <div className="text-[11px] text-[var(--text-3)] -mt-0.5">AI Learning OS</div>
            </div>}
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar menu' : 'Collapse sidebar menu'}
            className="w-full flex items-center justify-center py-2 mb-2 rounded-lg transition-all hover:bg-[var(--surface-2)]"
            style={{ color: 'var(--text-3)' }}
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
          >
            <span style={{ fontSize: 12 }}>{collapsed ? '\u00BB' : '\u00AB'}</span>
          </button>

          {/* Grouped Nav Sections — secondary sections collapsible (Hick's Law) */}
          <div className="space-y-5">
            {sidebarSections.map(section => {
              const isSectionCollapsed = !collapsed && collapsedSections[section.title];
              const hasActiveItem = section.items.some(item => !getItemLock(item).locked && isActive(item.href));
              return (
              <div key={section.title}>
                {!collapsed && <button
                  onClick={() => setCollapsedSections(prev => ({ ...prev, [section.title]: !prev[section.title] }))}
                  className="w-full flex items-center justify-between text-[11px] font-bold text-[var(--text-3)] uppercase tracking-widest px-3 mb-1.5 hover:text-[var(--text-2)] transition-colors"
                  aria-expanded={!isSectionCollapsed}
                >
                  <span>{isHi ? section.titleHi : section.title}</span>
                  <span className="text-[9px] transition-transform" style={{ transform: isSectionCollapsed ? 'rotate(-90deg)' : 'rotate(0)' }}>
                    {isSectionCollapsed ? '▶' + (hasActiveItem ? ' •' : '') : '▼'}
                  </span>
                </button>}
                {!isSectionCollapsed && <div className="space-y-0.5">
                  {section.items.map(item => {
                    const lock = getItemLock(item);
                    const active = !lock.locked && isActive(item.href);
                    const isFoxy = item.href === '/foxy';
                    const isReview = item.href === '/review';
                    const showReviewBadge = !lock.locked && isReview && dueCount > 0 && activeRole === 'student';
                    const gradeChipLabel = lock.locked
                      ? (isHi ? `कक्षा ${lock.gradeMin}+` : `Grade ${lock.gradeMin}+`)
                      : null;
                    return (
                      <button
                        key={item.href}
                        type="button"
                        onClick={lock.locked ? undefined : () => router.push(item.href)}
                        aria-disabled={lock.locked || undefined}
                        aria-label={lock.locked
                          ? `${isHi ? item.labelHi : item.label} — ${isHi ? 'अभी उपलब्ध नहीं' : 'locked'} · ${gradeChipLabel}`
                          : undefined}
                        title={lock.locked && !collapsed
                          ? (isHi ? `कक्षा ${lock.gradeMin} में अनलॉक होगा` : `Unlocks in grade ${lock.gradeMin}`)
                          : undefined}
                        className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all"
                        style={{
                          background: active
                            ? isFoxy ? 'rgb(var(--orange-rgb) / 0.12)' : 'rgb(var(--orange-rgb) / 0.06)'
                            : 'transparent',
                          color: lock.locked ? 'var(--text-3)' : (active ? 'var(--orange)' : 'var(--text-2)'),
                          fontWeight: active ? 600 : 500,
                          fontSize: '14px',
                          opacity: lock.locked ? 0.7 : 1,
                          cursor: lock.locked ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <span className="text-lg w-6 text-center" aria-hidden="true">{item.icon}</span>
                        {!collapsed && <span>{isHi ? item.labelHi : item.label}</span>}
                        {lock.locked && !collapsed ? (
                          <span
                            className="ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                            style={{
                              background: 'var(--surface-3)',
                              color: 'var(--text-3)',
                              border: '1px solid var(--border)',
                            }}
                          >
                            <span aria-hidden="true">🔒</span>
                            {gradeChipLabel}
                          </span>
                        ) : showReviewBadge && !collapsed ? (
                          <span className="ml-auto min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold text-white px-1"
                            style={{ background: '#DC2626' }}>
                            {dueCount > 9 ? '9+' : dueCount}
                          </span>
                        ) : active && !collapsed ? (
                          <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: 'var(--orange)' }} />
                        ) : null}
                      </button>
                    );
                  })}
                </div>}
              </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-3 pt-4 mt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          {collapsed ? <div className="text-center text-lg">🦊</div> : <div className="text-[11px] text-[var(--text-3)] leading-relaxed">
            <div>Alfanumrik Adaptive Learning OS</div>
            <div className="mt-0.5">Cusiosense Learning India Pvt Ltd</div>
          </div>}
        </div>
      </aside>}
    </>
  );
}
