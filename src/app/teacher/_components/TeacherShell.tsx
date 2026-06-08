'use client';

/**
 * TeacherShell — branded sidebar layout for the teacher portal (Plan 1 Task 1).
 *
 * Composes the shared `<DashboardSidebar>` primitive from
 * `@/components/admin-ui` and supplies tenant-aware branding plus
 * module-gated nav entries.
 *
 * Behaviour parity with `SchoolAdminShell`:
 * - Bilingual nav labels via `useAuth().isHi`.
 * - Module enablement via `/api/teacher/modules` — fail-open on 4xx/5xx so a
 *   broken/missing endpoint never hides legitimate nav. (The route ships in
 *   this same task; the shell still works without it.)
 * - Tenant branding (school name + logo + primary color) via `useTenant()`.
 *
 * Role gate:
 * The shell renders children unwrapped when the visitor isn't an
 * authenticated teacher (e.g. login screens, mid-bootstrap, or wrong-role
 * users en route to a redirect). Wrapping a non-teacher view in a teacher
 * shell would be confusing UX. Pages handle their own login redirects; the
 * shell just stays out of the way until the role is confirmed.
 *
 * Note on theming:
 * The teacher portal pages use a dark surface (`bg-[#0B1120]`). The shared
 * sidebar uses semantic tokens (`bg-surface-1`) which auto-adapt to the
 * `data-theme` attribute. We leave the default sidebar background; if
 * visual smoke (Task 2.2) shows a contrast issue, override via
 * `className="!bg-slate-900 !border-slate-800"` on the DashboardSidebar.
 */

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import useSWR from 'swr';
import { useAuth } from '@/lib/AuthContext';
import { useTenant } from '@/lib/tenant-context';
import { supabase } from '@/lib/supabase';
import DashboardSidebar, { type SidebarNavItem } from '@/components/admin-ui/DashboardSidebar';
import type { ModuleKey } from '@/lib/modules/registry';
import { useAtlasFlag } from '@/lib/use-atlas-flag';
import { useTeacherCommandCenter } from '@/lib/use-teacher-command-center';
import { useCosmicTheme } from '@/lib/cosmic-theme';
import { Starfield } from '@/components/cosmic';

type TeacherNavItem = {
  href: string;
  label: string;
  labelHi: string;
  icon: string;
  /** When set: hide this item if the module is disabled for this tenant. */
  moduleKey?: ModuleKey;
};

// Polling cadence for the Messages tab unread badge. Conservative (60s) —
// the /teacher/messages page itself polls thread list at 30s, so the badge
// doesn't need to be tighter.
const MESSAGES_BADGE_POLL_MS = 60_000;

interface TeacherThreadsResponse {
  success: boolean;
  unreadTotal: number;
}

async function messagesBadgeFetcher(url: string): Promise<TeacherThreadsResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch {
    /* anonymous — server returns 401, badge stays 0 */
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`teacher-messages.badge_fetch_failed:${res.status}`);
  return res.json() as Promise<TeacherThreadsResponse>;
}

const NAV_ITEMS: ReadonlyArray<TeacherNavItem> = [
  { href: '/teacher', label: 'Dashboard', labelHi: 'डैशबोर्ड', icon: '▦' },
  { href: '/teacher/classes', label: 'Classes', labelHi: 'कक्षाएं', icon: '⊞' },
  { href: '/teacher/students', label: 'Students', labelHi: 'छात्र', icon: '⊕' },
  { href: '/teacher/assignments', label: 'Assignments', labelHi: 'असाइनमेंट', icon: '⊠', moduleKey: 'assignments' },
  { href: '/teacher/submissions', label: 'Submissions', labelHi: 'सबमिशन', icon: '⊞', moduleKey: 'assignments' },
  { href: '/teacher/grade-book', label: 'Grade Book', labelHi: 'ग्रेड बुक', icon: '⊟', moduleKey: 'assignments' },
  { href: '/teacher/messages', label: 'Messages', labelHi: 'संदेश', icon: '✉' },
  { href: '/teacher/worksheets', label: 'Worksheets', labelHi: 'वर्कशीट', icon: '⊡', moduleKey: 'lms' },
  { href: '/teacher/reports', label: 'Reports', labelHi: 'रिपोर्ट', icon: '⊘', moduleKey: 'analytics' },
  { href: '/teacher/lab-leaderboard', label: 'Lab Leaderboard', labelHi: 'लैब लीडरबोर्ड', icon: '⊙' },
  { href: '/teacher/profile', label: 'Profile', labelHi: 'प्रोफ़ाइल', icon: '◎' },
];

