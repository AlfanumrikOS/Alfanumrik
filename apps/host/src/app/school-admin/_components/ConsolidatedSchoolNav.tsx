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
 *   - Module-gated items (moduleKey) render locked when enablement is false;
 *     fail-open when moduleEnablement is null (every item remains actionable).
 *   - Active highlight = longest matching href (root-vs-subroute disambiguation).
 *   - Mobile five-destination bar + canonical More sheet; desktop persistent rail.
 *   - P7 bilingual via the `isHi` prop.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import type { ModuleKey } from '@alfanumrik/lib/modules/registry';
import type { SchoolAdminRole } from '@alfanumrik/lib/school-admin-auth';
import { BottomSheet } from '@alfanumrik/ui/ui/primitives';

export interface ConsolidatedNavItem {
  href: string;
  label: string;
  labelHi: string;
  icon: string;
  /**
   * Task 1.6b: optional one-line bilingual descriptive subtitle rendered under
   * the label, in the same subdued muted-foreground tone as the section
   * heading. Used to disambiguate near-identical labels (e.g. the "Academic
   * Reports" vs "Board Report" entries) without changing the label text
   * itself. Purely additive — omit for every other item (no layout change).
   */
  subtitle?: string;
  subtitleHi?: string;
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
      {
        href: '/school-admin/reports',
        label: 'Academic Reports',
        labelHi: 'शैक्षणिक रिपोर्ट',
        icon: '⊘',
        moduleKey: 'analytics',
        // Task 1.6b — disambiguates this interactive, tab-based drill-down
        // surface from the static "Board Report" export below.
        subtitle: 'Explore live class & subject data',
        subtitleHi: 'लाइव कक्षा और विषय डेटा देखें',
      },
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
        // Task 1.6b — disambiguates this static, exportable summary from the
        // interactive "Academic Reports" drill-down above.
        subtitle: 'Printable summary for the board',
        subtitleHi: 'बोर्ड के लिए प्रिंट योग्य सारांश',
      },
      { href: '/school-admin/announcements', label: 'Announcements', labelHi: 'घोषणाएँ', icon: '⊜', moduleKey: 'communication' },
      // T13 — teacher-> school-admin escalation visibility (RCA follow-up).
      // Read-only list; ungated (no module/rbac restriction) so every admin
      // role can see cases raised by teachers at their school.
      { href: '/school-admin/escalations', label: 'Escalations', labelHi: 'एस्केलेशन', icon: '⚑' },
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

type SchoolMobileDestinationKey = 'overview' | 'people' | 'academics' | 'insights';

interface SchoolMobileDestination {
  key: SchoolMobileDestinationKey;
  href: string;
  label: string;
  labelHi: string;
  icon: string;
  moduleKey?: ModuleKey;
}

/**
 * Four direct destinations plus the More sheet form the five-item mobile IA.
 * The sheet intentionally repeats these routes while grouping the complete
 * authorized manifest, keeping every school-admin surface within two actions.
 */
const SCHOOL_MOBILE_DESTINATIONS: ReadonlyArray<SchoolMobileDestination> = [
  {
    key: 'overview',
    href: '/school-admin',
    label: 'Overview',
    labelHi: 'अवलोकन',
    icon: '⌂',
  },
  {
    key: 'people',
    href: '/school-admin/students',
    label: 'People',
    labelHi: 'लोग',
    icon: '⊕',
  },
  {
    key: 'academics',
    href: '/school-admin/classes',
    label: 'Academics',
    labelHi: 'शैक्षणिक',
    icon: '⊞',
  },
  {
    key: 'insights',
    href: '/school-admin/reports',
    label: 'Insights',
    labelHi: 'अंतर्दृष्टि',
    icon: '↗',
    moduleKey: 'analytics',
  },
];

