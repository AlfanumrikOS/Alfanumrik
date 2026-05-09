import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DataTable, { Column } from '@/components/admin-ui/DataTable';

type Row = { id: string; name: string; age: number; [key: string]: unknown };
const cols: Column<Row>[] = [
  { key: 'name', label: 'Name' },
  { key: 'age', label: 'Age' },
];
const rows: Row[] = [
  { id: '1', name: 'Charlie', age: 30 },
  { id: '2', name: 'Alice', age: 25 },
  { id: '3', name: 'Bob', age: 28 },
];

describe('admin-ui/DataTable', () => {
  it('renders columns and rows', () => {
    render(<DataTable columns={cols} data={rows} keyField="id" />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<DataTable columns={cols} data={[]} keyField="id" loading />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows empty message when no data', () => {
    render(<DataTable columns={cols} data={[]} keyField="id" emptyMessage="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('sorts ascending then descending on header click', () => {
    render(<DataTable columns={cols} data={rows} keyField="id" />);
    const nameHeader = screen.getByText('Name');
    fireEvent.click(nameHeader);
    const cells = screen.getAllByRole('cell').filter(c => /Alice|Bob|Charlie/.test(c.textContent ?? ''));
    expect(cells[0].textContent).toBe('Alice');
    fireEvent.click(nameHeader);
    const cells2 = screen.getAllByRole('cell').filter(c => /Alice|Bob|Charlie/.test(c.textContent ?? ''));
    expect(cells2[0].textContent).toBe('Charlie');
  });

  it('fires onRowClick', () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={cols} data={rows} keyField="id" onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('Charlie'));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('selectable mode toggles selection', () => {
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        columns={cols}
        data={rows}
        keyField="id"
        selectable
        selectedIds={new Set()}
        onSelectionChange={onSelectionChange}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    // First is the header "select all", rest are per-row
    fireEvent.click(checkboxes[1]);
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['1']));
  });
});
