import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ui';

/**
 * Focused unit tests for the reusable <ResponsiveTable<T>> primitive added to
 * src/components/ui/index.tsx (Phase 2A responsive-table consolidation).
 *
 * Contract under test (from the component's own JSDoc):
 *  - >= md: renders a real semantic <table> with <th scope="col"> headers, one
 *    <tr> per data row, cells via render()/accessor()/key-index.
 *  - < md: renders each row as a stacked <dl>/<dt>/<dd> label:value card.
 *  - JSDOM has no viewport + ignores CSS (the layout toggle is `hidden md:block`
 *    / `md:hidden`), so BOTH layouts are present in the DOM at once. We therefore
 *    assert the structures EXIST and scope queries to the relevant subtree rather
 *    than simulating a viewport.
 *  - emptyMessage renders when rows is empty.
 *  - onRowClick fires with the correct row; mobile cards are real <button>s
 *    (keyboard-accessible tap targets).
 *  - Bilingual by contract: headers are already-localized ReactNodes rendered
 *    verbatim — the component hardcodes no English.
 */

type TeacherRow = {
  id: string;
  name: string;
  logins: number;
  active: boolean;
};

const rows: TeacherRow[] = [
  { id: 't1', name: 'Asha Verma', logins: 12, active: true },
  { id: 't2', name: 'Rohit Kumar', logins: 0, active: false },
  { id: 't3', name: 'Priya Nair', logins: 5, active: true },
];

const columns: ResponsiveColumn<TeacherRow>[] = [
  // accessor path
  { key: 'name', header: 'Teacher', accessor: (r) => r.name },
  // bare key-index path (no render/accessor)
  { key: 'logins', header: 'Logins' },
  // custom render path + actions column whose label is hidden on mobile
  {
    key: 'status',
    header: 'Status',
    render: (r) => (r.active ? 'Active' : 'Inactive'),
    align: 'right',
    hideLabelOnMobile: true,
  },
];

// Index-able variant so the bare-key column resolves a value.
type IndexedRow = TeacherRow & Record<string, unknown>;
const indexedRows = rows as IndexedRow[];

function renderTable(
  overrides?: Partial<React.ComponentProps<typeof ResponsiveTable<IndexedRow>>>,
) {
  return render(
    <ResponsiveTable<IndexedRow>
      columns={columns as ResponsiveColumn<IndexedRow>[]}
      rows={indexedRows}
      rowKey={(r) => r.id}
      caption="Teacher engagement"
      {...overrides}
    />,
  );
}

// The desktop semantic <table> lives inside the `hidden md:block` wrapper.
function getDesktopTable(): HTMLTableElement {
  const table = screen.getByRole('table', { hidden: true });
  return table as HTMLTableElement;
}

describe('ui/ResponsiveTable — desktop semantics', () => {
  it('renders a semantic <table> with <th scope="col"> headers, one per column', () => {
    renderTable();
    const table = getDesktopTable();

    const headerCells = within(table).getAllByRole('columnheader', { hidden: true });
    expect(headerCells).toHaveLength(columns.length);
    headerCells.forEach((th) => expect(th).toHaveAttribute('scope', 'col'));

    // Header text comes verbatim from the caller-localized `header` prop.
    expect(within(table).getByText('Teacher')).toBeInTheDocument();
    expect(within(table).getByText('Logins')).toBeInTheDocument();
    expect(within(table).getByText('Status')).toBeInTheDocument();
  });

  it('renders exactly one <tr> per data row in <tbody>', () => {
    renderTable();
    const table = getDesktopTable();
    const tbody = table.querySelector('tbody');
    expect(tbody).not.toBeNull();
    const bodyRows = within(tbody as HTMLElement).getAllByRole('row', { hidden: true });
    expect(bodyRows).toHaveLength(rows.length);
  });

  it('renders cell values via accessor(), bare key-index, and custom render()', () => {
    renderTable();
    const table = getDesktopTable();

    // accessor() column
    expect(within(table).getByText('Asha Verma')).toBeInTheDocument();
    // bare key-index column (no render/accessor): row['logins']
    expect(within(table).getByText('12')).toBeInTheDocument();
    // custom render() column derives a string from the row
    expect(within(table).getAllByText('Active').length).toBeGreaterThan(0);
    expect(within(table).getByText('Inactive')).toBeInTheDocument();
  });

  it('exposes the caller-localized caption to assistive tech', () => {
    renderTable();
    const table = getDesktopTable();
    expect(within(table).getByText('Teacher engagement')).toBeInTheDocument();
  });
});

