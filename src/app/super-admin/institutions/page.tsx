'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import DataTable, { Column } from '../_components/DataTable';
import DetailDrawer from '../_components/DetailDrawer';
import StatusBadge from '../_components/StatusBadge';
import StatCard from '../_components/StatCard';
import { colors, S } from '../_components/admin-styles';

interface InstitutionRecord {
  id: string; name: string; board: string; city?: string; state?: string;
  principal_name?: string; email?: string; phone?: string; max_students?: number;
  max_teachers?: number; subscription_plan?: string; is_active?: boolean; created_at?: string;
  [key: string]: unknown;
}

function InstitutionsContent() {
  const { apiFetch } = useAdmin();
  const [institutions, setInstitutions] = useState<InstitutionRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<InstitutionRecord | null>(null);

  const fetchInstitutions = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch(`/api/super-admin/institutions?page=${page}&limit=25`);
    if (res.ok) { const d = await res.json(); setInstitutions(d.data || []); setTotal(d.total || 0); }
    setLoading(false);
  }, [apiFetch, page]);

  useEffect(() => { fetchInstitutions(); }, [fetchInstitutions]);

  const toggleInstitution = async (inst: InstitutionRecord) => {
    await apiFetch('/api/super-admin/institutions', {
      method: 'PATCH', body: JSON.stringify({ id: inst.id, updates: { is_active: !inst.is_active } }),
    });
    fetchInstitutions();
  };

  const columns: Column<InstitutionRecord>[] = [
    { key: 'name', label: 'School', render: r => <strong style={{ color: colors.text1 }}>{r.name || '—'}</strong> },
    { key: 'board', label: 'Board' },
    { key: 'city', label: 'City' },
    { key: 'principal_name', label: 'Principal' },
    { key: 'max_students', label: 'Students', render: r => <span style={{ fontWeight: 600 }}>{r.max_students ?? '—'}</span> },
    { key: 'max_teachers', label: 'Teachers' },
    { key: 'subscription_plan', label: 'Plan', render: r => <StatusBadge label={r.subscription_plan || 'free'} variant={r.subscription_plan && r.subscription_plan !== 'free' ? 'info' : 'neutral'} /> },
    { key: 'is_active', label: 'Status', render: r => <StatusBadge label={r.is_active !== false ? 'Active' : 'Suspended'} variant={r.is_active !== false ? 'success' : 'danger'} /> },
    { key: '_actions', label: 'Actions', sortable: false, render: r => (
      <button onClick={e => { e.stopPropagation(); toggleInstitution(r); }} style={{
        ...S.actionBtn,
        color: r.is_active !== false ? colors.danger : colors.success,
        borderColor: r.is_active !== false ? colors.danger : colors.success,
      }}>{r.is_active !== false ? 'Suspend' : 'Activate'}</button>
    )},
  ];

  const activeCount = institutions.filter(i => i.is_active !== false).length;
  const cbseCount = institutions.filter(i => i.board?.toUpperCase().includes('CBSE')).length;
  const withSubCount = institutions.filter(i => i.subscription_plan && i.subscription_plan !== 'free').length;

  const exportCSV = () => {
    const header = 'Name,Board,City,State,Principal,Email,Plan,Active';
    const rows = institutions.map(i =>
      `"${i.name || ''}","${i.board || ''}","${i.city || ''}","${i.state || ''}","${i.principal_name || ''}","${i.email || ''}","${i.subscription_plan || ''}","${i.is_active ?? ''}"`
    );
    const csv = header + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'alfanumrik-institutions.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={S.h1}>Institutions</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>Manage onboarded schools, their admins, and subscription status</p>
        </div>
        <button onClick={exportCSV} style={S.secondaryBtn}>Export CSV</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Institutions" value={total} icon="🏫" accentColor={colors.accent} />
        <StatCard label="Active" value={activeCount} icon="✅" accentColor={colors.success} />
        <StatCard label="CBSE Board" value={cbseCount} icon="📋" accentColor={colors.warning} />
        <StatCard label="With Subscription" value={withSubCount} icon="💳" accentColor={colors.accent} />
      </div>

      <div style={{ fontSize: 12, color: colors.text3, marginBottom: 8 }}>{total} schools found</div>

      <DataTable columns={columns} data={institutions} keyField="id" onRowClick={setSelected} loading={loading} emptyMessage="No schools onboarded yet" />

      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={S.pageBtn}>Prev</button>
        <span style={{ fontSize: 12, color: colors.text3, padding: '6px 12px' }}>Page {page} of {Math.max(1, Math.ceil(total / 25))}</span>
        <button disabled={institutions.length < 25} onClick={() => setPage(p => p + 1)} style={S.pageBtn}>Next</button>
      </div>

      <DetailDrawer open={!!selected} onClose={() => setSelected(null)} title={selected?.name || 'Institution Details'}>
        {selected && (
          <div>
            {Object.entries(selected).filter(([k]) => k !== 'id').map(([key, value]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${colors.borderLight}` }}>
                <span style={{ fontSize: 12, color: colors.text3, textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</span>
                <span style={{ fontSize: 12, color: colors.text1, fontWeight: 500 }}>
                  {value === null || value === undefined ? '—' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                </span>
              </div>
            ))}
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button onClick={() => { toggleInstitution(selected); setSelected(null); }} style={{
                ...S.actionBtn,
                color: selected.is_active !== false ? colors.danger : colors.success,
                borderColor: selected.is_active !== false ? colors.danger : colors.success,
                padding: '8px 16px',
              }}>{selected.is_active !== false ? 'Suspend' : 'Activate'}</button>
            </div>
            <div style={{ marginTop: 16, fontSize: 10, color: colors.text3 }}>ID: <code>{selected.id}</code></div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}

export default function InstitutionsPage() {
  return <AdminShell><InstitutionsContent /></AdminShell>;
}
