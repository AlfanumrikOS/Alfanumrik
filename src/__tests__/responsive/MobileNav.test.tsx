import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * MobileNav — mobile bottom navigation tests (2026-05-19).
 *
 * Covers:
 *   - Renders all 5 items, caps to 5 when more are supplied
 *   - aria-current="page" on the active item, none on the others
 *   - Bilingual label switching via useAuth().isHi
 *   - FAB slot gets the .mobile-nav-v2__item--fab modifier
 *   - Badge renders "9+" for counts above 9
 *   - role="navigation" landmark + aria-label
 *   - onItemTap fires before router.push
 */

// Mock next/navigation BEFORE importing the component.
const pushMock = vi.fn();
const pathnameRef = { current: '/dashboard' };
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => pathnameRef.current,
}));

// Mock AuthContext — only isHi is read by MobileNav.
const authState = { isHi: false };
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

import { MobileNav, type MobileNavItem } from '@/components/responsive/MobileNav';

const ITEMS: MobileNavItem[] = [
  { href: '/dashboard', icon: '🏠', label: 'Home',     labelHi: 'होम' },
  { href: '/quiz',      icon: '✏️', label: 'Practice', labelHi: 'अभ्यास' },
  { href: '/foxy',      icon: '🦊', label: 'Foxy',     labelHi: 'फॉक्सी', isFab: true, badge: 12 },
  { href: '/progress',  icon: '📈', label: 'Progress', labelHi: 'प्रगति' },
  { href: '/learn',     icon: '📚', label: 'Learn',    labelHi: 'सीखें' },
];

describe('<MobileNav />', () => {
  beforeEach(() => {
    pushMock.mockReset();
    authState.isHi = false;
    pathnameRef.current = '/dashboard';
  });

  it('renders all 5 items', () => {
    render(<MobileNav items={ITEMS} autoHide={false} />);
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Practice' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Foxy' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Progress' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Learn' })).toBeTruthy();
  });

  it('caps to 5 items even when more are supplied (Nielsen-Norman rule)', () => {
    const extra: MobileNavItem[] = [
      ...ITEMS,
      { href: '/extra', icon: '⭐', label: 'Extra' },
    ];
    render(<MobileNav items={extra} autoHide={false} />);
    expect(screen.queryByRole('button', { name: 'Extra' })).toBeNull();
  });

  it('marks the matching item with aria-current="page"', () => {
    pathnameRef.current = '/quiz';
    render(<MobileNav items={ITEMS} autoHide={false} />);
    expect(
      screen.getByRole('button', { name: 'Practice' }).getAttribute('aria-current'),
    ).toBe('page');
    // Non-active items must not carry the attribute.
    expect(
      screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('treats descendant paths as active (e.g. /dive/123 matches /dive)', () => {
    const navItems: MobileNavItem[] = [
      { href: '/dive', icon: '🌊', label: 'Dive' },
      { href: '/dashboard', icon: '🏠', label: 'Home' },
    ];
    pathnameRef.current = '/dive/123/artifact';
    render(<MobileNav items={navItems} autoHide={false} />);
    expect(
      screen.getByRole('button', { name: 'Dive' }).getAttribute('aria-current'),
    ).toBe('page');
  });

  it('renders Hindi labels when isHi=true', () => {
    authState.isHi = true;
    render(<MobileNav items={ITEMS} autoHide={false} />);
    expect(screen.getByRole('button', { name: 'होम' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'फॉक्सी' })).toBeTruthy();
  });

  it('applies the FAB modifier class to the isFab item', () => {
    const { container } = render(<MobileNav items={ITEMS} autoHide={false} />);
    const fab = container.querySelector('.mobile-nav-v2__item--fab');
    expect(fab).toBeTruthy();
    expect(fab?.textContent).toContain('Foxy');
  });

  it('renders a "9+" badge when count exceeds 9', () => {
    const { container } = render(<MobileNav items={ITEMS} autoHide={false} />);
    const badge = container.querySelector('.mobile-nav-v2__badge');
    expect(badge?.textContent).toBe('9+');
  });

  it('renders the exact badge number for counts ≤ 9', () => {
    const items: MobileNavItem[] = [
      { href: '/inbox', icon: '📥', label: 'Inbox', badge: 3 },
    ];
    const { container } = render(<MobileNav items={items} autoHide={false} />);
    expect(container.querySelector('.mobile-nav-v2__badge')?.textContent).toBe('3');
  });

  it('does not render the badge element when badge=0', () => {
    const items: MobileNavItem[] = [
      { href: '/inbox', icon: '📥', label: 'Inbox', badge: 0 },
    ];
    const { container } = render(<MobileNav items={items} autoHide={false} />);
    expect(container.querySelector('.mobile-nav-v2__badge')).toBeNull();
  });

  it('exposes the navigation landmark with a localized aria-label', () => {
    render(<MobileNav items={ITEMS} autoHide={false} />);
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy();

    authState.isHi = true;
    const { unmount } = render(<MobileNav items={ITEMS} autoHide={false} />);
    expect(screen.getByRole('navigation', { name: 'मुख्य नेविगेशन' })).toBeTruthy();
    unmount();
  });

  it('calls onItemTap then router.push when an item is clicked', () => {
    const onItemTap = vi.fn();
    render(<MobileNav items={ITEMS} autoHide={false} onItemTap={onItemTap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    expect(onItemTap).toHaveBeenCalledTimes(1);
    expect(onItemTap.mock.calls[0][0]).toMatchObject({ href: '/quiz' });
    expect(pushMock).toHaveBeenCalledWith('/quiz');
    // Order: tap fires before navigation.
    expect(onItemTap.mock.invocationCallOrder[0]).toBeLessThan(
      pushMock.mock.invocationCallOrder[0],
    );
  });

  it('respects forceVisible by setting data-hidden="false"', () => {
    const { container } = render(<MobileNav items={ITEMS} forceVisible />);
    const nav = container.querySelector('.mobile-nav-v2');
    expect(nav?.getAttribute('data-hidden')).toBe('false');
  });
});
