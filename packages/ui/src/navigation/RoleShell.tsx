'use client';

import type { ReactNode } from 'react';
import { clsx } from 'clsx';

export interface RoleTopBarProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function RoleTopBar({ title, subtitle, actions, className }: RoleTopBarProps) {
  return (
    <header className={clsx('role-top-bar', className)}>
      <div className="min-w-0">
        <h1 className="role-top-bar__title">{title}</h1>
        {subtitle && <p className="role-top-bar__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="role-top-bar__actions">{actions}</div>}
    </header>
  );
}

export interface RoleMoreSheetProps {
  children: ReactNode;
  className?: string;
}

export function RoleMoreSheet({ children, className }: RoleMoreSheetProps) {
  return <div className={clsx('role-more-sheet', className)}>{children}</div>;
}

export interface RoleShellProps {
  topBar?: ReactNode;
  rail?: ReactNode;
  bottomNav?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function RoleShell({ topBar, rail, bottomNav, children, className }: RoleShellProps) {
  return (
    <div className={clsx('role-shell', className)}>
      {rail && <aside className="role-shell__rail">{rail}</aside>}
      <div className="role-shell__body">
        {topBar}
        <main className="role-shell__content">{children}</main>
      </div>
      {bottomNav}
    </div>
  );
}

export default RoleShell;
