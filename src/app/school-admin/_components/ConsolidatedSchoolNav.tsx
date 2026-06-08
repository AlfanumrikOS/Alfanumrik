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

import { useMemo, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import type { ModuleKey } from '@/lib/modules/registry';

export interface ConsolidatedNavItem {
  href: string;
  label: string;
  labelHi: string;
  icon: string;
  /** When set: hide this item if moduleEnablement[moduleKey] === false. */
  moduleKey?: ModuleKey;
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
      { href: '/school-admin/rbac', label: 'Roles & Access', labelHi: 'भूमिकाएँ और पहुँच', icon: '⊚' },
    ],
  },
  {
    title: 'Academics',
    titleHi: 'शैक्षणिक',
    items: [
      { href: '/school-admin/classes', label: 'Classes', labelHi: 'कक्षाएँ', icon: '⊞' },
      { href: '/school-admin/exams', label: 'Exams', labelHi: 'परीक्षा', icon: '⊙', moduleKey: 'testing_engine' },
      { href: '/school-admin/content', label: 'Content', labelHi: 'सामग्री', icon: '⊠', moduleKey: 'lms' },
      { href: '/school-admin/reports', label: 'Reports', labelHi: 'रिपोर्ट', icon: '⊘', moduleKey: 'analytics' },
      { href: '/school-admin/announcements', label: 'Announcements', labelHi: 'घोषणाएँ', icon: '⊜', moduleKey: 'communication' },
    ],
  },
  {
    title: 'Billing',
    titleHi: 'बिलिंग',
    items: [
      { href: '/school-admin/billing', label: 'Billing', labelHi: 'बिलिंग', icon: '$' },
    ],
  },
  {
    title: 'Settings',
    titleHi: 'सेटिंग्स',
    items: [
      { href: '/school-admin/branding', label: 'Branding', labelHi: 'ब्रांडिंग', icon: '◐' },
      { href: '/school-admin/modules', label: 'Modules', labelHi: 'मॉड्यूल', icon: '◍' },
      { href: '/school-admin/ai-config', label: 'AI Config', labelHi: 'AI कॉन्फ़िग', icon: '◈', moduleKey: 'ai_tutor' },
      { href: '/school-admin/api-keys', label: 'API Keys', labelHi: 'API कुंजियाँ', icon: '@' },
      { href: '/school-admin/audit-log', label: 'Audit Log', labelHi: 'ऑडिट लॉग', icon: '*' },
      { href: '/school-admin/setup', label: 'Setup', labelHi: 'सेटअप', icon: '◎' },
    ],
  },
];

const DESKTOP_WIDTH = 230;

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
}: ConsolidatedSchoolNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Apply module gating per section; drop empty sections so we never render a
  // heading with no items beneath it.
  const visibleSections = useMemo(() => {
    return SCHOOL_NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!item.moduleKey) return true;
        if (moduleEnablement == null) return true;
        return moduleEnablement[item.moduleKey] !== false;
      }),
    })).filter((section) => section.items.length > 0);
  }, [moduleEnablement]);

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
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={brandTitle} className="h-7 w-7 flex-shrink-0 rounded-md object-cover" />
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

  const renderNav = (onItemClick?: () => void) => (
    <nav className="flex-1 overflow-y-auto py-1" aria-label={isHi ? 'स्कूल नेविगेशन' : 'School navigation'}>
      {visibleSections.map((section) => (
        <div key={section.title} className="mb-1">
          <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {isHi ? section.titleHi : section.title}
          </div>
          {section.items.map((item) => {
            const active = item.href === activeHref;
            const label = isHi ? item.labelHi : item.label;
            const activeStyle = active
              ? { color: primaryColor, background: `${primaryColor}14`, borderLeftColor: primaryColor }
              : { borderLeftColor: 'transparent' };
            return (
              <a
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={onItemClick}
                className={twMerge(
                  'relative flex items-center gap-2.5 border-l-[3px] px-3 py-2.5 text-[13px] no-underline transition-colors',
                  active ? 'font-semibold' : 'font-normal text-foreground/80 hover:bg-surface-2',
                )}
                style={activeStyle}
              >
                <span className="flex-shrink-0 text-[15px] leading-none">{item.icon}</span>
                <span className="truncate flex-1">{label}</span>
              </a>
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
