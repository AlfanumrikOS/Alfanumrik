'use client';

import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from './Skeleton';
import { EmptyState, type EmptyStateProps } from './EmptyState';

/* ═══════════════════════════════════════════════════════════════
   Table — canonical primitive (Phase 2 Batch B3)

   A token-driven, accessible data table. Generalizes the admin
   DataTable into a primitive (it does NOT replace DataTable's
   consumers — additive). A11y contract:
     - real semantic <table> with a <caption> OR aria-label.
     - <th scope="col"> for every column header; a column flagged
       `isRowHeader` renders its cell as <th scope="row"> so each
       row keeps a header association.
     - token borders + optional zebra striping; text is always ink
       on surface (AA).
     - loading → Skeleton rows (header preserved); empty → EmptyState
       spanning the grid.

   MOBILE STRATEGY (documented, design-system.md §13): horizontal
   scroll inside a bounded container (`overflow-x-auto`, no clip of the
   header) with a STICKY FIRST COLUMN. The first column pins so the
   row's identity stays visible while the rest scrolls — and because it
   is still a real <th scope="row"> / first cell, the header→cell
   association survives. (Chosen over a stacked-card fallback so column
   headers are never dropped.)

   All copy comes through props (P7).
   ═══════════════════════════════════════════════════════════════ */

export type TableAlign = 'start' | 'center' | 'end';

export interface TableColumn<T> {
  /** Stable id / key for the column. */
  id: string;
  /** Column header content (P7). */
  header: ReactNode;
  /** Cell renderer. If omitted, `accessor` (or the row[id]) is shown. */
  cell?: (row: T, rowIndex: number) => ReactNode;
  /** Simple value accessor when no custom `cell` is needed. */
  accessor?: (row: T) => ReactNode;
  align?: TableAlign;
  /** Render this column's cell as <th scope="row"> (row header). */
  isRowHeader?: boolean;
  /** Fixed width (CSS length or px number). */
  width?: string | number;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  /** Stable row key. */
  getRowKey: (row: T, index: number) => string;
  /** Visible caption. If omitted, provide `aria-label`. */
  caption?: ReactNode;
  /** Accessible name when no visible caption is rendered (P7). */
  'aria-label'?: string;
  /** Zebra-stripe body rows. Default true. */
  zebra?: boolean;
  /** Pin the first column while the rest scrolls horizontally. Default true. */
  stickyFirstColumn?: boolean;
  loading?: boolean;
  /** Skeleton row count while loading. Default 5. */
  loadingRows?: number;
  /** Empty-state config (rendered when not loading and data is empty). */
  empty?: EmptyStateProps;
  onRowClick?: (row: T) => void;
  className?: string;
}

const ALIGN: Record<TableAlign, string> = {
  start: 'text-start',
  center: 'text-center',
  end: 'text-end',
};

const CELL_BASE = 'px-3.5 py-2.5 text-fluid-sm align-middle';
const TH_COL_BASE =
  'sticky top-0 z-20 bg-surface-2 border-b-2 border-surface-3 px-3.5 py-2.5 text-fluid-xs font-semibold uppercase tracking-wide text-muted-foreground';

export function Table<T>({
  columns,
  data,
  getRowKey,
  caption,
  'aria-label': ariaLabel,
  zebra = true,
  stickyFirstColumn = true,
  loading = false,
  loadingRows = 5,
  empty,
  onRowClick,
  className,
}: TableProps<T>) {
  const colCount = columns.length;

  /** First-column sticky classes; the bg must be opaque + match the row. */
  const stickyCol = (rowBgClass: string, isHeader: boolean) =>
    stickyFirstColumn
      ? cn('sticky left-0', isHeader ? 'z-30' : 'z-10', rowBgClass)
      : undefined;

  return (
    <div
      className={cn(
        'w-full min-w-0 overflow-x-auto rounded-xl border border-surface-3',
        className,
      )}
    >
      <table className="w-full border-collapse text-start" aria-label={caption == null ? ariaLabel : undefined}>
        {caption != null && (
          <caption className="px-3.5 py-2.5 text-start text-fluid-sm font-semibold text-foreground">
            {caption}
          </caption>
        )}
        <thead>
          <tr>
            {columns.map((col, ci) => (
              <th
                key={col.id}
                scope="col"
                style={{ width: col.width }}
                className={cn(
                  TH_COL_BASE,
                  ALIGN[col.align ?? 'start'],
                  ci === 0 && stickyCol('bg-surface-2', true),
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: Math.max(1, loadingRows) }, (_, ri) => (
              <tr key={`sk-${ri}`} className="border-b border-surface-3 last:border-0">
                {columns.map((col, ci) => (
                  <td
                    key={col.id}
                    className={cn(CELL_BASE, ci === 0 && stickyCol('bg-surface-1', false))}
                  >
                    <Skeleton className="h-4 w-full" radius="sm" />
                  </td>
                ))}
              </tr>
            ))}

          {!loading && data.length === 0 && (
            <tr>
              <td colSpan={colCount} className="p-0">
                {empty ? (
                  <EmptyState compact {...empty} />
                ) : null}
              </td>
            </tr>
          )}

          {!loading &&
            data.map((row, ri) => {
              // Zebra bg must be explicit on the sticky cell so scrolled
              // content never shows through the pinned column.
              const rowBg = zebra && ri % 2 === 1 ? 'bg-surface-2' : 'bg-surface-1';
              return (
                <tr
                  key={getRowKey(row, ri)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-surface-3 last:border-0 transition-colors motion-reduce:transition-none',
                    rowBg,
                    onRowClick && 'cursor-pointer hover:bg-surface-3',
                  )}
                >
                  {columns.map((col, ci) => {
                    const content = col.cell
                      ? col.cell(row, ri)
                      : col.accessor
                        ? col.accessor(row)
                        : null;
                    const alignClass = ALIGN[col.align ?? 'start'];
                    if (col.isRowHeader) {
                      return (
                        <th
                          key={col.id}
                          scope="row"
                          style={{ width: col.width }}
                          className={cn(
                            CELL_BASE,
                            alignClass,
                            'font-semibold text-foreground',
                            ci === 0 && stickyCol(rowBg, false),
                          )}
                        >
                          {content}
                        </th>
                      );
                    }
                    return (
                      <td
                        key={col.id}
                        style={{ width: col.width }}
                        className={cn(
                          CELL_BASE,
                          alignClass,
                          'text-foreground',
                          ci === 0 && stickyCol(rowBg, false),
                        )}
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
