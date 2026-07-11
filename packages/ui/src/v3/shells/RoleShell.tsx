'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type CSSProperties } from 'react';
import { BottomSheet } from '../overlays/Overlay';
import type { NavItem, RoleId, RoleShellProps } from '../foundations/types';

const ROLE_LABELS: Record<RoleId, string> = {
  student: 'Student',
  teacher: 'Teacher',
  parent: 'Parent',
  'school-admin': 'School Admin',
  'super-admin': 'Super Admin',
};

function isActive(item: NavItem, activeHref: string) {
  const itemPath = item.href.split(/[?#]/, 1)[0] || '/';
  const activePath = activeHref.split(/[?#]/, 1)[0] || '/';
  if (item.exact) return activePath === itemPath;
  return activePath === itemPath || activePath.startsWith(`${itemPath}/`);
}

function NavLink({ item, activeHref, compact = false, onNavigate }: { item: NavItem; activeHref: string; compact?: boolean; onNavigate?: () => void }) {
  const active = isActive(item, activeHref);
  return (
    <Link href={item.href} className={`v3-nav-link ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
      <span className="v3-nav-link__icon" aria-hidden="true">{item.icon || item.label.charAt(0)}</span>
      <span className="v3-nav-link__label">{compact ? (item.shortLabel || item.label) : item.label}</span>
    </Link>
  );
}

export function RoleShell({ role, navigation, activeHref, brand, context, headerActions, mobileMoreItems = [], children, className = '' }: RoleShellProps) {
  const pathname = usePathname();
  const currentHref = activeHref || pathname || '/';
  const [moreOpen, setMoreOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const primaryMobile = navigation.slice(0, 4);
  const overflow = mobileMoreItems.length ? mobileMoreItems : navigation.slice(4);
  const accentStyle = brand?.accent ? ({ '--v3-tenant-accent': brand.accent } as CSSProperties) : undefined;

  return (
    <div className={`v3-role-shell ${className}`.trim()} style={accentStyle}>
      <header className="v3-mobile-topbar" data-v3-shell-background>
        <Link href={navigation[0]?.href || '/'} className="v3-brand" aria-label={`${brand?.name || 'Alfanumrik'} ${ROLE_LABELS[role]} home`}>
          {brand?.logoUrl ? <Image src={brand.logoUrl} width={32} height={32} alt="" className="v3-brand__logo" /> : <span className="v3-brand__mark" aria-hidden="true">A</span>}
          <span><strong>{brand?.name || 'Alfanumrik'}</strong><small>{ROLE_LABELS[role]}</small></span>
        </Link>
        <div className="v3-mobile-topbar__actions">
          {context ? <button type="button" className="v3-mobile-context-button" onClick={() => setContextOpen(true)} aria-haspopup="dialog" aria-expanded={contextOpen}>Context</button> : null}
          {headerActions}
        </div>
      </header>

      <aside className="v3-sidebar" aria-label={`${ROLE_LABELS[role]} navigation`} data-v3-shell-navigation data-v3-shell-background>
        <Link href={navigation[0]?.href || '/'} className="v3-brand v3-brand--sidebar" aria-label={`${brand?.name || 'Alfanumrik'} home`}>
          {brand?.logoUrl ? <Image src={brand.logoUrl} width={36} height={36} alt="" className="v3-brand__logo" /> : <span className="v3-brand__mark" aria-hidden="true">A</span>}
          <span className="v3-brand__copy"><strong>{brand?.name || 'Alfanumrik'}</strong><small>{ROLE_LABELS[role]}</small></span>
        </Link>
        <nav className="v3-sidebar__nav">{navigation.map((item) => <NavLink key={item.href} item={item} activeHref={currentHref} />)}</nav>
        {context ? <div className="v3-sidebar__context">{context}</div> : null}
      </aside>

      <div className="v3-shell-workspace" data-v3-shell-background>
        {(context || headerActions) ? <div className="v3-workspace-bar"><div>{context}</div><div className="v3-workspace-bar__actions">{headerActions}</div></div> : null}
        <main id="main-content" tabIndex={-1} className="v3-main" data-v3-shell-content>{children}</main>
      </div>

      <nav className="v3-bottom-nav" aria-label={`${ROLE_LABELS[role]} primary navigation`} data-v3-shell-navigation data-v3-shell-background>
        {primaryMobile.map((item) => <NavLink key={item.href} item={item} activeHref={currentHref} compact />)}
        <button type="button" className={`v3-nav-link ${overflow.some((item) => isActive(item, currentHref)) ? 'is-active' : ''}`} onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}>
          <span className="v3-nav-link__icon" aria-hidden="true">•••</span><span className="v3-nav-link__label">More</span>
        </button>
      </nav>

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More" description={`${ROLE_LABELS[role]} tools and settings`}>
        <nav className="v3-more-nav" aria-label="More destinations">
          {overflow.map((item) => <NavLink key={item.href} item={item} activeHref={currentHref} onNavigate={() => setMoreOpen(false)} />)}
        </nav>
      </BottomSheet>
      <BottomSheet open={contextOpen} onClose={() => setContextOpen(false)} title="Current context" description={`Change the active ${ROLE_LABELS[role].toLowerCase()} scope`}>
        <div className="v3-mobile-context-sheet">{context}</div>
      </BottomSheet>
    </div>
  );
}
