'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { StatCard, StatusBadge, DataTable, type Column } from '@/components/admin-ui';

/* ─────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────── */
interface Invoice {
  id: string;
  school_id: string;
  school_name: string;
  period_start: string;
  period_end: string;
  seats_used: number;
  amount_inr: number;
  status: 'generated' | 'sent' | 'paid' | 'overdue';
  pdf_url: string | null;
  razorpay_invoice_id: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

interface School {
  id: string;
  name: string;
}

// Hex literal palette (matches deprecated admin-styles.ts colors).
const C = {
  bg: 'var(--surface-1)',
  text1: 'var(--text-1)',
  text2: 'var(--text-2)',
  text3: 'var(--text-3)',
  border: 'var(--border)',
  accent: 'var(--info)',
  success: 'var(--success)',
  successLight: 'color-mix(in srgb, var(--success) 8%, transparent)',
  danger: 'var(--danger)',
  dangerLight: 'color-mix(in srgb, var(--danger) 8%, transparent)',
  warning: 'var(--warning)',
};

/* ─────────────────────────────────────────────────────────────
   STATUS VARIANT HELPER
───────────────────────────────────────────────────────────── */
function statusVariant(status: string): 'success' | 'danger' | 'warning' | 'neutral' | 'info' {
  switch (status) {
    case 'paid': return 'success';
    case 'overdue': return 'danger';
    case 'sent': return 'info';
    case 'generated': return 'warning';
    default: return 'neutral';
  }
}

/* ─────────────────────────────────────────────────────────────
   FORMAT PERIOD
───────────────────────────────────────────────────────────── */
function formatPeriod(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[s.getMonth()]} ${s.getDate()} - ${months[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
}

/* ─────────────────────────────────────────────────────────────
   CONTENT
───────────────────────────────────────────────────────────── */
function InvoicesContent() {
  const { apiFetch } = useAdmin();

  /* State */
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [searchSchool, setSearchSchool] = useState('');

  /* Generate modal state */
  const [showModal, setShowModal] = useState(false);
  const [schools, setSchools] = useState<School[]>([]);
  const [genSchoolId, setGenSchoolId] = useState('');
  const [genPeriodStart, setGenPeriodStart] = useState('');
  const [genPeriodEnd, setGenPeriodEnd] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genMsg, setGenMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /* Action loading */
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  /* ── Fetch invoices ── */
  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), limit: '25' });
      if (filterStatus) p.set('status', filterStatus);
      const res = await apiFetch(`/api/super-admin/invoices?${p}`);
      if (res.ok) {
        const json = await res.json();
        setInvoices(json.data?.invoices || []);
        setTotal(json.data?.pagination?.total || 0);
      }
    } catch { /* */ }
    setLoading(false);
  }, [apiFetch, page, filterStatus]);

  /* ── Fetch schools for modal ── */
  const fetchSchools = useCallback(async () => {
    try {
      const res = await apiFetch('/api/super-admin/institutions?limit=100');
      if (res.ok) {
        const json = await res.json();
        setSchools((json.data || []).map((s: Record<string, unknown>) => ({ id: s.id, name: s.name })));
      }
    } catch { /* */ }
  }, [apiFetch]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  /* ── Generate invoice ── */
  const handleGenerate = async () => {
    if (!genSchoolId || !genPeriodStart || !genPeriodEnd) {
      setGenMsg({ ok: false, text: 'All fields are required' });
      return;
    }
    setGenLoading(true);
    setGenMsg(null);
    try {
      const res = await apiFetch('/api/super-admin/invoices', {
        method: 'POST',
        body: JSON.stringify({
          school_id: genSchoolId,
          period_start: genPeriodStart,
          period_end: genPeriodEnd,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setGenMsg({ ok: true, text: `Invoice generated. Amount: ${Number(json.data?.amount_inr || 0).toLocaleString('en-IN')} INR` });
        fetchInvoices();
        // Reset form after success
        setTimeout(() => { setShowModal(false); setGenMsg(null); setGenSchoolId(''); setGenPeriodStart(''); setGenPeriodEnd(''); }, 2000);
      } else {
        setGenMsg({ ok: false, text: json.error || 'Failed to generate invoice' });
      }
    } catch {
      setGenMsg({ ok: false, text: 'Network error' });
    }
    setGenLoading(false);
  };

  /* ── Update status ── */
  const updateStatus = async (id: string, newStatus: string) => {
    setActionLoading(id);
    try {
      const res = await apiFetch('/api/super-admin/invoices', {
        method: 'PATCH',
        body: JSON.stringify({ id, status: newStatus }),
      });
      if (res.ok) {
        fetchInvoices();
      }
    } catch { /* */ }
    setActionLoading(null);
  };

  /* ── Computed stats ── */
  const totalInvoices = total;
  const pending = invoices.filter(i => i.status === 'generated' || i.status === 'sent').length;
  const paidThisMonth = invoices.filter(i => {
    if (i.status !== 'paid') return false;
    const d = new Date(i.updated_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + (i.amount_inr || 0), 0);

  /* ── Filter invoices by school name (client-side) ── */
  const displayed = searchSchool.trim()
    ? invoices.filter(i => i.school_name.toLowerCase().includes(searchSchool.trim().toLowerCase()))
    : invoices;

  const filterBtnBase = 'rounded-md border border-surface-3 bg-surface-1 px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-2';
  const filterBtnActive = 'rounded-md border border-foreground bg-foreground px-3.5 py-1.5 text-xs font-medium text-surface-1';
  const actionBtnBase = 'rounded-md border bg-transparent px-2.5 py-1 text-xs font-medium hover:bg-surface-2';

  /* ── Table columns ── */
  const columns: Column<Invoice>[] = [
    {
      key: 'school_name',
      label: 'School',
      render: (row) => <strong className="text-foreground">{row.school_name}</strong>,
    },
    {
      key: 'period_start',
      label: 'Period',
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {formatPeriod(row.period_start, row.period_end)}
        </span>
      ),
    },
    {
      key: 'seats_used',
      label: 'Seats',
      render: (row) => <span>{row.seats_used}</span>,
    },
    {
      key: 'amount_inr',
      label: 'Amount',
      render: (row) => (
        <span className="font-semibold text-foreground">
          {Number(row.amount_inr).toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 })}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <StatusBadge label={row.status} variant={statusVariant(row.status)} />,
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      sortable: false,
      render: (row) => (
        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
          {row.status === 'generated' && (
            <button
              onClick={() => updateStatus(row.id, 'sent')}
              disabled={actionLoading === row.id}
              className={`${actionBtnBase} border-info text-info`}
              style={{ borderColor: C.accent, color: C.accent }}
            >
              {actionLoading === row.id ? '...' : 'Mark Sent'}
            </button>
          )}
          {(row.status === 'sent' || row.status === 'overdue') && (
            <button
              onClick={() => updateStatus(row.id, 'paid')}
              disabled={actionLoading === row.id}
              className={`${actionBtnBase} border-success text-success`}
            >
              {actionLoading === row.id ? '...' : 'Mark Paid'}
            </button>
          )}
          {row.status === 'sent' && (
            <button
              onClick={() => updateStatus(row.id, 'overdue')}
              disabled={actionLoading === row.id}
              className={`${actionBtnBase} border-danger text-danger`}
            >
              {actionLoading === row.id ? '...' : 'Mark Overdue'}
            </button>
          )}
          {row.pdf_url && (
            <a
              href={row.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className={`${actionBtnBase} border-surface-3 text-muted-foreground no-underline`}
            >
              PDF
            </a>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Invoice Management</h1>
          <p className="m-0 text-[13px] text-muted-foreground">Generate, track, and manage school invoices</p>
        </div>
        <button
          onClick={() => { setShowModal(true); fetchSchools(); }}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90"
        >
          + Generate Invoice
        </button>
      </div>

      {/* Stat Cards */}
      <div className="mb-6 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <StatCard label="Total Invoices" value={totalInvoices} accentColor={C.accent} />
        <StatCard label="Pending" value={pending} accentColor={C.warning} />
        <StatCard label="Paid This Month" value={paidThisMonth} accentColor={C.success} />
        <StatCard
          label="Total Revenue"
          value={`${totalRevenue.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 })}`}
          accentColor={C.success}
          icon="₹"
        />
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {['', 'generated', 'sent', 'paid', 'overdue'].map(s => (
            <button
              key={s}
              onClick={() => { setFilterStatus(s); setPage(1); }}
              className={filterStatus === s ? filterBtnActive : filterBtnBase}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
        <input
          value={searchSchool}
          onChange={e => setSearchSchool(e.target.value)}
          placeholder="Search school..."
          className="ml-auto w-56 rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Table */}
      <DataTable<Invoice>
        columns={columns}
        data={displayed}
        keyField="id"
        loading={loading}
        emptyMessage="No invoices found"
      />

      {/* Pagination */}
      <div className="mt-3.5 flex items-center justify-center gap-2">
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className={filterBtnBase}>Prev</button>
        <span className="px-3 py-1.5 text-xs text-muted-foreground">
          Page {page} of {Math.max(1, Math.ceil(total / 25))}
        </span>
        <button disabled={invoices.length < 25} onClick={() => setPage(p => p + 1)} className={filterBtnBase}>Next</button>
      </div>

      {/* Generate Invoice Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center"
          style={{ background: 'var(--scrim)' }}
          onClick={() => { setShowModal(false); setGenMsg(null); }}
        >
          <div
            className="w-[420px] max-w-[90vw] rounded-xl border border-surface-3 bg-surface-1 p-7 shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="mb-4 text-xl font-bold tracking-tight text-foreground">Generate Invoice</h2>

            {/* School selector */}
            <div className="mb-3.5">
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                School
              </label>
              <select
                value={genSchoolId}
                onChange={e => setGenSchoolId(e.target.value)}
                className="w-full cursor-pointer rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm"
              >
                <option value="">Select a school...</option>
                {schools.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Period start */}
            <div className="mb-3.5">
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                Period Start
              </label>
              <input
                type="date"
                value={genPeriodStart}
                onChange={e => setGenPeriodStart(e.target.value)}
                className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Period end */}
            <div className="mb-3.5">
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                Period End
              </label>
              <input
                type="date"
                value={genPeriodEnd}
                onChange={e => setGenPeriodEnd(e.target.value)}
                className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Message */}
            {genMsg && (
              <div
                className="mb-3.5 rounded-md px-3 py-2 text-xs font-semibold"
                style={{
                  background: genMsg.ok ? C.successLight : C.dangerLight,
                  color: genMsg.ok ? C.success : C.danger,
                  border: `1px solid ${genMsg.ok ? C.success : C.danger}30`,
                }}
              >
                {genMsg.ok ? '+ ' : '! '}{genMsg.text}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowModal(false); setGenMsg(null); }}
                className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={genLoading}
                className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-surface-1 hover:opacity-90"
                style={{ opacity: genLoading ? 0.6 : 1 }}
              >
                {genLoading ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InvoicesPage() {
  return <AdminShell><InvoicesContent /></AdminShell>;
}
