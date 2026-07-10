'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import {
  getLocalizedRoleNavLabel,
  isRoleNavItemActive,
  RoleNavIcon,
  splitRoleNavItems,
  type RoleIconKey,
  type RoleNavConfig,
  type RoleNavItem,
} from './role-nav';

interface RoleBottomNavProps {
  config: RoleNavConfig;
  items?: RoleNavItem[];
  isHi: boolean;
  pathname: string | null;
  onNavigate: (href: string) => void;
  onLogout?: () => void;
  logoutLabel?: string;
  logoutLabelHi?: string;
  maxVisible?: number;
  activeColor?: string;
  inactiveColor?: string;
  moreContent?: ReactNode;
  reserveMoreSlot?: boolean;
  className?: string;
}

function Badge({ count, variant = 'default' }: { count: number; variant?: RoleNavItem['badgeVariant'] }) {
  if (!count || count <= 0) return null;
  return (
    <span
      className={clsx('role-bottom-nav__badge', variant === 'danger' && 'role-bottom-nav__badge--danger', variant === 'warning' && 'role-bottom-nav__badge--warning')}
      aria-hidden="true"
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

function MoreRow({
  item,
  active,
  isHi,
  onClick,
  disabled,
  trailing,
}: {
  item: RoleNavItem;
  active: boolean;
  isHi: boolean;
  onClick: () => void;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-current={active ? 'page' : undefined}
      aria-disabled={disabled || undefined}
      className="role-bottom-nav__more-row"
      data-active={active ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
    >
      <span className="role-bottom-nav__more-icon" aria-hidden="true">
        <RoleNavIcon iconKey={item.iconKey} />
      </span>
      <span className="role-bottom-nav__more-label">{getLocalizedRoleNavLabel(item, isHi)}</span>
      {trailing}
      <Badge count={item.badge ?? 0} variant={item.badgeVariant} />
    </button>
  );
}

export function RoleBottomNav({
  config,
  items = config.items,
  isHi,
  pathname,
  onNavigate,
  onLogout,
  logoutLabel = 'Logout',
  logoutLabelHi = 'लॉगआउट',
  maxVisible = 5,
  activeColor = 'var(--accent)',
  inactiveColor = 'var(--ink-3)',
  moreContent,
  reserveMoreSlot = true,
  className,
}: RoleBottomNavProps) {
  const [showMore, setShowMore] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  const lastScrollYRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);
  const moreSheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduced) return;
    const onScroll = () => {
      if (rafIdRef.current != null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const y = window.scrollY;
        const delta = y - lastScrollYRef.current;
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

  useEffect(() => {
    if (showMore && moreSheetRef.current) {
      moreSheetRef.current.querySelector('button')?.focus();
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMore(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showMore]);

  const { primary, overflow } = splitRoleNavItems(items, maxVisible);
  const hasMore = overflow.length > 0 || !!onLogout || !!moreContent;
  const renderMoreButton = hasMore && reserveMoreSlot;
  const visiblePrimary = renderMoreButton ? primary.slice(0, Math.max(0, maxVisible - 1)) : primary.slice(0, maxVisible);
  const hiddenByMore = renderMoreButton ? [...primary.slice(Math.max(0, maxVisible - 1)), ...overflow] : overflow;
  const isMoreActive = hiddenByMore.some((item) => isRoleNavItemActive(pathname, item));

  const handleNavigate = (href: string) => {
    setShowMore(false);
    onNavigate(href);
  };

  return (
    <>
      {showMore && (
        <>
          <div className="role-bottom-nav__scrim" onClick={() => setShowMore(false)} role="presentation" aria-hidden="true" />
          <div ref={moreSheetRef} role="dialog" aria-label={isHi ? 'अधिक नेविगेशन विकल्प' : 'More navigation options'} className="role-bottom-nav__sheet">
            <div className="role-bottom-nav__handle" aria-hidden="true" />
            <div className="role-bottom-nav__sheet-body">
              {hiddenByMore.map((item) => (
                <MoreRow
                  key={item.href}
                  item={item}
                  active={isRoleNavItemActive(pathname, item)}
                  isHi={isHi}
                  onClick={() => handleNavigate(item.href)}
                />
              ))}
              {moreContent}
              {onLogout && (
                <div className="role-bottom-nav__sheet-footer">
                  <MoreRow
                    item={{ href: '#logout', label: logoutLabel, labelHi: logoutLabelHi, iconKey: 'logout' as RoleIconKey }}
                    active={false}
                    isHi={isHi}
                    onClick={() => {
                      setShowMore(false);
                      onLogout();
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <nav
        className={clsx('role-bottom-nav', className)}
        role="navigation"
        aria-label={isHi ? config.ariaLabelHi : config.ariaLabel}
        data-scroll-hidden={navHidden ? 'true' : 'false'}
      >
        <div className="role-bottom-nav__items">
          {visiblePrimary.map((item) => {
            const active = isRoleNavItemActive(pathname, item);
            const label = getLocalizedRoleNavLabel(item, isHi);
            return (
              <button
                key={item.href}
                type="button"
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                data-active={active ? 'true' : 'false'}
                data-primary-action={item.isPrimaryAction ? 'true' : 'false'}
                className="role-bottom-nav__item"
                style={{ color: active ? activeColor : inactiveColor }}
                onClick={() => handleNavigate(item.href)}
              >
                <span className="role-bottom-nav__icon" aria-hidden="true">
                  <RoleNavIcon iconKey={item.iconKey} />
                  <Badge count={item.badge ?? 0} variant={item.badgeVariant} />
                </span>
                <span className="role-bottom-nav__label">{label}</span>
              </button>
            );
          })}

          {renderMoreButton && (
            <button
              type="button"
              aria-label={isHi ? 'अधिक विकल्प' : 'More options'}
              aria-expanded={showMore}
              data-active={isMoreActive ? 'true' : 'false'}
              className="role-bottom-nav__item"
              style={{ color: isMoreActive ? activeColor : inactiveColor }}
              onClick={() => setShowMore((value) => !value)}
            >
              <span className="role-bottom-nav__icon" aria-hidden="true">
                <RoleNavIcon iconKey="more" />
              </span>
              <span className="role-bottom-nav__label">{isHi ? 'अधिक' : 'More'}</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}

export default RoleBottomNav;
