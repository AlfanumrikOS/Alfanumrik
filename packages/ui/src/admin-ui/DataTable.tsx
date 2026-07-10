'use client';

import { useState, useMemo } from 'react';
import { twMerge } from 'tailwind-merge';

export interface Column<T> {
  key: string;
  label: string;
  width?: number | string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: string;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  emptyMessage?: string;
  loading?: boolean;
  className?: string;
}

const TH_BASE = 'sticky top-0 z-10 bg-surface-2 border-b-2 border-surface-3 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const TD_BASE = 'border-b border-surface-3 px-3.5 py-2.5 text-sm text-foreground';

export default function DataTable<T extends Record<string, unknown>>({
  columns, data, keyField, onRowClick, selectable, selectedIds, onSelectionChange,
  emptyMessage = 'No data', loading, className,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const toggleAll = () => {
    if (!onSelectionChange) return;
    const allIds = new Set(data.map(r => String(r[keyField])));
    if (selectedIds && selectedIds.size === data.length) onSelectionChange(new Set());
    else onSelectionChange(allIds);
  };

  const toggleRow = (id: string) => {
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange(next);
  };

  const allSelected = !!selectedIds && selectedIds.size === data.length && data.length > 0;
  const colSpan = columns.length + (selectable ? 1 : 0);

  return (
    <div className={twMerge('data-table overflow-x-auto rounded-lg border border-surface-3 min-w-0', className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {selectable && (
              <th className={twMerge(TH_BASE, 'w-10 text-center')}>
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="cursor-pointer"
                />
              </th>
            )}
            {columns.map(col => (
              <th
                key={col.key}
                style={{ width: col.width }}
                onClick={() => col.sortable !== false && toggleSort(col.key)}
                className={twMerge(TH_BASE, col.sortable !== false && 'cursor-pointer select-none')}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key && (
                    <span className="text-[10px] text-foreground">{sortDir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={colSpan} className={twMerge(TD_BASE, 'p-8 text-center text-muted-foreground')}>
                Loading...
              </td>
            </tr>
          )}
          {!loading && sortedData.length === 0 && (
            <tr>
              <td colSpan={colSpan} className={twMerge(TD_BASE, 'p-8 text-center text-muted-foreground')}>
                {emptyMessage}
              </td>
            </tr>
          )}
          {!loading && sortedData.map(row => {
            const id = String(row[keyField]);
            const isSelected = selectedIds?.has(id);
            return (
              <tr
                key={id}
                onClick={() => onRowClick?.(row)}
                className={twMerge(
                  'transition-colors',
                  onRowClick && 'cursor-pointer',
                  isSelected ? 'bg-primary/5' : 'hover:bg-surface-2',
                )}
              >
                {selectable && (
                  <td
                    className={twMerge(TD_BASE, 'w-10 text-center')}
                    onClick={e => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select row ${id}`}
                      checked={!!isSelected}
                      onChange={() => toggleRow(id)}
                      className="cursor-pointer"
                    />
                  </td>
                )}
                {columns.map(col => (
                  <td key={col.key} style={{ width: col.width }} className={TD_BASE}>
                    {col.render ? col.render(row) : String(row[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
