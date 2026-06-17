'use client';

/**
 * DashboardSidebar — shared admin-ui primitive (Plan 0 Task 7).
 *
 * Generic sidebar primitive composed by both /super-admin/AdminShell and
 * /school-admin/SchoolAdminShell. Accepts items, branding, current path,
 * bilingual flag, optional module-enablement filter, and an optional
 * footer slot. Tasks 8 & 9 refactor the existing shells onto this primitive.
 *
 * Design notes:
 * - Tailwind semantic tokens (surface-1/2/3, foreground, muted-foreground)
 *   for theme-aware base colors.
 * - `primaryColor` prop is rendered via inline style because it is a
 *   runtime-dynamic per-tenant value (from school branding) and cannot be
 *   resolved at Tailwind compile time.
 * - Mobile drawer is useState-driven; the desktop collapse state is also
 *   useState. They are independent so a tenant admin who collapsed on
 *   desktop and resized to mobile still gets a working hamburger.
 */

import { useState } from 'react';
import Link from 'next/link';
import { twMerge } from 'tailwind-merge';

export interface SidebarNavItem {
  href: string;
  label: string;
  labelHi: string;
  icon: React.ReactNode;
  /** When set, hide if moduleEnablement[moduleKey] === false. */
  moduleKey?: string;
  /**
   * Optional numeric badge rendered to the right of the label. 0 hides
   * the badge; >99 clamps to "99+". Used by /parent for unread
   * notification count.
   */
  badge?: number;
}

export interface DashboardSidebarProps {
  brandTitle: string;
  brandSubtitle: string;
  logoUrl?: string | null;
  /** Hex for active highlight. Default '#7C3AED' (brand-purple). */
  primaryColor?: string;
  items: SidebarNavItem[];
  currentPath: string;
  isHi: boolean;
  /** null/undefined → fail-open (show all). Otherwise filter by key. */
  moduleEnablement?: Record<string, boolean> | null;
  footer?: React.ReactNode;
  className?: string;
}

const DESKTOP_WIDTH = 220;
const COLLAPSED_WIDTH = 56;

export default function DashboardSidebar({
  brandTitle,
  brandSubtitle,
  logoUrl,
  primaryColor = '#7C3AED',
  items,
  currentPath,
  isHi,
  moduleEnablement,
  footer,
  className,
}: DashboardSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleItems = items.filter(item => {
    if (!item.moduleKey) return true;
    if (moduleEnablement === null || moduleEnablement === undefined) return true;
    return moduleEnablement[item.moduleKey] !== false;
  });

  // Active item = longest matching href among the visible items. This avoids
  // the "Dashboard root + Students sub-item both active" ambiguity that
  // shows up when a root href like /school-admin is a prefix of a deeper
  // route like /school-admin/students.
  const activeHref = visibleItems
    .filter(item => currentPath === item.href || currentPath.startsWith(item.href + '/'))
    .reduce<string | null>(
      (best, item) => (best === null || item.href.length > best.length ? item.href : best),
      null,
    );

  const sidebarWidth = collapsed ? COLLAPSED_WIDTH : DESKTOP_WIDTH;

  // Brand header: logo (or initial-letter tile) + title + subtitle.
  const renderBrandHeader = () => {
    const initial = (brandTitle || 'A').charAt(0).toUpperCase();
    return (
      <div className="flex items-center gap-2 border-b border-surface-3 px-3 py-3 min-h-[48px]">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={brandTitle}
            className="h-7 w-7 flex-shrink-0 rounded-md object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-sm font-bold text-white"
            style={{ background: primaryColor }}
          >
            {initial}
          </div>
        )}
        {!collapsed && (
          <div className="overflow-hidden">
            <div className="truncate text-[13px] font-bold text-foreground">{brandTitle}</div>
            <div className="truncate text-[10px] text-muted-foreground">{brandSubtitle}</div>
          </div>
        )}
      </div>
    );
  };

  const renderNav = (onItemClick?: () => void) => (
    <nav className="flex-1 overflow-y-auto py-1">
      {visibleItems.map(item => {
        const active = item.href === activeHref;
        const label = isHi ? item.labelHi : item.label;
        const activeStyle = active
          ? {
              color: primaryColor,
              background: `${primaryColor}14`, // ~8% alpha for tint
              borderLeftColor: primaryColor,
            }
          : { borderLeftColor: 'transparent' };
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            onClick={onItemClick}
            title={collapsed ? label : undefined}
            className={twMerge(
              'relative flex items-center gap-2.5 border-l-[3px] px-3 py-2.5 text-[13px] no-underline transition-colors',
              collapsed ? 'justify-center px-3' : 'justify-start',
              active
                ? 'font-semibold'
                : 'font-normal text-foreground/80 hover:bg-surface-2',
            )}
            style={activeStyle}
          >
            <span className="flex-shrink-0 text-[15px] leading-none">{item.icon}</span>
            {!collapsed && <span className="truncate flex-1">{label}</span>}
            {!collapsed && typeof item.badge === 'number' && item.badge > 0 && (
              <span
                data-testid={`sidebar-badge-${item.href.replace(/^\//, '').replace(/\//g, '-')}`}
                className="ml-auto flex h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white"
                style={{ background: primaryColor }}
              >
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
            {collapsed && typeof item.badge === 'number' && item.badge > 0 && (
              <span
                aria-hidden="true"
                className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full"
                style={{ background: primaryColor }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );

  // Toggle button — collapse on desktop. Lives in the body so both desktop
  // and the mobile drawer can use it.
  const renderCollapseToggle = () => (
    <button
      type="button"
      onClick={() => setCollapsed(c => !c)}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-expanded={!collapsed}
      className="hidden md:block px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
    >
      {collapsed ? '→' : '←'}
    </button>
  );

  // ── Desktop sidebar ─────────────────────────────────────────────────
  const desktopAside = (
    <aside
      data-testid="dashboard-sidebar-desktop"
      style={{ width: sidebarWidth }}
      className={twMerge(
        'hidden md:flex flex-shrink-0 flex-col overflow-hidden border-r border-surface-3 bg-surface-1 transition-[width] duration-200',
        className,
      )}
    >
      {renderBrandHeader()}
      {renderCollapseToggle()}
      {renderNav()}
      {footer && !collapsed && (
        <div className="border-t border-surface-3 p-3 text-[10px] text-muted-foreground">
          {footer}
        </div>
      )}
    </aside>
  );

  // ── Mobile hamburger + drawer ────────────────────────────────────────
  const mobileHamburger = (
    <button
      type="button"
      onClick={() => setMobileOpen(true)}
      aria-label="Open navigation menu"
      aria-expanded={mobileOpen}
      className="md:hidden fixed top-3 left-3 z-50 flex h-9 w-9 items-center justify-center rounded-md border border-surface-3 bg-surface-1 text-foreground shadow-sm"
    >
      <span aria-hidden="true" className="text-base leading-none">☰</span>
    </button>
  );

  const mobileDrawer = mobileOpen ? (
    <>
      <div
        data-testid="dashboard-sidebar-backdrop"
        onClick={() => setMobileOpen(false)}
        className="md:hidden fixed inset-0 z-40 bg-black/30"
      />
      <aside
        data-mobile-drawer="open"
        data-testid="dashboard-sidebar-mobile"
        className="md:hidden fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col overflow-hidden border-r border-surface-3 bg-surface-1 shadow-xl"
      >
        {renderBrandHeader()}
        {renderNav(() => setMobileOpen(false))}
        {footer && (
          <div className="border-t border-surface-3 p-3 text-[10px] text-muted-foreground">
            {footer}
          </div>
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
