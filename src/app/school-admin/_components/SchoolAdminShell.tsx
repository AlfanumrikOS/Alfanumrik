'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useTenant } from '@/lib/tenant-context';
import { supabase } from '@/lib/supabase';
import DashboardSidebar, { type SidebarNavItem } from '@/components/admin-ui/DashboardSidebar';
import type { ModuleKey } from '@/lib/modules/registry';
import { useAtlasFlag } from '@/lib/use-atlas-flag';
import { useSchoolCommandCenter } from '@/lib/use-school-command-center';
import { useSchoolReportsDepth } from '@/lib/use-school-reports-depth';
import { useSchoolAdminRbac } from '@/lib/use-school-admin-rbac';
import { useSchoolAdminRole } from '@/lib/use-school-admin-role';
import { usePrincipalAi } from '@/lib/use-principal-ai';
import { useCosmicTheme } from '@/lib/cosmic-theme';
import { Starfield } from '@/components/cosmic';
import ConsolidatedSchoolNav from './ConsolidatedSchoolNav';

/* ─── P7: Bilingual labels ───────────────────────────────────────────
 *
 * `moduleKey` (optional) maps a nav entry to a module from the registry
 * (src/lib/modules/registry.ts). When set, the entry is hidden in the
 * sidebar if `enabledModulesFor(schoolId, tenantType)` reports that
 * module as disabled. Items WITHOUT a moduleKey are always shown — they
 * cover platform-core admin functions (dashboard, students, teachers,
 * classes, branding, etc.) that are not gated by module enablement.
 *
 * Defensive fallback: when the /api/school-admin/modules fetch fails
 * for any reason, we render every item — favouring availability over
 * confusion. (Same fail-open semantics as the registry resolver.)
 */
type SchoolAdminNavItem = {
  href: string;
  label: string;
  labelHi: string;
  icon: string;
  /** When set: hide this item if the module is disabled for this tenant. */
  moduleKey?: ModuleKey;
};

const NAV_ITEMS: ReadonlyArray<SchoolAdminNavItem> = [
  { href: '/school-admin', label: 'Dashboard', labelHi: 'डैशबोर्ड', icon: '▦' },
  { href: '/school-admin/students', label: 'Students', labelHi: 'छात्र', icon: '⊕' },
  { href: '/school-admin/teachers', label: 'Teachers', labelHi: 'शिक्षक', icon: '⊛' },
  { href: '/school-admin/classes', label: 'Classes', labelHi: 'कक्षाएँ', icon: '⊞' },
  { href: '/school-admin/invite-codes', label: 'Invite Codes', labelHi: 'आमंत्रण कोड', icon: '⊡' },
  { href: '/school-admin/announcements', label: 'Announcements', labelHi: 'घोषणाएँ', icon: '⊜', moduleKey: 'communication' },
  { href: '/school-admin/parents', label: 'Parents', labelHi: 'अभिभावक', icon: '⊗' },
  { href: '/school-admin/reports', label: 'Reports', labelHi: 'रिपोर्ट', icon: '⊘', moduleKey: 'analytics' },
  { href: '/school-admin/content', label: 'Content', labelHi: 'सामग्री', icon: '⊠', moduleKey: 'lms' },
  { href: '/school-admin/exams', label: 'Exams', labelHi: 'परीक्षा', icon: '⊙', moduleKey: 'testing_engine' },
  { href: '/school-admin/setup', label: 'Setup', labelHi: 'सेटअप', icon: '◎' },
  { href: '/school-admin/branding', label: 'Branding', labelHi: 'ब्रांडिंग', icon: '◐' },
  { href: '/school-admin/modules', label: 'Modules', labelHi: 'मॉड्यूल', icon: '◍' },
  { href: '/school-admin/ai-config', label: 'AI Config', labelHi: 'AI कॉन्फ़िग', icon: '◈', moduleKey: 'ai_tutor' },
  { href: '/school-admin/enroll', label: 'Enrollment', labelHi: 'नामांकन', icon: '◉' },
];

