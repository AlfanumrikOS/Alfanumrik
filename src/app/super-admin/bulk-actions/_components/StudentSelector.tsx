'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdmin } from '../../_components/AdminShell';
import DataTable, { Column } from '../../_components/DataTable';
import StatusBadge from '../../_components/StatusBadge';
import { colors, S } from '../../_components/admin-styles';

interface StudentRecord {
  id: string;
  auth_user_id: string;
  name: string;
  email: string;
  grade?: string;
  xp_total?: number;
  subscription_plan?: string;
  is_active?: boolean;
  account_status?: string;
  created_at: string;
  [key: string]: unknown;
}

interface StudentSelectorProps {
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}

const GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const PLANS = ['free', 'starter', 'pro', 'unlimited', 'ultimate_monthly', 'ultimate_yearly'];
const STATUSES = ['all', 'active', 'suspended'];

export default function StudentSelector({ selectedIds, onSelectionChange }: StudentSelectorProps) {
  const { apiFetch } = useAdmin();
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ role: 'student', page: String(page), limit: '25' });
      if (search) p.set('search', search);
      if (gradeFilter) p.set('grade', gradeFilter);
      if (planFilter) p.set('plan', planFilter);
      if (statusFilter === 'active') p.set('is_active', 'true');
      if (statusFilter === 'suspended') p.set('is_active', 'false');
      const res = await apiFetch(`/api/super-admin/users?${p}`);
      if (res.ok) {
        const d = await res.json();
        setStudents(d.data || []);
        setTotal(d.total || 0);
      }
    } catch { /* network error — leave current data */ }
    setLoading(false);
  }, [apiFetch, page, search, gradeFilter, planFilter, statusFilter]);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  const columns: Column<StudentRecord>[] = [
    {
      key: 'name',
      label: 'Name',
      render: r => <strong style={{ color: colors.text1 }}>{r.name || '\u2014'}</strong>,
    },
    {
      key: 'email',
      label: 'Email',
      render: r => <span style={{ fontSize: 12, color: colors.text2 }}>{r.email || '\u2014'}</span>,
    },
    { key: 'grade', label: 'Grade' },
    {
      key: 'xp_total',
      label: 'XP',
      render: r => <span style={{ fontWeight: 600 }}>{r.xp_total ?? 0}</span>,
    },
    {
      key: 'subscription_plan',
      label: 'Plan',
      render: r => {
        const plan = r.subscription_plan || 'free';
        const variant =
          plan === 'unlimited' || plan.startsWith('ultimate') ? 'success' :
          plan.startsWith('pro') ? 'info' :
          plan.startsWith('starter') ? 'warning' : 'neutral';
        return <StatusBadge label={plan} variant={variant} />;
      },
    },
    {
      key: 'is_active',
      label: 'Status',
      render: r => (
        <StatusBadge
          label={r.is_active !== false ? 'Active' : 'Suspended'}
          variant={r.is_active !== false ? 'success' : 'danger'}
        />
      ),
    },
  ];

  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Search</label>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setPage(1); fetchStudents(); } }}
            placeholder="Search by name..."
            style={S.searchInput}
            data-testid="student-search"
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Grade</label>
          <select
            value={gradeFilter}
            onChange={e => { setGradeFilter(e.target.value); setPage(1); }}
            style={S.select}
            data-testid="grade-filter"
          >
            <option value="">All Grades</option>
            {GRADES.map(g => <option key={g} value={g}>Grade {g}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Plan</label>
          <select
            value={planFilter}
            onChange={e => { setPlanFilter(e.target.value); setPage(1); }}
            style={S.select}
            data-testid="plan-filter"
          >
            <option value="">All Plans</option>
            {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: colors.text3, display: 'block', marginBottom: 4 }}>Status</label>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            style={S.select}
            data-testid="status-filter"
          >
            {STATUSES.map(s => <option key={s} value={s}>{s === 'all' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
        <button onClick={() => { setPage(1); fetchStudents(); }} style={S.secondaryBtn}>
          Apply
        </button>
      </div>

      {/* Selection info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: colors.text3 }}>{total} students found</span>
        {selectedIds.size > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: colors.accent }}>{selectedIds.size} selected</span>
            <button
              onClick={() => onSelectionChange(new Set())}
              style={{ ...S.actionBtn, fontSize: 11 }}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={students}
        keyField="id"
        selectable
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
        loading={loading}
        emptyMessage="No students found"
      />

      {/* Pagination */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={S.pageBtn}>Prev</button>
        <span style={{ fontSize: 12, color: colors.text3, padding: '6px 12px' }}>
          Page {page} of {totalPages}
        </span>
        <button disabled={students.length < 25} onClick={() => setPage(p => p + 1)} style={S.pageBtn}>Next</button>
      </div>
    </div>
  );
}
