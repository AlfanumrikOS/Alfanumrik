'use client';

import { useState, useMemo } from 'react';
import { colors, S } from './admin-styles';

export interface Column<T> {
  key: string;
  label: string;
  width?: number | string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: string;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  emptyMessage?: string;
  loading?: boolean;
}

export default function DataTable<T extends Record<string, unknown>>({
  columns, data, keyField, onRowClick, selectable, selectedIds, onSelectionChange, emptyMessage = 'No data', loading,
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
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
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

  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${colors.border}`, borderRadius: 8 }}>
      <table style={S.table}>
        <thead>
          <tr>
            {selectable && (
              <th style={{ ...S.th, width: 40, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={!!selectedIds && selectedIds.size === data.length && data.length > 0}
                  onChange={toggleAll}
                  style={{ cursor: 'pointer' }}
                />
              </th>
            )}
            {columns.map(col => (
              <th
                key={col.key}
                style={{ ...S.th, width: col.width, cursor: col.sortable !== false ? 'pointer' : 'default', userSelect: 'none' }}
                onClick={() => col.sortable !== false && toggleSort(col.key)}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {col.label}
                  {sortKey === col.key && (
                    <span style={{ fontSize: 10, color: colors.text1 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} style={{ ...S.td, textAlign: 'center', color: colors.text3, padding: 32 }}>
                Loading...
              </td>
            </tr>
          )}
          {!loading && sortedData.length === 0 && (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} style={{ ...S.emptyState, borderBottom: 'none' }}>
                <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.3 }}>∅</div>
                <div style={{ fontWeight: 500 }}>{emptyMessage}</div>
              </td>
            </tr>
          )}
          {!loading && sortedData.map((row, idx) => {
            const id = String(row[keyField]);
            const isSelected = selectedIds?.has(id);
            const zebraColor = idx % 2 === 1 ? colors.surface : colors.bg;
            return (
              <tr
                key={id}
                onClick={() => onRowClick?.(row)}
                style={{
                  cursor: onRowClick ? 'pointer' : 'default',
                  background: isSelected ? colors.accentLight : zebraColor,
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = colors.surfaceHover; }}
                onMouseLeave={e => { e.currentTarget.style.background = isSelected ? colors.accentLight : zebraColor; }}
              >
                {selectable && (
                  <td style={{ ...S.td, textAlign: 'center', width: 40 }} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={!!isSelected} onChange={() => toggleRow(id)} style={{ cursor: 'pointer' }} />
                  </td>
                )}
                {columns.map(col => (
                  <td key={col.key} style={{ ...S.td, width: col.width }}>
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