// ─── Phase 3A — slimmed primary nav (gated on ff_teacher_command_center) ─────
// FIVE primary items. The remaining legacy pages move to an account/overflow
// menu (TEACHER_OVERFLOW_ITEMS) rendered in the sidebar footer so every route
// stays reachable — no dead links. The "Command Center" entry is the existing
// /teacher route (the page swaps to the Command Center under the same flag).
const TEACHER_PRIMARY_SLIM: ReadonlyArray<TeacherNavItem> = [
  { href: '/teacher', label: 'Command Center', labelHi: 'कमांड सेंटर', icon: '▦' },
  { href: '/teacher/grade-book', label: 'Gradebook', labelHi: 'ग्रेड बुक', icon: '⊟', moduleKey: 'assignments' },
  { href: '/teacher/assignments', label: 'Assignments', labelHi: 'असाइनमेंट', icon: '⊠', moduleKey: 'assignments' },
  { href: '/teacher/messages', label: 'Messages', labelHi: 'संदेश', icon: '✉' },
  { href: '/teacher/reports', label: 'Reports', labelHi: 'रिपोर्ट', icon: '⊘', moduleKey: 'analytics' },
];

// Overflow / account menu — kept reachable in the footer when the slim nav is on.
const TEACHER_OVERFLOW_ITEMS: ReadonlyArray<TeacherNavItem> = [
  { href: '/teacher/classes', label: 'Classes', labelHi: 'कक्षाएं', icon: '⊞' },
  { href: '/teacher/students', label: 'Students', labelHi: 'छात्र', icon: '⊕' },
  { href: '/teacher/submissions', label: 'Submissions', labelHi: 'सबमिशन', icon: '⊞', moduleKey: 'assignments' },
  { href: '/teacher/worksheets', label: 'Worksheets', labelHi: 'वर्कशीट', icon: '⊡', moduleKey: 'lms' },
  { href: '/teacher/lab-leaderboard', label: 'Lab Leaderboard', labelHi: 'लैब लीडरबोर्ड', icon: '⊙' },
  { href: '/teacher/profile', label: 'Profile', labelHi: 'प्रोफ़ाइल', icon: '◎' },
];