describe('ui/ResponsiveTable — mobile card mode', () => {
  // The mobile cards live in the `md:hidden` wrapper as <dl>/<dt>/<dd>.
  function getCardLists(): HTMLElement[] {
    return Array.from(document.querySelectorAll('dl')) as HTMLElement[];
  }

  it('renders one <dl> card per row with <dt> labels and <dd> values', () => {
    renderTable();
    const cards = getCardLists();
    expect(cards).toHaveLength(rows.length);

    const firstCard = cards[0];
    // Labels are the localized headers, surfaced as <dt> on mobile.
    const dts = Array.from(firstCard.querySelectorAll('dt')).map((n) => n.textContent);
    expect(dts).toContain('Teacher');
    expect(dts).toContain('Logins');

    // Values are surfaced as <dd>.
    const dds = Array.from(firstCard.querySelectorAll('dd')).map((n) => n.textContent);
    expect(dds).toContain('Asha Verma');
    expect(dds).toContain('12');
    expect(dds).toContain('Active');
  });

  it('omits the <dt> label for a hideLabelOnMobile column but still renders its value', () => {
    renderTable();
    const firstCard = getCardLists()[0];

    // Status column has hideLabelOnMobile: true → no "Status" <dt> in the card,
    // but its value is still present as a <dd>.
    const dts = Array.from(firstCard.querySelectorAll('dt')).map((n) => n.textContent);
    expect(dts).not.toContain('Status');

    const dds = Array.from(firstCard.querySelectorAll('dd')).map((n) => n.textContent);
    expect(dds).toContain('Active');
    // dt count = visible-label columns only (2 of 3); dd count = all columns (3).
    expect(firstCard.querySelectorAll('dt')).toHaveLength(2);
    expect(firstCard.querySelectorAll('dd')).toHaveLength(3);
  });
});

describe('ui/ResponsiveTable — empty state', () => {
  it('renders emptyMessage (and no table) when rows is empty', () => {
    render(
      <ResponsiveTable<IndexedRow>
        columns={columns as ResponsiveColumn<IndexedRow>[]}
        rows={[]}
        rowKey={(r) => r.id}
        emptyMessage="No teachers yet"
      />,
    );
    expect(screen.getByText('No teachers yet')).toBeInTheDocument();
    expect(screen.queryByRole('table', { hidden: true })).not.toBeInTheDocument();
    expect(document.querySelector('dl')).toBeNull();
  });
});

describe('ui/ResponsiveTable — onRowClick / keyboard accessibility', () => {
  it('renders mobile rows as real <button>s and fires onRowClick with the right row', () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });

    // Mobile cards become <button>s — keyboard-focusable, native Enter/Space.
    const rowButtons = screen
      .getAllByRole('button', { hidden: true })
      .filter((b) => b.textContent?.includes('Rohit Kumar'));
    expect(rowButtons.length).toBeGreaterThan(0);

    fireEvent.click(rowButtons[0]);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(indexedRows[1], 1);
  });

  it('fires onRowClick from the desktop <tr> with the correct row + index', () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });

    const table = getDesktopTable();
    const tbody = table.querySelector('tbody') as HTMLElement;
    const bodyRows = within(tbody).getAllByRole('row', { hidden: true });

    fireEvent.click(bodyRows[2]);
    expect(onRowClick).toHaveBeenCalledWith(indexedRows[2], 2);
  });

  it('does not make rows interactive when onRowClick is absent', () => {
    renderTable();
    // No row-level <button>s should exist when onRowClick is not provided.
    const interactive = screen
      .queryAllByRole('button', { hidden: true })
      .filter((b) => /Asha Verma|Rohit Kumar|Priya Nair/.test(b.textContent ?? ''));
    expect(interactive).toHaveLength(0);
  });
});

describe('ui/ResponsiveTable — bilingual (verbatim headers, no hardcoded English)', () => {
  it('renders Hindi headers and values exactly as passed by the caller', () => {
    const hiColumns: ResponsiveColumn<IndexedRow>[] = [
      { key: 'name', header: 'शिक्षक', accessor: (r) => r.name },
      { key: 'logins', header: 'लॉगिन', accessor: (r) => String(r.logins) },
    ];
    render(
      <ResponsiveTable<IndexedRow>
        columns={hiColumns}
        rows={indexedRows}
        rowKey={(r) => r.id}
        caption="शिक्षक सहभागिता"
      />,
    );

    // Localized header appears verbatim in BOTH the desktop <th> and mobile <dt>.
    const table = getDesktopTable();
    expect(within(table).getByText('शिक्षक')).toBeInTheDocument();
    expect(within(table).getByText('लॉगिन')).toBeInTheDocument();

    const firstCard = (document.querySelectorAll('dl')[0]) as HTMLElement;
    const dts = Array.from(firstCard.querySelectorAll('dt')).map((n) => n.textContent);
    expect(dts).toContain('शिक्षक');
    expect(dts).toContain('लॉगिन');

    // The component injects no English chrome of its own.
    expect(screen.queryByText(/teacher/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/logins/i)).not.toBeInTheDocument();
  });
});
