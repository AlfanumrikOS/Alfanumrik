'use client';

import { type ReactNode } from 'react';
import { cn } from '@alfanumrik/lib/utils';
import { Skeleton } from './Skeleton';
import { EmptyState } from './EmptyState';

/* ═══════════════════════════════════════════════════════════════
   ChartFrame — canonical primitive (Gate-2 B2)

   The four-state (design-system.md §4) chrome shell for ANY chart:
   loading skeleton, error (honest failure, role="alert"), empty, or the
   real chart content. Deliberately imports NOTHING chart-library-specific
   — no 'recharts' import here — so it costs nothing to add to a route
   that doesn't otherwise load a chart.

   WHY NOT REWRITE admin-ui/charts (BarChart/LineChart/DonutChart) ONTO
   THIS: those three already implement exactly this loading/empty
   discipline for their own chart type, are P10-hardened (their Recharts
   render body is `next/dynamic`-loaded specifically so the 94.5 kB gzipped
   Recharts chunk doesn't sit in every route's eager bundle — see
   admin-ui/charts/chart-shared.ts's own header comment, which documents a
   real regression from getting this wrong), and have 5 live call sites
   today. Forcing them through a generic wrapper is a real migration with
   its own regression risk, not a Gate-2 B2 "missing component" gap — out
   of scope here. ChartFrame is for NEW chart surfaces (or a caller who
   wants the outer chrome around Recharts content it renders directly)
   that want the same loading/empty/error contract without hand-rolling it
   again. Reserves `height` up front so content swapping in causes zero
   layout shift, matching the admin-ui wrappers' own convention.
   ═══════════════════════════════════════════════════════════════ */

export interface ChartFrameProps {
  /** Pixel height of the frame (content area). Defaults to 240 (the admin-ui charts default). */
  height?: number;
  loading?: boolean;
  /** Truthy (or an Error/message) renders the error state instead of children. */
  error?: boolean | string | Error;
  /** True when there's nothing to chart — renders the empty state instead of children. */
  empty?: boolean;
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  errorTitle?: ReactNode;
  className?: string;
  /** The real chart content (e.g. a Recharts component), rendered only in the success state. */
  children?: ReactNode;
}

function errorMessage(error: ChartFrameProps['error']): string | undefined {
  if (!error) return undefined;
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return undefined;
}

export function ChartFrame({
  height = 240,
  loading = false,
  error,
  empty = false,
  emptyTitle = 'No data to display',
  emptyDescription,
  errorTitle = "Couldn't load this chart",
  className,
  children,
}: ChartFrameProps) {
  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading chart"
        style={{ height }}
        className={cn('flex items-center justify-center', className)}
      >
        <Skeleton radius="lg" className="h-4/5 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height }} className={cn('flex items-center justify-center', className)}>
        <EmptyState role="alert" compact title={errorTitle} description={errorMessage(error)} />
      </div>
    );
  }

  if (empty) {
    return (
      <div style={{ height }} className={cn('flex items-center justify-center', className)}>
        <EmptyState compact title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  return (
    <div style={{ height }} className={className}>
      {children}
    </div>
  );
}