export default function TeacherShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { authUserId, activeRole, isHi } = useAuth();
  const tenant = useTenant();
  // Cosmic Phase 3: flag-gated dark reskin. When OFF, cosmicEnabled is false
  // and the markup below is byte-identical to before this change.
  const { cosmicEnabled } = useCosmicTheme();

  // null while loading or on fetch failure (fail-open: show all items).
  // Otherwise a partial map of moduleKey → enabled. Only modules that
  // resolve to `false` are filtered out of the sidebar.
  const [moduleEnablement, setModuleEnablement] = useState<Record<string, boolean> | null>(null);

  // Editorial Atlas pass-through (see ParentShell for the rationale).
  // useAtlasFlag initialises synchronously from cache → no first-render
  // flash from legacy chrome to pass-through.
  const atlasOn = useAtlasFlag('teacher');

  // Phase 3A — slim the primary nav to FIVE when the Command Center flag is on.
  // Default OFF + sync cache read ⇒ flag-OFF nav is byte-identical to today.
  const commandCenterOn = useTeacherCommandCenter();

  // Messages tab unread badge — only fetch when authed as a teacher.
  const { data: messagesBadge } = useSWR<TeacherThreadsResponse>(
    authUserId && activeRole === 'teacher' ? '/api/teacher/messages/threads?limit=1' : null,
    messagesBadgeFetcher,
    {
      refreshInterval: MESSAGES_BADGE_POLL_MS,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  );
  const messagesUnread = messagesBadge?.unreadTotal ?? 0;

  // Wrong-role redirect. We don't bounce unauthed users (`authUserId === null`)
  // because the page-level auth guard handles that with proper UX
  // (login screen, return-to URL, etc). We only redirect users who ARE
  // authenticated but have landed in the wrong portal.
  useEffect(() => {
    if (!authUserId) return; // not yet loaded, or unauthenticated — let the page handle it
    if (activeRole && activeRole !== 'teacher' && activeRole !== 'none') {
      router.replace(
        activeRole === 'student'
          ? '/dashboard'
          : activeRole === 'guardian'
            ? '/parent'
            : activeRole === 'institution_admin'
              ? '/school-admin'
              : '/login',
      );
    }
  }, [authUserId, activeRole, router]);

  // Module enablement. Same fail-open pattern as SchoolAdminShell — if the
  // endpoint is missing, returns 4xx/5xx, or throws, `moduleEnablement`
  // stays null and every nav item renders.
  useEffect(() => {
    if (!authUserId) return;
    let cancelled = false;
    fetch('/api/teacher/modules', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        if (cancelled || !body?.success) return;
        const map: Record<string, boolean> = {};
        for (const m of body.data?.modules ?? []) {
          if (m && typeof m.key === 'string' && typeof m.isEnabled === 'boolean') {
            map[m.key] = m.isEnabled;
          }
        }
        setModuleEnablement(map);
      })
      .catch(() => {
        // Fail-open — moduleEnablement stays null and all items render.
      });
    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  // Render children unwrapped when not an authed teacher. Wrapping a login
  // screen or a wrong-role redirect in a teacher shell is wrong UX.
  if (!authUserId || activeRole !== 'teacher') {
    return <>{children}</>;
  }

  // Atlas on → AtlasTeacher provides its own chrome.
  if (atlasOn) return <>{children}</>;

  // Phase 3A — choose the primary nav set. Slim 5-item nav when the Command
  // Center flag is on; the full legacy nav otherwise (byte-identical when off).
  const primaryNav = commandCenterOn ? TEACHER_PRIMARY_SLIM : NAV_ITEMS;

  // Logout button (shared by both footer variants).
  const logoutButton = (
    <button
      type="button"
      onClick={async () => {
        await supabase.auth.signOut();
        router.replace('/login');
      }}
      className="w-full rounded-md py-1.5 text-[11px] font-medium"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        color: 'var(--text-3)',
      }}
    >
      {isHi ? 'लॉगआउट' : 'Logout'}
    </button>
  );

  // When slim, render the moved pages as an account/overflow menu in the footer
  // so every route stays reachable. Module-gating mirrors the sidebar's own
  // fail-open rule (null enablement ⇒ show all).
  const overflowItems = TEACHER_OVERFLOW_ITEMS.filter((item) => {
    if (!item.moduleKey) return true;
    if (moduleEnablement === null || moduleEnablement === undefined) return true;
    return moduleEnablement[item.moduleKey] !== false;
  });

  const footerContent = commandCenterOn ? (
    <div className="flex flex-col gap-2">
      <details className="group" data-testid="teacher-nav-overflow">
        <summary
          className="cursor-pointer list-none rounded-md py-1.5 px-2 text-[11px] font-semibold"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
        >
          {isHi ? 'अधिक' : 'More'}
        </summary>
        <nav className="mt-1.5 flex flex-col">
          {overflowItems.map((item) => {
            const active =
              pathname === item.href || (pathname || '').startsWith(item.href + '/');
            return (
              <a
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] no-underline"
                style={{ color: active ? 'var(--text-1)' : 'var(--text-3)' }}
              >
                <span aria-hidden="true">{item.icon}</span>
                <span className="truncate">{isHi ? item.labelHi : item.label}</span>
              </a>
            );
          })}
        </nav>
      </details>
      {logoutButton}
    </div>
  ) : (
    logoutButton
  );

  return (
    <div
      className={`flex min-h-screen${cosmicEnabled ? ' teacher-portal' : ''}`}
      style={{ background: 'var(--bg)', position: cosmicEnabled ? 'relative' : undefined }}
    >
      {/* Cosmic dark canvas — decorative starfield behind the portal. Hidden in
          light/HC themes and under prefers-reduced-motion via globals.css. */}
      {cosmicEnabled && <Starfield className="!fixed inset-0 -z-0" />}
      <DashboardSidebar
        brandTitle={tenant.schoolName || 'Alfanumrik'}
        brandSubtitle={isHi ? 'शिक्षक' : 'Teacher'}
        logoUrl={tenant.branding.logoUrl}
        primaryColor={tenant.branding.primaryColor || '#6366F1'}
        items={
          (primaryNav as ReadonlyArray<TeacherNavItem>).map((item) =>
            item.href === '/teacher/messages'
              ? ({ ...item, badge: messagesUnread } as unknown as SidebarNavItem)
              : (item as unknown as SidebarNavItem),
          )
        }
        currentPath={pathname || ''}
        isHi={isHi}
        moduleEnablement={moduleEnablement}
        footer={footerContent}
      />
      <main className={`flex-1 overflow-auto${cosmicEnabled ? ' relative z-10' : ''}`}>{children}</main>
    </div>
  );
}
