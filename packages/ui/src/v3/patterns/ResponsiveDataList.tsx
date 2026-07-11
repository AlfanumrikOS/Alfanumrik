import type { ReactNode } from 'react';

export interface DataColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  priority?: 'primary' | 'secondary' | 'detail';
}

export interface ResponsiveDataListProps<T> {
  label: string;
  rows: T[];
  columns: DataColumn<T>[];
  getRowKey: (row: T) => string;
  empty?: ReactNode;
}

export function ResponsiveDataList<T>({ label, rows, columns, getRowKey, empty }: ResponsiveDataListProps<T>) {
  if (!rows.length) return <>{empty || <p className="v3-muted">No records available.</p>}</>;
  return (
    <div className="v3-data-region" role="region" aria-label={label} tabIndex={0}>
      <table className="v3-data-table">
        <thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={getRowKey(row)}>{columns.map((column) => <td key={column.key} data-label={column.label} data-priority={column.priority || 'detail'}>{column.render(row)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
