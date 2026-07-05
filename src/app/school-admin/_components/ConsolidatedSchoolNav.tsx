'use client';

/**
 * ConsolidatedSchoolNav — Phase 3B Wave A. The 5-SECTION consolidated school-admin
 * sidebar, rendered ONLY when `ff_school_command_center` is ON (the flag-gated
 * dispatch lives in SchoolAdminShell). It groups the ~24 flat legacy entries into
 * five sections — Overview · People · Academics · Billing · Settings — while
 * keeping EVERY existing school-admin route reachable (no dead links).
 *
 * Why a bespoke component (not the shared DashboardSidebar primitive):
 *   - DashboardSidebar renders a FLAT list with no section headings, and it is
 *     shared with /super-admin (out of frontend's safe-change scope to alter).
 *     This component is school-admin-only, so the grouped layout lives here and
 *     the OFF path keeps using DashboardSidebar byte-identically.
 *
 * Behaviour parity with the legacy shell:
 *   - Module-gated items (moduleKey) hide when moduleEnablement[key] === false;
 *     fail-open when moduleEnablement is null (every item shows).
 *   - Active highlight = longest matching href (root-vs-subroute disambiguation).
 *   - Mobile hamburger + drawer; desktop persistent rail.
 *   - P7 bilingual via the `isHi` prop.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import type { ModuleKey } from '@/lib/modules/registry';
import type { SchoolAdminRole } from '@/lib/school-admin-auth';

export interface ConsolidatedNavItem {
  href: string;
  label: string;
  labelHi: string;
  icon: string;
  /** When set: hide this item if moduleEnablement[moduleKey] === false. */
  moduleKey?: ModuleKey;
  /**
   * Phase 3B Wave C: when set AND `ff_school_admin_rbac` is ON, hide this item if
   * the caller's `school_admins.role` is not permitted the listed capability.
   * Has NO effect when `rbacEnabled` is false (byte-identical-OFF). Mirrors the
   * server-side SCHOOL_ADMIN_ROLE_CAPABILITIES matrix — UI polish only (P9).
   */
  capability?: SchoolAdminCapability;
  /**
   * Phase 3B Wave C: when true this item only renders while `ff_school_admin_rbac`
   * is ON. Used for the NEW Staff-management entry which has no flag-OFF home.
   */
  rbacOnly?: boolean;
  /**
   * Phase 3B Wave D: when true this item only renders while
   * `ff_school_reports_depth` is ON. Used for the NEW deep school-wide reporting
   * entry which has no flag-OFF home (the route is additive). Has NO effect when
   * `reportsDepthEnabled` is false (byte-identical-OFF — the item is filtered out
   * exactly like an rbacOnly item is when its flag is off).
   */
  reportsDepthOnly?: boolean;
  /**
   * Track 2 (Principal AI Assistant v1): when true this item only renders while
   * `ff_principal_ai_v1` is ON AND the caller's role is `principal` (the
   * principal-only `institution.use_principal_ai` capability). Used for the NEW
   * Principal Assistant entry which has no flag-OFF home. Has NO effect when
   * `principalAiEnabled` is false (byte-identical-OFF). UI polish only — the
   * route 404s (flag off) / 403s (non-principal) regardless (P9).
   */
  principalAiOnly?: boolean;
}

/**
 * The subset of the server role→permission matrix that the nav cares about.
 * Source of truth for the SERVER decision is SCHOOL_ADMIN_ROLE_CAPABILITIES in
 * src/lib/school-admin-auth.ts; this client mirror is UI-only (it never grants
 * access — the server still enforces). Kept here (not imported) because the
 * server set is keyed by raw permission codes; the nav groups them by surface.
 */
export type SchoolAdminCapability = 'view_billing' | 'manage_billing' | 'manage' | 'manage_staff';

/**
 * Which capabilities each school_admins.role holds, per the CEO-approved Wave C
 * matrix (see school-admin-auth.ts). Only the nav-relevant capabilities appear.
 */
