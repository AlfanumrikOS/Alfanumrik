'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import DataTable, { Column } from '../_components/DataTable';
import DetailDrawer from '../_components/DetailDrawer';
import StatusBadge from '../_components/StatusBadge';
import { colors, S } from '../_components/admin-styles';

type Entity = 'students' | 'teachers' | 'guardians' | 'institutions' | 'chapters' | 'topics' | 'questions';

const ENTITIES: { key: Entity; label: string }[] = [
  { key: 'students', label: 'Students' },
  { key: 'teachers', label: 'Teachers' },
  { key: 'guardians', label: 'Parents' },
  { key: 'institutions', label: 'Institutions' },
  { key: 'chapters', label: 'Chapters' },
  { key: 'topics', label: 'Topics' },
  { key: 'questions', label: 'Questions' },
];

function WorkbenchContent() {
  const { apiFetch } = useAdmin();
  const [entity, setEntity] = useState<Entity>('students');
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let url = '';
      const roleMap: Record<string, string> = { students: 'student', teachers: 'teacher', guardians: 'guardian' };
      const contentMap: Record<string, string> = { chapters: 'chapters', topics: 'topics', questions: 'questions' };

      if (roleMap[entity]) {
        const p = new URLSearchParams({ role: roleMap[entity], page: String(page), limit: '25' });
        if (search) p.set('search', search);
        url = `/api/super-admin/users?${p}`;
      } else if (entity === 'institutions') {
        url = `/api/super-admin/institutions?page=${page}&limit=25`;
      } else if (contentMap[entity]) {
        url = `/api/super-admin/content?type=${contentMap[entity]}&page=${page}&limit=25`;
      }

      const res = await apiFetch(url);
      if (res.ok) { const d = await res.json(); setData(d.data || []); setTotal(d.total || 0); }
    } catch { /* */ }
    setLoading(false);
  }, [apiFetch, entity, page, search]);

  useEffect(() => { fetchData(); setSelectedIds(new Set()); }, [fetchData]);

  const exportData = async (format: 'csv' | 'json') => {
    const typeMap: Record<string, string> = { students: 'students', teachers: 'teachers', guardians: 'parents' };
    const type = typeMap[entity] || entity;
    const res = await apiFetch(`/api/super-admin/reports?type=${type}&format=${format}`);
    if (!res.ok) { alert('Export failed'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${entity}-${new Date().toISOString().slice(0, 10)}.${format}`; a.click();
    URL.revokeObjectURL(url);
  };

  const getColumns = (): Column<Record<string, unknown>>[] => {
    switch (entity) {
      case 'students':
        return [
          { key: 'name', label: 'Name', render: r => <strong>{String(r.name || '—')}</strong> },
          { key: 'email', label: 'Email', render: r => <span style={{ fontSize: 12, color: colors.text2 }}>{String(r.email || '—')}</span> },
          { key: 'grade', label: 'Grade' },
          { key: 'xp_total', label: 'XP', render: r => <span style={{ fontWeight: 600 }}>{String(r.xp_total ?? 0)}</span> },
          { key: 'subscription_plan', label: 'Plan', render: r => <StatusBadge label={String(r.subscription_plan || 'free')} variant="neutral" /> },
          { key: 'is_active', label: 'Status', render: r => <StatusBadge label={r.is_active !== false ? 'Active' : 'Inactive'} variant={r.is_active !== false ? 'success' : 'danger'} /> },
          { key: 'created_at', label: 'Joined', render: r => <span style={{ fontSize: 12, color: colors.text2 }}>{r.created_at ? new Date(String(r.created_at)).toLocaleDateString() : '—'}</span> },
        ];
      case 'teachers':
        return [
          { key: 'name', label: 'Name', render: r => <strong>{String(r.name || '—')}</strong> },
          { key: 'email', label: 'Email', render: r => <span style={{ fontSize: 12, color: colors.text2 }}>{String(r.email || '—')}</span> },
          { key: 'school_name', label: 'School' },
          { key: 'is_active', label: 'Status', render: r => <StatusBadge label={r.is_active !== false ? 'Active' : 'Inactive'} variant={r.is_active !== false ? 'success' : 'danger'} /> },
          { key: 'created_at', label: 'Joined', render: r => <span style={{ fontSize: 12, color: colors.text2 }}>{r.created_at ? new Date(String(r.created_at)).toLocaleDateString() : '—'}</span> },
        ];
      case 'guardians':
        return [
          { key: 'name', label: 'Name', render: r => <strong>{String(r.name || '—')}</strong> },
          { key: 'email', label: 'Email', render: r => <span style={{ fontSize: 12, color: colors.text2 }}>{String(r.email || '—')}</span> },
          { key: 'is_active', label: 'Status', render: r => <StatusBadge label={r.is_active !== false ? 'Active' : 'Inactive'} variant={r.is_active !== false ? 'success' : 'danger'} /> },
          { key: 'created_at', label: 'Joined', render: r => <span style={{ fontSize: 12, color: colors.text2 }}>{r.created_at ? new Date(String(r.created_at)).toLocaleDateString() : '—'}</span> },
        ];
      case 'institutions':
        return [
          { key: 'name', label: 'School', render: r => <strong>{String(r.name || '—')}</strong> },
          { key: 'board', label: 'Board' },
          { key: 'city', label: 'City' },
          { key: 'principal_name', label: 'Principal' },
          { key: 'max_students', label: 'Students' },
          { key: 'is_active', label: 'Status', render: r => <StatusBadge label={r.is_active !== false ? 'Active' : 'Suspended'} variant={r.is_active !== false ? 'success' : 'danger'} /> },
        ];
      case 'chapters':
        return [
          { key: 'chapter_number', label: '#' },
          { key: 'title', label: 'Title', render: r => <strong>{String(r.title || '—')}</strong> },
          { key: 'subject_code', label: 'Subject' },
          { key: 'grade', label: 'Grade' },
          { key: 'is_active', label: 'Status', render: r => <StatusBadge label={r.is_active !== false ? 'Active' : 'Disabled'} variant={r.is_active !== false ? 'success' : 'neutral'} /> },
        ];
      case 'topics':
        return [
          { key: 'topic_order', label: '#' },
          { key: 'title', label: 'Title', render: r => <strong>{String(r.title || '—')}</strong> },
          { key: 'chapter_id', label: 'Chapter', render: r => <code style={{ fontSize: 10 }}>{String(r.chapter_id || '').slice(0, 8)}</code> },
          { key: 'is_active', label: 'Status', render: r => <StatusBadge label={r.is_active !== false ? 'Active' : 'Disabled'} variant={r.is_active !== false ? 'success' : 'neutral'} /> },
        ];
      case 'questions':
        return [
          { key: 'question_text', label: 'Question', render: r => <span style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{String(r.question_text || '—').slice(0, 80)}</span> },
          { key: 'subject', label: 'Subject' },
          { key: 'grade', label: 'Grade' },
          { key: 'difficulty', label: 'Difficulty' },
          { key: 'is_active', label: 'Status', render: r => <StatusBadge label={r.is_active !== false ? 'Active' : 'Disabled'} variant={r.is_active !== false ? 'success' : 'neutral'} /> },
        ];
      default:
        return [];
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={S.h1}>Data Workbench</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>Browse, search, filter, and export any platform entity</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => exportData('csv')} style={S.secondaryBtn}>Export CSV</button>
          <button onClick={() => exportData('json')} style={S.secondaryBtn}>Export JSON</button>
        </div>
      </div>

      {/* Entity Selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {ENTITIES.map(e => (
          <button key={e.key} onClick={() => { setEntity(e.key); setPage(1); setSearch(''); }}
            style={{ ...S.filterBtn, ...(entity === e.key ? S.filterActive : {}) }}>
            {e.label}
          </button>
        ))}
      </div>

      {/* Search */}
      {['students', 'teachers', 'guardians'].includes(entity) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name..."
            style={{ ...S.searchInput, width: 300 }} onKeyDown={e => e.key === 'Enter' && fetchData()} />
          <button onClick={fetchData} style={S.secondaryBtn}>Search</button>
        </div>
      )}

      <div style={{ fontSize: 12, color: colors.text3, marginBottom: 8 }}>{total} records found</div>

      {/* Table */}
      <DataTable
        columns={getColumns()}
        data={data}
        keyField="id"
        onRowClick={setSelectedRow}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        loading={loading}
        emptyMessage={`No ${entity} found`}
      />

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          background: colors.text1, color: colors.bg, padding: '10px 20px',
          borderRadius: 8, display: 'flex', gap: 12, alignItems: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 50,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedIds.size} selected</span>
          <button onClick={() => setSelectedIds(new Set())} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: colors.bg, padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>Clear</button>
          <button onClick={() => exportData('csv')} style={{ background: colors.bg, color: colors.text1, border: 'none', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Export Selected</button>
        </div>
      )}

      {/* Pagination */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={S.pageBtn}>Prev</button>
        <span style={{ fontSize: 12, color: colors.text3, padding: '6px 12px' }}>Page {page} of {Math.max(1, Math.ceil(total / 25))}</span>
        <button disabled={data.length < 25} onClick={() => setPage(p => p + 1)} style={S.pageBtn}>Next</button>
      </div>

      {/* Detail Drawer */}
      <DetailDrawer open={!!selectedRow} onClose={() => setSelectedRow(null)} title="Record Detail">
        {selectedRow && (
          <div>
            {Object.entries(selectedRow).filter(([k]) => k !== 'id' && k !== 'auth_user_id').map(([key, value]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${colors.borderLight}` }}>
                <span style={{ fontSize: 12, color: colors.text3, textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</span>
                <span style={{ fontSize: 12, color: colors.text1, fontWeight: 500, maxWidth: 250, textAlign: 'right', wordBreak: 'break-word' }}>
                  {value === null || value === undefined ? '—' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : typeof value === 'object' ? JSON.stringify(value).slice(0, 100) : String(value)}
                </span>
              </div>
            ))}
            <div style={{ marginTop: 16, fontSize: 10, color: colors.text3 }}>
              ID: <code>{String(selectedRow.id || '—')}</code>
              {selectedRow.auth_user_id ? <><br />Auth ID: <code>{String(selectedRow.auth_user_id)}</code></> : null}
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}

export default function WorkbenchPage() {
  return <AdminShell><WorkbenchContent /></AdminShell>;
}
