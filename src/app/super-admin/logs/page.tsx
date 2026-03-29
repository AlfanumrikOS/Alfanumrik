'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { colors, S } from '../_components/admin-styles';

interface AuditEntry {
  id: string; admin_id: string; action: string; entity_type: string; entity_id: string | null;
  details: Record<string, unknown> | null; ip_address: string | null; created_at: string;
}

function LogsContent() {
  const { apiFetch } = useAdmin();
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), limit: '25' });
    if (actionFilter) p.set('action_filter', actionFilter);
    if (entityFilter) p.set('entity_filter', entityFilter);
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    const res = await apiFetch(`/api/super-admin/logs?${p}`);
    if (res.ok) { const d = await res.json(); setLogs(d.data || []); setTotal(d.total || 0); }
    setLoading(false);
  }, [apiFetch, page, actionFilter, entityFilter, dateFrom, dateTo]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const exportCSV = async () => {
    const res = await apiFetch('/api/super-admin/reports?type=audit&format=csv');
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={S.h1}>Audit Logs</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>Complete trail of all admin actions and system events</p>
        </div>
        <button onClick={exportCSV} style={S.secondaryBtn}>Export CSV</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(1); }} placeholder="Filter by action..."
          style={S.searchInput} />
        <select value={entityFilter} onChange={e => { setEntityFilter(e.target.value); setPage(1); }} style={S.select}>
          <option value="">All entities</option>
          <option value="feature_flag">Feature Flag</option>
          <option value="school">School</option>
          <option value="user">User</option>
          <option value="curriculum_topics">Topic</option>
          <option value="question_bank">Question</option>
          <option value="user_roles">Role Assignment</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} style={{ ...S.searchInput, width: 150 }} />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} style={{ ...S.searchInput, width: 150 }} />
        {(actionFilter || entityFilter || dateFrom || dateTo) && (
          <button onClick={() => { setActionFilter(''); setEntityFilter(''); setDateFrom(''); setDateTo(''); setPage(1); }}
            style={{ ...S.actionBtn, fontSize: 12 }}>Clear filters</button>
        )}
      </div>

      <div style={{ fontSize: 12, color: colors.text3, marginBottom: 8 }}>
        {total} entries{actionFilter || entityFilter || dateFrom || dateTo ? ' (filtered)' : ''}
      </div>

      {/* Table */}
      <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Timestamp</th>
              <th style={S.th}>Action</th>
              <th style={S.th}>Resource</th>
              <th style={S.th}>IP</th>
              <th style={S.th}>Admin ID</th>
              <th style={S.th}>Details</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ ...S.td, textAlign: 'center', color: colors.text3, padding: 24 }}>Loading...</td></tr>}
            {!loading && logs.length === 0 && (
              <tr><td colSpan={6} style={{ ...S.td, textAlign: 'center', color: colors.text3, padding: 24 }}>No audit logs</td></tr>
            )}
            {!loading && logs.map(l => (
              <tr key={l.id}>
                <td style={{ ...S.td, fontSize: 12, whiteSpace: 'nowrap', color: colors.text2 }}>{new Date(l.created_at).toLocaleString()}</td>
                <td style={S.td}>
                  <code style={{ fontSize: 12, color: colors.text1, background: colors.surface, padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>{l.action}</code>
                </td>
                <td style={S.td}>
                  <span style={{ color: colors.text2 }}>{l.entity_type}</span>
                  {l.entity_id && <code style={{ color: colors.text3, marginLeft: 4, fontSize: 10 }}>:{l.entity_id.slice(0, 8)}</code>}
                </td>
                <td style={{ ...S.td, fontSize: 11, color: colors.text3 }}>{l.ip_address || '—'}</td>
                <td style={{ ...S.td, fontSize: 11 }}><code style={{ color: colors.text3 }}>{l.admin_id?.slice(0, 12) || '—'}</code></td>
                <td style={{ ...S.td, fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', color: colors.text3 }}>
                  {l.details ? JSON.stringify(l.details).slice(0, 60) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={S.pageBtn}>Prev</button>
        <span style={{ fontSize: 12, color: colors.text3, padding: '6px 12px' }}>Page {page} of {Math.max(1, Math.ceil(total / 25))}</span>
        <button disabled={logs.length < 25} onClick={() => setPage(p => p + 1)} style={S.pageBtn}>Next</button>
      </div>
    </div>
  );
}

export default function LogsPage() {
  return <AdminShell><LogsContent /></AdminShell>;
}