const ROLE_NAV_CAPABILITIES: Readonly<Record<SchoolAdminRole, ReadonlySet<SchoolAdminCapability>>> = {
  principal: new Set<SchoolAdminCapability>(['view_billing', 'manage_billing', 'manage', 'manage_staff']),
  // Vice principal: no billing WRITE, no staff management; CAN view billing + manage settings.
  vice_principal: new Set<SchoolAdminCapability>(['view_billing', 'manage']),
  // Academic coordinator: no billing at all, no settings-manage, no staff.
  academic_coordinator: new Set<SchoolAdminCapability>([]),
  institution_admin: new Set<SchoolAdminCapability>(['view_billing', 'manage_billing', 'manage', 'manage_staff']),
};

function roleAllowsCapability(role: SchoolAdminRole | null, cap: SchoolAdminCapability): boolean {
  if (!role) return true; // fail-open: unknown role shows everything (UI polish only)
  return ROLE_NAV_CAPABILITIES[role]?.has(cap) ?? true;
}

export interface ConsolidatedNavSection {
  title: string;
  titleHi: string;
  items: ConsolidatedNavItem[];
}

/**
 * The 5-section map. EVERY school-admin route is present exactly once.
 *
 *   Overview  → Command Center home (/school-admin)
 *   People    → students · teachers · parents · enroll · invite-codes · rbac
 *   Academics → classes · exams · content · reports · announcements
 *   Billing   → billing
 *   Settings  → branding · modules · ai-config · api-keys · audit-log · setup
 */