export interface ConsolidatedSchoolNavProps {
  brandTitle: string;
  brandSubtitle: string;
  logoUrl?: string | null;
  /** Hex for active highlight. Default '#7C3AED' (brand-purple). */
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
  primaryColor = '#7C3AED',
  currentPath,
  isHi,
  moduleEnablement,
  footer,
  rbacEnabled = false,
  adminRole = null,
  reportsDepthEnabled = false,
  principalAiEnabled = false,
}: ConsolidatedSchoolNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);

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

  const isModuleLocked = (item: Pick<ConsolidatedNavItem, 'moduleKey'>) =>
    item.moduleKey != null &&
    moduleEnablement != null &&
    moduleEnablement[item.moduleKey] === false;

  const peopleHrefs = visibleSections
    .find((section) => section.title === 'People')
    ?.items.map((item) => item.href) ?? [];
  const academicHrefs = visibleSections
    .find((section) => section.title === 'Academics')
    ?.items.map((item) => item.href) ?? [];

  let mobileActiveKey: SchoolMobileDestinationKey | 'more' = 'more';
  if (activeHref === '/school-admin') {
    mobileActiveKey = 'overview';
  } else if (activeHref && peopleHrefs.includes(activeHref)) {
    mobileActiveKey = 'people';
  } else if (
    activeHref === '/school-admin/reports' ||
    activeHref === '/school-admin/reports-depth'
  ) {
    mobileActiveKey = 'insights';
  } else if (activeHref && academicHrefs.includes(activeHref)) {
    mobileActiveKey = 'academics';
  }

  const renderBrandHeader = () => {
    const initial = (brandTitle || 'A').charAt(0).toUpperCase();
    return (
      <div className="flex items-center gap-2 border-b border-surface-3 px-3 py-3 min-h-[48px]">
        {logoUrl ? (
          <Image src={logoUrl} alt={brandTitle} width={28} height={28} className="h-7 w-7 flex-shrink-0 rounded-md object-cover" />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-sm font-bold text-white"
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

  const renderNav = (
    onItemClick?: () => void,
    ariaLabel = isHi ? 'स्कूल नेविगेशन' : 'School navigation',
    touchFriendly = false,
  ) => (
    <nav className="flex-1 overflow-y-auto py-1" aria-label={ariaLabel}>
      {visibleSections.map((section) => (
        <div key={section.title} className="mb-1">
          <h3 className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {isHi ? section.titleHi : section.title}
          </h3>
          {section.items.map((item) => {
            // A module-keyed item is "locked" only when moduleEnablement is
            // non-null AND explicitly false for that key. When moduleEnablement
            // is null (still loading) every item renders normally (fail-open).
            const isLocked = isModuleLocked(item);

            const active = !isLocked && item.href === activeHref;
            const label = isHi ? item.labelHi : item.label;
            const subtitle = isHi ? item.subtitleHi : item.subtitle;

            if (isLocked) {
              return (
                <div
                  key={item.href}
                  aria-disabled="true"
                  className={twMerge(
                    'relative flex items-center gap-2.5 border-l-[3px] px-3 py-2.5 text-[13px] cursor-not-allowed opacity-60 select-none',
                    touchFriendly && 'min-h-12',
                  )}
                  style={{ borderLeftColor: 'transparent' }}
                >
                  <span className="flex-shrink-0 text-[15px] leading-none">{item.icon}</span>
                  <span className="truncate flex-1 flex flex-col">
                    <span className="truncate">{label}</span>
                    {subtitle && (
                      <span className="truncate text-[10px] font-normal text-muted-foreground">{subtitle}</span>
                    )}
                  </span>
                  <span
                    className="ml-auto text-xs opacity-60"
                    aria-label={isHi ? 'मॉड्यूल सक्षम नहीं है' : 'Module not enabled'}
                  >
                    🔒
                  </span>
                </div>
              );
            }

            const activeStyle = active
              ? { color: primaryColor, background: `${primaryColor}14`, borderLeftColor: primaryColor }
              : { borderLeftColor: 'transparent' };
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={onItemClick}
                className={twMerge(
                  'relative flex items-center gap-2.5 border-l-[3px] px-3 py-2.5 text-[13px] no-underline transition-colors',
                  touchFriendly && 'min-h-12',
                  active ? 'font-semibold' : 'font-normal text-[color-mix(in_srgb,var(--foreground)_80%,transparent)] hover:bg-surface-2',
                )}
                style={activeStyle}
              >
                <span className="flex-shrink-0 text-[15px] leading-none">{item.icon}</span>
                <span className="truncate flex-1 flex flex-col">
                  <span className="truncate">{label}</span>
                  {subtitle && (
                    <span className="truncate text-[10px] font-normal text-muted-foreground">{subtitle}</span>
                  )}
                </span>
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

  const mobileBottomNav = (
    <nav
      data-testid="school-consolidated-nav-mobile"
      aria-label={isHi ? 'स्कूल मोबाइल नेविगेशन' : 'School mobile navigation'}
      className="school-admin-mobile-nav md:hidden fixed inset-x-0 bottom-0 z-40 flex border-t border-surface-3 bg-surface-1 text-foreground shadow-lg"
    >
      {SCHOOL_MOBILE_DESTINATIONS.map((destination) => {
        const label = isHi ? destination.labelHi : destination.label;
        const locked = isModuleLocked(destination);
        const active = !locked && mobileActiveKey === destination.key;
        const content = (
          <>
            <span aria-hidden="true" className="text-base leading-none">{destination.icon}</span>
            <span className="max-w-full truncate text-[10px] leading-tight">{label}</span>
          </>
        );
        const className = twMerge(
          'flex min-h-12 min-w-12 flex-1 flex-col items-center justify-center gap-1 px-1 no-underline transition-colors',
          active
            ? 'font-semibold'
            : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
          locked && 'cursor-not-allowed opacity-60',
        );

        if (locked) {
          return (
            <button
              key={destination.key}
              type="button"
              disabled
              aria-disabled="true"
              aria-label={`${label}. ${isHi ? 'मॉड्यूल सक्षम नहीं है' : 'Module not enabled'}`}
              className={className}
            >
              {content}
            </button>
          );
        }

        return (
          <Link
            key={destination.key}
            href={destination.href}
            aria-current={active ? 'page' : undefined}
            className={className}
            style={active ? { color: primaryColor, background: `${primaryColor}14` } : undefined}
          >
            {content}
          </Link>
        );
      })}

      <button
        type="button"
        onClick={() => setMoreOpen(true)}
        aria-label={isHi ? 'सभी विकल्प खोलें' : 'Open all destinations'}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        aria-current={mobileActiveKey === 'more' ? 'page' : undefined}
        className={twMerge(
          'flex min-h-12 min-w-12 flex-1 flex-col items-center justify-center gap-1 px-1 transition-colors',
          mobileActiveKey === 'more'
            ? 'font-semibold'
            : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        )}
        style={
          mobileActiveKey === 'more'
            ? { color: primaryColor, background: `${primaryColor}14` }
            : undefined
        }
      >
        <span aria-hidden="true" className="text-base leading-none">•••</span>
        <span className="max-w-full truncate text-[10px] leading-tight">
          {isHi ? 'अधिक' : 'More'}
        </span>
      </button>
    </nav>
  );

  const mobileMoreSheet = (
    <BottomSheet
      open={moreOpen}
      onClose={() => setMoreOpen(false)}
      title={isHi ? 'सभी विकल्प' : 'All destinations'}
      description={
        isHi
          ? `${brandTitle} के सभी उपलब्ध कार्यक्षेत्र`
          : `All available workspaces for ${brandTitle}`
      }
      handleLabel={isHi ? 'नेविगेशन बंद करें' : 'Close navigation'}
      footer={
        footer ? (
          <div className="py-2 text-[10px] text-muted-foreground">{footer}</div>
        ) : undefined
      }
    >
      {renderNav(
        () => setMoreOpen(false),
        isHi ? 'स्कूल के सभी विकल्प' : 'All school destinations',
        true,
      )}
    </BottomSheet>
  );

  return (
    <>
      {desktopAside}
      {mobileBottomNav}
      {mobileMoreSheet}
    </>
  );
}
