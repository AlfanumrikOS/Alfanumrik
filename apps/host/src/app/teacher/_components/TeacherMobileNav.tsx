'use client';

import { useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import RoleBottomNav from '@alfanumrik/ui/navigation/RoleBottomNav';
import {
  ROLE_NAV_CONFIGS,
  visibleRoleNavItems,
  type RoleNavItem,
} from '@alfanumrik/ui/navigation/role-nav';

interface TeacherMobileNavProps {
  commandCenterOn: boolean;
  messagesUnread: number;
  moduleEnablement: Record<string, boolean> | null;
  isHi: boolean;
  onLogout: () => void;
}

export default function TeacherMobileNav({
  commandCenterOn: _commandCenterOn,
  messagesUnread,
  moduleEnablement,
  isHi,
  onLogout,
}: TeacherMobileNavProps) {
  const pathname = usePathname();
  const router = useRouter();

  const items = useMemo<RoleNavItem[]>(() => {
    return visibleRoleNavItems(ROLE_NAV_CONFIGS.teacher.items, { moduleEnablement }).map((item) => {
      if (item.href === '/teacher/messages') {
        return { ...item, badge: messagesUnread, badgeVariant: 'danger' };
      }
      return item;
    });
  }, [messagesUnread, moduleEnablement]);

  return (
    <RoleBottomNav
      config={ROLE_NAV_CONFIGS.teacher}
      items={items}
      isHi={isHi}
      pathname={pathname}
      onNavigate={(href) => router.push(href)}
      onLogout={onLogout}
      activeColor="var(--primary)"
    />
  );
}