/**
 * School Admin Shell — branded sidebar layout (Plan 0 Task 8).
 *
 * Composes the shared `<DashboardSidebar>` primitive from
 * `@/components/admin-ui` and supplies tenant-driven branding:
 * - School logo / initial-letter tile
 * - School primary color for active nav highlight
 * - "Powered by Alfanumrik" footer for B2B tenants
 *
 * Falls back to a DB lookup if tenant context is null (e.g. direct URL
 * access before SchoolThemeProvider hydrates). Module-gated nav items
 * fail-open when /api/school-admin/modules errors or returns 403.
 */
export default function SchoolAdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { authUserId, isHi } = useAuth();
  const tenant = useTenant();
  // Cosmic Phase 3: flag-gated dark reskin (gold/steel via data-role="school").
  // OFF ⇒ cosmicEnabled false ⇒ byte-identical to before this change.
  const { cosmicEnabled } = useCosmicTheme();
  const [schoolName, setSchoolName] = useState<string>(tenant.schoolName || '');
  const [logoUrl, setLogoUrl] = useState<string | null>(tenant.branding.logoUrl);

  // null while loading or on fetch failure (fail-open: show all items).
  // Otherwise a partial map of moduleKey → enabled. Only modules that
  // resolve to `false` are filtered out of the sidebar.
  const [moduleEnablement, setModuleEnablement] = useState<Record<string, boolean> | null>(null);

  // Editorial Atlas pass-through. Sync read from cache — no flash.
  const atlasOn = useAtlasFlag('school');
  // Phase 3B — consolidated 5-section nav. Sync-paints DEFAULT_OFF (1h cache),
  // so for every current (flag-absent) user this is false on the first paint and
  // the existing flat DashboardSidebar renders byte-identically. ON ⇒ the
  // grouped ConsolidatedSchoolNav renders instead.
  const commandCenterOn = useSchoolCommandCenter();

  // Phase 3B Wave D — deep school-wide reporting nav entry. Sync-paints
  // DEFAULT_OFF (1h cache), so for every current (flag-absent) user this is false
  // on the first paint and the Academics section omits the School Report entry
  // byte-identically. When ON, the entry appears (the route + read APIs are
  // themselves flag-gated server-side). The consolidated nav only renders when
  // commandCenterOn is true, so this entry is naturally scoped to that surface.
  const reportsDepthOn = useSchoolReportsDepth();

  // Phase 3B Wave C — role-aware nav gating. Sync-paints DEFAULT_OFF (1h cache),
  // so for every current (flag-absent) user this is false on the first paint and
  // the consolidated nav renders Wave A byte-identically (no Staff entry, no
  // capability filtering). When ON, the Staff entry appears and capability-tagged
  // items hide for roles that lack the capability. The caller's role comes from an
  // RLS-bounded self-read (UI polish only — server enforces regardless, P9).
  const rbacOn = useSchoolAdminRbac();
  // Track 2 — Principal AI Assistant nav entry. Sync-paints DEFAULT_OFF (1h cache),
  // so for every current (flag-absent) user this is false on the first paint and
  // the Academics section omits the Principal Assistant entry byte-identically.
  // When ON, the entry appears ONLY for a principal (the route 404s/403s
  // server-side regardless — P9).
  const principalAiOn = usePrincipalAi();
  // Resolve the caller's role when EITHER the RBAC flag OR the Principal-AI flag is
  // ON — both gate nav entries by role. Passing null while both are OFF suppresses
  // the self-read entirely, so the OFF portal is byte-identical (no extra network
  // request) to before these features.
  const { role: adminRole } = useSchoolAdminRole(rbacOn || principalAiOn ? authUserId : null);

  const primaryColor = tenant.branding.primaryColor || '#7C3AED';

  // Track 2 — additively append the Principal Assistant entry to the FLAT legacy
  // sidebar ONLY when `ff_principal_ai_v1` is ON AND the caller is a principal
  // (mirrors the principal-only capability; fail-CLOSED so non-principals never
  // see it). When the flag is OFF this is byte-identical to the legacy NAV_ITEMS.
  const flatNavItems: ReadonlyArray<SchoolAdminNavItem> =
    principalAiOn && adminRole === 'principal'
      ? [
          ...NAV_ITEMS,
          {
            href: '/school-admin/ai-assistant',
            label: 'Principal Assistant',
            labelHi: 'Principal सहायक',
            icon: '◈',
          },
        ]
      : NAV_ITEMS;

  useEffect(() => {
    if (!authUserId) {
      router.push('/login');
      return;
    }
    // If no tenant context (direct URL access), fetch school info from DB
    if (!tenant.schoolName && authUserId) {
      supabase
        .from('school_admins')
        .select('school_id, schools(name, logo_url, primary_color)')
        .eq('auth_user_id', authUserId)
        .eq('is_active', true)
        .single()
        .then(({ data }) => {
          if (data?.schools && typeof data.schools === 'object') {
            // Supabase FK join may return array or object depending on relation type
            const raw = data.schools as unknown;
            const s = Array.isArray(raw) ? raw[0] : raw;
            if (s && typeof s === 'object' && 'name' in s) {
              const school = s as { name: string; logo_url: string | null; primary_color: string | null };
              setSchoolName(school.name);
              if (school.logo_url) setLogoUrl(school.logo_url);
            }
          }
        });
    }
  }, [authUserId, tenant.schoolName, router]);

  // Fetch module enablement once per shell mount. /api/school-admin/modules
  // requires `school.manage_modules` permission; admins without it land
  // here (fail-open: every nav item shows) — the API would return 403 and
  // moduleEnablement stays null. Cached 5 min server-side via the registry.
  useEffect(() => {
    if (!authUserId) return;
    let cancelled = false;
    fetch('/api/school-admin/modules', { credentials: 'same-origin' })
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

  if (atlasOn) return <>{children}</>;

  return (
    <div
      className={`flex min-h-screen bg-surface-2${cosmicEnabled ? ' school-admin-portal' : ''}`}
      style={cosmicEnabled ? { position: 'relative' } : undefined}
    >
      {/* Cosmic dark canvas — decorative starfield behind the portal. Hidden in
          light/HC + reduced-motion via globals.css. */}
      {cosmicEnabled && <Starfield className="!fixed inset-0 -z-0" />}
      {/* Phase 3B nav dispatch: ON ⇒ consolidated 5-section nav; OFF ⇒ the
          existing flat DashboardSidebar (byte-identical). Both receive the same
          branding, current path, and module-enablement so behaviour parity is
          preserved (module gating, active highlight, mobile drawer). */}
      {commandCenterOn ? (
        <ConsolidatedSchoolNav
          brandTitle={schoolName || (isHi ? 'स्कूल प्रशासन' : 'School Admin')}
          brandSubtitle={isHi ? 'स्कूल प्रशासन' : 'School Administration'}
          logoUrl={logoUrl}
          primaryColor={primaryColor}
          currentPath={pathname || ''}
          isHi={isHi}
          moduleEnablement={moduleEnablement}
          rbacEnabled={rbacOn}
          adminRole={adminRole}
          reportsDepthEnabled={reportsDepthOn}
          principalAiEnabled={principalAiOn}
          footer={
            (tenant.branding.showPoweredBy || tenant.schoolId) ? (
              <div>
                Powered by{' '}
                <a href="https://alfanumrik.com" className="text-primary no-underline">
                  Alfanumrik
                </a>
              </div>
            ) : null
          }
        />
      ) : (
        <DashboardSidebar
          brandTitle={schoolName || (isHi ? 'स्कूल प्रशासन' : 'School Admin')}
          brandSubtitle={isHi ? 'स्कूल प्रशासन' : 'School Administration'}
          logoUrl={logoUrl}
          primaryColor={primaryColor}
          items={flatNavItems as unknown as SidebarNavItem[]}
          currentPath={pathname || ''}
          isHi={isHi}
          moduleEnablement={moduleEnablement}
          footer={
            (tenant.branding.showPoweredBy || tenant.schoolId) ? (
              <div>
                Powered by{' '}
                <a href="https://alfanumrik.com" className="text-primary no-underline">
                  Alfanumrik
                </a>
              </div>
            ) : null
          }
        />
      )}
      <main className={`flex-1 max-w-screen-xl overflow-auto p-6${cosmicEnabled ? ' relative z-10' : ''}`}>{children}</main>
    </div>
  );
}
