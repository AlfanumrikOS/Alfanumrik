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
import { useAuth } from '@/lib/AuthContext';
import { useTenant } from '@/lib/tenant-context';
import { supabase } from '@/lib/supabase';
import DashboardSidebar, { type SidebarNavItem } from '@/components/admin-ui/DashboardSidebar';
import type { ModuleKey } from '@/lib/modules/registry';
import { useAtlasFlag } from '@/lib/use-atlas-flag';

type TeacherNavItem = {
  href: string;
  label: string;
  labelHi: string;
  icon: string;
  /** When set: hide this item if the module is disabled for this tenant. */
  moduleKey?: ModuleKey;
};

const NAV_ITEMS: ReadonlyArray<TeacherNavItem> = [
  { href: '/teacher', label: 'Dashboard', labelHi: 'डैशबोर्ड', icon: '▦' },
  { href: '/teacher/classes', label: 'Classes', labelHi: 'कक्षाएं', icon: '⊞' },
  { href: '/teacher/students', label: 'Students', labelHi: 'छात्र', icon: '⊕' },
  { href: '/teacher/assignments', label: 'Assignments', labelHi: 'असाइनमेंट', icon: '⊠', moduleKey: 'assignments' },
  { href: '/teacher/submissions', label: 'Submissions', labelHi: 'सबमिशन', icon: '⊞', moduleKey: 'assignments' },
  { href: '/teacher/worksheets', label: 'Worksheets', labelHi: 'वर्कशीट', icon: '⊡', moduleKey: 'lms' },
  { href: '/teacher/reports', label: 'Reports', labelHi: 'रिपोर्ट', icon: '⊘', moduleKey: 'analytics' },
  { href: '/teacher/lab-leaderboard', label: 'Lab Leaderboard', labelHi: 'लैब लीडरबोर्ड', icon: '⊙' },
  { href: '/teacher/profile', label: 'Profile', labelHi: 'प्रोफ़ाइल', icon: '◎' },
];

export default function TeacherShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { authUserId, activeRole, isHi } = useAuth();
  const tenant = useTenant();

  // null while loading or on fetch failure (fail-open: show all items).
  // Otherwise a partial map of moduleKey → enabled. Only modules that
  // resolve to `false` are filtered out of the sidebar.
  const [moduleEnablement, setModuleEnablement] = useState<Record<string, boolean> | null>(null);

  // Editorial Atlas pass-through (see ParentShell for the rationale).
  // useAtlasFlag initialises synchronously from cache → no first-render
  // flash from legacy chrome to pass-through.
  const atlasOn = useAtlasFlag('teacher');

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

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg)' }}>
      <DashboardSidebar
        brandTitle={tenant.schoolName || 'Alfanumrik'}
        brandSubtitle={isHi ? 'शिक्षक' : 'Teacher'}
        logoUrl={tenant.branding.logoUrl}
        primaryColor={tenant.branding.primaryColor || '#6366F1'}
        items={NAV_ITEMS as unknown as SidebarNavItem[]}
        currentPath={pathname || ''}
        isHi={isHi}
        moduleEnablement={moduleEnablement}
        footer={
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
        }
      />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
