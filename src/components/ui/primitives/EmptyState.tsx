'use client';

import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ═══════════════════════════════════════════════════════════════
   EmptyState — canonical primitive (Phase 2 Batch A)

   Generalizes the admin NoDataState pattern for every surface: an
   icon/illustration slot + title + description + optional action.
   All copy comes from props (bilingual-safe, P7). role=status so the
   empty condition is announced to assistive tech.
   ═══════════════════════════════════════════════════════════════ */

export interface EmptyStateProps {
  /** Icon or illustration node (emoji, svg, <Image>…). Decorative. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Optional CTA node (e.g. <Button>). */
  action?: ReactNode;
  /** Tighter padding for inline / in-card use. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon, title, description, action, compact = false, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center text-center',
        compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12',
        className,
      )}
    >
      {icon != null && (
        <span aria-hidden="true" className={cn('inline-flex text-muted-foreground', compact ? 'text-fluid-2xl' : 'text-fluid-4xl')}>
          {icon}
        </span>
      )}
      <h3 className="text-fluid-lg font-bold text-foreground">{title}</h3>
      {description != null && (
        <p className="max-w-sm text-fluid-sm text-muted-foreground">{description}</p>
      )}
      {action != null && <div className={cn(compact ? 'mt-1' : 'mt-2')}>{action}</div>}
    </div>
  );
}
