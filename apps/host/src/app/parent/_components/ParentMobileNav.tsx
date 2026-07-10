'use client';

import { useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import RoleBottomNav from '@alfanumrik/ui/navigation/RoleBottomNav';
import {
  ROLE_NAV_CONFIGS,
  visibleRoleNavItems,
  type RoleNavItem,
} from '@alfanumrik/ui/navigation/role-nav';

interface ParentMobileNavProps {
  unreadCount: number;
  messagesUnread: number;
  isHi: boolean;
  mode: 'guardian' | 'link-code';
  onLogout: () => void;
}

export default function ParentMobileNav({
  unreadCount,
  messagesUnread,
  isHi,
  mode,
  onLogout,
}: ParentMobileNavProps) {
  const pathname = usePathname();
  const router = useRouter();

  const items = useMemo<RoleNavItem[]>(() => {
    return visibleRoleNavItems(ROLE_NAV_CONFIGS.parent.items, {
      linkCodeMode: mode === 'link-code',
    }).map((item) => {
      if (item.href === '/parent/notifications') return { ...item, badge: unreadCount, badgeVariant: 'warning' };
      if (item.href === '/parent/messages') return { ...item, badge: messagesUnread, badgeVariant: 'danger' };
      return item;
    });
  }, [messagesUnread, mode, unreadCount]);

  return (
    <RoleBottomNav
      config={ROLE_NAV_CONFIGS.parent}
      items={items}
      isHi={isHi}
      pathname={pathname}
      onNavigate={(href) => router.push(href)}
      onLogout={onLogout}
      activeColor="var(--primary)"
    />
  );
}