export const SCHOOL_NAV_SECTIONS: ReadonlyArray<ConsolidatedNavSection> = [
  {
    title: 'Overview',
    titleHi: 'अवलोकन',
    items: [
      { href: '/school-admin', label: 'Command Center', labelHi: 'कमांड सेंटर', icon: '▦' },
    ],
  },
  {
    title: 'People',
    titleHi: 'लोग',
    items: [
      { href: '/school-admin/students', label: 'Students', labelHi: 'छात्र', icon: '⊕' },
      { href: '/school-admin/teachers', label: 'Teachers', labelHi: 'शिक्षक', icon: '⊛' },
      { href: '/school-admin/parents', label: 'Parents', labelHi: 'अभिभावक', icon: '⊗' },
      { href: '/school-admin/enroll', label: 'Enrollment', labelHi: 'नामांकन', icon: '◉' },
      { href: '/school-admin/invite-codes', label: 'Invite Codes', labelHi: 'आमंत्रण कोड', icon: '⊡' },
      // Phase 3B Wave C — NEW staff-management surface. rbacOnly: only renders when
      // ff_school_admin_rbac is ON; capability: hidden for roles lacking manage_staff.
      {
        href: '/school-admin/staff',
        label: 'Staff',
        labelHi: 'स्टाफ',
        icon: '⊛',
        rbacOnly: true,
        capability: 'manage_staff',
      },
      { href: '/school-admin/rbac', label: 'Roles & Access', labelHi: 'भूमिकाएँ और पहुँच', icon: '⊚' },
    ],
  },
  {
    title: 'Academics',
    titleHi: 'शैक्षणिक',
    items: [
      // Track 2 — NEW Principal AI Assistant. principalAiOnly: only renders while
      // ff_principal_ai_v1 is ON AND the caller is a principal (principal-only
      // capability). The route 404s/403s server-side regardless (P9).
      {
        href: '/school-admin/ai-assistant',
        label: 'Principal Assistant',
        labelHi: 'Principal सहायक',
        icon: '◈',
        principalAiOnly: true,
      },
      { href: '/school-admin/classes', label: 'Classes', labelHi: 'कक्षाएँ', icon: '⊞' },
      { href: '/school-admin/exams', label: 'Exams', labelHi: 'परीक्षा', icon: '⊙', moduleKey: 'testing_engine' },
      { href: '/school-admin/content', label: 'Content', labelHi: 'सामग्री', icon: '⊠', moduleKey: 'lms' },
      { href: '/school-admin/reports', label: 'Academic Reports', labelHi: 'शैक्षणिक रिपोर्ट', icon: '⊘', moduleKey: 'analytics' },
      // Phase 3B Wave D — NEW deep school-wide reporting surface (board/parent-ready
      // mastery + Bloom's + export). reportsDepthOnly: only renders while
      // ff_school_reports_depth is ON; analytics module gating still applies.
      // Labelled "Board Report" to disambiguate from the interactive "Academic
      // Reports" tabbed analytics above — different purpose, distinct route.
      {
        href: '/school-admin/reports-depth',
        label: 'Board Report',
        labelHi: 'बोर्ड रिपोर्ट',
        icon: '⊟',
        moduleKey: 'analytics',
        reportsDepthOnly: true,
      },
      { href: '/school-admin/announcements', label: 'Announcements', labelHi: 'घोषणाएँ', icon: '⊜', moduleKey: 'communication' },
    ],
  },
  {
    title: 'Billing',
    titleHi: 'बिलिंग',
    items: [
      // Billing view requires view_billing; academic_coordinator lacks it (hidden
      // when ff_school_admin_rbac is ON). vice_principal keeps VIEW (write is
      // gated server-side inside the billing page).
      { href: '/school-admin/billing', label: 'Billing', labelHi: 'बिलिंग', icon: '$', capability: 'view_billing' },
    ],
  },
  {
    title: 'Settings',
    titleHi: 'सेटिंग्स',
    items: [
      // The configuration surfaces require institution.manage; academic_coordinator
      // lacks it (hidden when ff_school_admin_rbac is ON). Audit Log is a view-level
      // surface (view_analytics, held by every role) so it stays ungated.
      { href: '/school-admin/branding', label: 'Branding', labelHi: 'ब्रांडिंग', icon: '◐', capability: 'manage' },
      { href: '/school-admin/modules', label: 'Modules', labelHi: 'मॉड्यूल', icon: '◍', capability: 'manage' },
      { href: '/school-admin/ai-config', label: 'AI Config', labelHi: 'AI कॉन्फ़िग', icon: '◈', moduleKey: 'ai_tutor', capability: 'manage' },
      { href: '/school-admin/api-keys', label: 'API Keys', labelHi: 'API कुंजियाँ', icon: '@', capability: 'manage' },
      { href: '/school-admin/audit-log', label: 'Audit Log', labelHi: 'ऑडिट लॉग', icon: '*' },
      { href: '/school-admin/setup', label: 'Setup', labelHi: 'सेटअप', icon: '◎', capability: 'manage' },
    ],
  },
];

const DESKTOP_WIDTH = 230;

export interface ConsolidatedSchoolNavProps {
  brandTitle: string;
  brandSubtitle: string;
  logoUrl?: string | null;
  /** Color for active highlight. Default 'var(--purple)' (brand-purple). */
  primaryColor?: string;
  currentPath: string;
  isHi: boolean;
  /** null/undefined → fail-open (show all). Otherwise filter by module key. */
  moduleEnablement?: Record<string, boolean> | null;
  footer?: React.ReactNode;
  /**
   * Phase 3B Wave C. When false/undefined (the default + flag-OFF), the nav is
   * BYTE-IDENTICAL to Wave A: rbacOnly items (Staff) are hidden and capability
   * filtering is skipped entirely. When true (`ff_school_admin_rbac` ON), the
   * Staff entry appears and capability-tagged items hide for roles that lack
   * the capability per the CEO-approved matrix. UI polish only — the server
   * enforces regardless (P9).
   */
  rbacEnabled?: boolean;
  /** The caller's school_admins.role (for rbac gating). null ⇒ fail-open. */
  adminRole?: SchoolAdminRole | null;
  /**
   * Phase 3B Wave D. When false/undefined (the default + flag-OFF), the nav is
   * BYTE-IDENTICAL to before Wave D: reportsDepthOnly items (the deep School
   * Report entry) are hidden entirely. When true (`ff_school_reports_depth` ON),
   * the School Report entry appears in the Academics section. UI polish only —
   * the read routes 404 server-side when the flag is off regardless (P9).
   */
  reportsDepthEnabled?: boolean;
  /**
   * Track 2 (Principal AI Assistant v1). When false/undefined (the default +
   * flag-OFF), the nav is BYTE-IDENTICAL to before Track 2: principalAiOnly items
   * (the Principal Assistant entry) are hidden entirely. When true
   * (`ff_principal_ai_v1` ON), the entry appears ONLY for a caller whose
   * `adminRole` is `principal` (mirrors the principal-only capability). UI polish
   * only — the route 404s/403s server-side regardless (P9).
   */
  principalAiEnabled?: boolean;
}

