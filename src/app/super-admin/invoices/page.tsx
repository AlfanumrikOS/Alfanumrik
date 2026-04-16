'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import StatCard from '../_components/StatCard';
import StatusBadge from '../_components/StatusBadge';
import DataTable, { Column } from '../_components/DataTable';
import { colors, S } from '../_components/admin-styles';

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
}

interface School {
  id: string;
  name: string;
}

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

  /* ── Table columns ── */
  const columns: Column<Invoice>[] = [
    {
      key: 'school_name',
      label: 'School',
      render: (row) => <strong style={{ color: colors.text1 }}>{row.school_name}</strong>,
    },
    {
      key: 'period_start',
      label: 'Period',
      render: (row) => (
        <span style={{ fontSize: 12, color: colors.text2 }}>
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
        <span style={{ fontWeight: 600, color: colors.text1 }}>
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
        <span style={{ fontSize: 12, color: colors.text2 }}>
          {new Date(row.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      sortable: false,
      render: (row) => (
        <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          {row.status === 'generated' && (
            <button
              onClick={() => updateStatus(row.id, 'sent')}
              disabled={actionLoading === row.id}
              style={{ ...S.actionBtn, color: colors.accent, borderColor: colors.accent }}
            >
              {actionLoading === row.id ? '...' : 'Mark Sent'}
            </button>
          )}
          {(row.status === 'sent' || row.status === 'overdue') && (
            <button
              onClick={() => updateStatus(row.id, 'paid')}
              disabled={actionLoading === row.id}
              style={{ ...S.actionBtn, color: colors.success, borderColor: colors.success }}
            >
              {actionLoading === row.id ? '...' : 'Mark Paid'}
            </button>
          )}
          {row.status === 'sent' && (
            <button
              onClick={() => updateStatus(row.id, 'overdue')}
              disabled={actionLoading === row.id}
              style={{ ...S.actionBtn, color: colors.danger, borderColor: colors.danger }}
            >
              {actionLoading === row.id ? '...' : 'Mark Overdue'}
            </button>
          )}
          {row.pdf_url && (
            <a
              href={row.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...S.actionBtn, textDecoration: 'none', color: colors.text2 }}
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={S.h1}>Invoice Management</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>Generate, track, and manage school invoices</p>
        </div>
        <button
          onClick={() => { setShowModal(true); fetchSchools(); }}
          style={S.primaryBtn}
        >
          + Generate Invoice
        </button>
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Invoices" value={totalInvoices} accentColor={colors.accent} />
        <StatCard label="Pending" value={pending} accentColor={colors.warning} />
        <StatCard label="Paid This Month" value={paidThisMonth} accentColor={colors.success} />
        <StatCard
          label="Total Revenue"
          value={`${totalRevenue.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 })}`}
          accentColor={colors.success}
          icon="₹"
        />
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {['', 'generated', 'sent', 'paid', 'overdue'].map(s => (
            <button
              key={s}
              onClick={() => { setFilterStatus(s); setPage(1); }}
              style={{ ...S.filterBtn, ...(filterStatus === s ? S.filterActive : {}) }}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
        <input
          value={searchSchool}
          onChange={e => setSearchSchool(e.target.value)}
          placeholder="Search school..."
          style={{ ...S.searchInput, marginLeft: 'auto' }}
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
      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={S.pageBtn}>Prev</button>
        <span style={{ fontSize: 12, color: colors.text3, padding: '6px 12px' }}>
          Page {page} of {Math.max(1, Math.ceil(total / 25))}
        </span>
        <button disabled={invoices.length < 25} onClick={() => setPage(p => p + 1)} style={S.pageBtn}>Next</button>
      </div>

      {/* Generate Invoice Modal */}
      {showModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => { setShowModal(false); setGenMsg(null); }}
        >
          <div
            style={{
              background: colors.bg, borderRadius: 12, padding: 28, width: 420, maxWidth: '90vw',
              border: `1px solid ${colors.border}`,
              boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ ...S.h1, marginBottom: 16 }}>Generate Invoice</h2>

            {/* School selector */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: colors.text3, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                School
              </label>
              <select
                value={genSchoolId}
                onChange={e => setGenSchoolId(e.target.value)}
                style={{ ...S.select, width: '100%' }}
              >
                <option value="">Select a school...</option>
                {schools.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Period start */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: colors.text3, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Period Start
              </label>
              <input
                type="date"
                value={genPeriodStart}
                onChange={e => setGenPeriodStart(e.target.value)}
                style={{ ...S.searchInput, width: '100%' }}
              />
            </div>

            {/* Period end */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: colors.text3, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Period End
              </label>
              <input
                type="date"
                value={genPeriodEnd}
                onChange={e => setGenPeriodEnd(e.target.value)}
                style={{ ...S.searchInput, width: '100%' }}
              />
            </div>

            {/* Message */}
            {genMsg && (
              <div style={{
                marginBottom: 14, padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: genMsg.ok ? colors.successLight : colors.dangerLight,
                color: genMsg.ok ? colors.success : colors.danger,
                border: `1px solid ${genMsg.ok ? colors.success : colors.danger}30`,
              }}>
                {genMsg.ok ? '+ ' : '! '}{genMsg.text}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowModal(false); setGenMsg(null); }}
                style={S.secondaryBtn}
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={genLoading}
                style={{ ...S.primaryBtn, opacity: genLoading ? 0.6 : 1 }}
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
