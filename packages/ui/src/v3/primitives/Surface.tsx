import type { ReactNode } from 'react';

export interface SurfaceProps {
  as?: 'section' | 'article' | 'div';
  variant?: 'default' | 'raised' | 'sunken' | 'accent';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
  id?: string;
  children: ReactNode;
}

export function Surface({ as: Element = 'section', variant = 'default', padding = 'md', className = '', id, children }: SurfaceProps) {
  return <Element id={id} className={`v3-surface v3-surface--${variant} v3-pad--${padding} ${className}`.trim()}>{children}</Element>;
}

export interface StatusBadgeProps {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'role';
  children: ReactNode;
}

export function StatusBadge({ tone = 'neutral', children }: StatusBadgeProps) {
  return <span className={`v3-status v3-status--${tone}`}>{children}</span>;
}