export default function ConsolidatedSchoolNav({
  brandTitle,
  brandSubtitle,
  logoUrl,
  primaryColor = 'var(--purple)',
  currentPath,
  isHi,
  moduleEnablement,
  footer,
  rbacEnabled = false,
  adminRole = null,
  reportsDepthEnabled = false,
  principalAiEnabled = false,
}: ConsolidatedSchoolNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Apply module gating + (Wave C) rbac gating per section; drop empty sections
  // so we never render a heading with no items beneath it.
  // NOTE: module-key items are NOT filtered out here — they stay visible as
  // "locked" items (grayed out, no-op click) when moduleEnablement[key] === false.
  // All other gates (rbacOnly, capability, reportsDepthOnly, principalAiOnly)
  // continue to hide items entirely (they represent access the admin never has).
  const visibleSections = useMemo(() => {
    return SCHOOL_NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        // Wave C rbac gating. When the flag is OFF, rbacOnly items are hidden and
        // capability filtering is skipped → byte-identical to Wave A.
        if (item.rbacOnly && !rbacEnabled) return false;
        if (rbacEnabled && item.capability && !roleAllowsCapability(adminRole, item.capability)) {
          return false;
        }
        // Wave D reporting-depth gating. When the flag is OFF, reportsDepthOnly
        // items (the deep School Report entry) are hidden → byte-identical to
        // before Wave D.
        if (item.reportsDepthOnly && !reportsDepthEnabled) return false;
        // Track 2 Principal-AI gating. When the flag is OFF, principalAiOnly items
        // are hidden → byte-identical to before Track 2. When ON, the entry shows
        // ONLY for a principal (mirrors the principal-only capability; fail-CLOSED
        // for null/non-principal roles so non-principals never see the entry).
        if (item.principalAiOnly && (!principalAiEnabled || adminRole !== 'principal')) {
          return false;
        }
        return true;
      }),
    })).filter((section) => section.items.length > 0);
  }, [rbacEnabled, adminRole, reportsDepthEnabled, principalAiEnabled]);

  // Active = longest matching href across ALL visible items (root-vs-subroute).
  const activeHref = useMemo(() => {
    const all = visibleSections.flatMap((s) => s.items);
    return all
      .filter((item) => currentPath === item.href || currentPath.startsWith(item.href + '/'))
      .reduce<string | null>(
        (best, item) => (best === null || item.href.length > best.length ? item.href : best),
        null,
      );
  }, [visibleSections, currentPath]);

  const renderBrandHeader = () => {
    const initial = (brandTitle || 'A').charAt(0).toUpperCase();
    return (
      <div className="flex items-center gap-2 border-b border-surface-3 px-3 py-3 min-h-[48px]">
        {logoUrl ? (
          <Image src={logoUrl} alt={brandTitle} width={28} height={28} className="h-7 w-7 flex-shrink-0 rounded-md object-cover" />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-sm font-bold text-on-accent"
            style={{ background: primaryColor }}
          >
            {initial}
          </div>
        )}
        <div className="overflow-hidden">
          <div className="truncate text-[13px] font-bold text-foreground">{brandTitle}</div>
          <div className="truncate text-[10px] text-muted-foreground">{brandSubtitle}</div>
        </div>
      </div>
    );
  };

  const renderNav = (onItemClick?: () => void) => (
    <nav className="flex-1 overflow-y-auto py-1" aria-label={isHi ? 'स्कूल नेविगेशन' : 'School navigation'}>
      {visibleSections.map((section) => (
        <div key={section.title} className="mb-1">
          <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {isHi ? section.titleHi : section.title}
          </div>
          {section.items.map((item) => {
            // A module-keyed item is "locked" only when moduleEnablement is
            // non-null AND explicitly false for that key. When moduleEnablement
            // is null (still loading) every item renders normally (fail-open).
            const isLocked =
              item.moduleKey != null &&
              moduleEnablement != null &&
              moduleEnablement[item.moduleKey] === false;

            const active = !isLocked && item.href === activeHref;
            const label = isHi ? item.labelHi : item.label;

            if (isLocked) {
              return (
                <div
                  key={item.href}
                  aria-disabled="true"
                  className="relative flex items-center gap-2.5 border-l-[3px] px-3 py-2.5 text-[13px] cursor-not-allowed opacity-60 select-none"
                  style={{ borderLeftColor: 'transparent' }}
                >
                  <span className="flex-shrink-0 text-[15px] leading-none">{item.icon}</span>
                  <span className="truncate flex-1">{label}</span>
                  <span className="ml-auto text-xs opacity-60" aria-label="Module not enabled">🔒</span>
                </div>
              );
            }

            const activeStyle = active
              ? { color: primaryColor, background: `color-mix(in srgb, ${primaryColor} 8%, transparent)`, borderLeftColor: primaryColor }
              : { borderLeftColor: 'transparent' };
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={onItemClick}
                className={twMerge(
                  'relative flex items-center gap-2.5 border-l-[3px] px-3 py-2.5 text-[13px] no-underline transition-colors',
                  active ? 'font-semibold' : 'font-normal text-muted-foreground hover:bg-surface-2',
                )}
                style={activeStyle}
              >
                <span className="flex-shrink-0 text-[15px] leading-none">{item.icon}</span>
                <span className="truncate flex-1">{label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const desktopAside = (
    <aside
      data-testid="school-consolidated-nav-desktop"
      style={{ width: DESKTOP_WIDTH }}
      className="hidden md:flex flex-shrink-0 flex-col overflow-hidden border-r border-surface-3 bg-surface-1"
    >
      {renderBrandHeader()}
      {renderNav()}
      {footer && (
        <div className="border-t border-surface-3 p-3 text-[10px] text-muted-foreground">{footer}</div>
      )}
    </aside>
  );

  const mobileHamburger = (
    <button
      type="button"
      onClick={() => setMobileOpen(true)}
      aria-label={isHi ? 'नेविगेशन मेनू खोलें' : 'Open navigation menu'}
      aria-expanded={mobileOpen}
      className="md:hidden fixed top-3 left-3 z-50 flex h-9 w-9 items-center justify-center rounded-md border border-surface-3 bg-surface-1 text-foreground shadow-sm"
    >
      <span aria-hidden="true" className="text-base leading-none">☰</span>
    </button>
  );

  const mobileDrawer = mobileOpen ? (
    <>
      <div
        data-testid="school-consolidated-nav-backdrop"
        onClick={() => setMobileOpen(false)}
        className="md:hidden fixed inset-0 z-40 bg-black/30"
      />
      <aside
        data-testid="school-consolidated-nav-mobile"
        className="md:hidden fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col overflow-hidden border-r border-surface-3 bg-surface-1 shadow-xl"
      >
        {renderBrandHeader()}
        {renderNav(() => setMobileOpen(false))}
        {footer && (
          <div className="border-t border-surface-3 p-3 text-[10px] text-muted-foreground">{footer}</div>
        )}
      </aside>
    </>
  ) : null;

  return (
    <>
      {desktopAside}
      {mobileHamburger}
      {mobileDrawer}
    </>
  );
}
