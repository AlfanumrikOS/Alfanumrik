import type { ReactNode } from 'react';

export type RoleId = 'student' | 'teacher' | 'parent' | 'school-admin' | 'super-admin';

export interface NavItem {
  label: string;
  shortLabel?: string;
  href: string;
  icon?: ReactNode;
  capability?: string;
  exact?: boolean;
}

export interface TenantBrand {
  name: string;
  logoUrl?: string;
  accent?: string;
}

export interface RoleShellProps {
  role: RoleId;
  navigation: NavItem[];
  activeHref?: string;
  brand?: TenantBrand;
  context?: ReactNode;
  headerActions?: ReactNode;
  mobileMoreItems?: NavItem[];
  children: ReactNode;
  className?: string;
}

export interface ExperienceV3RootProps {
  role: RoleId;
  children: ReactNode;
  className?: string;
}
