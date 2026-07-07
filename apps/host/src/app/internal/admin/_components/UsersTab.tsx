'use client';

/**
 * UsersTab — internal-admin User Management tab.
 *
 * Extracted from src/app/internal/admin/page.tsx as part of Plan 5 Task 7.
 * Behaviour preserved verbatim:
 *   - GET /api/internal/admin/users?role=&page=&limit=25 with optional
 *     search / grade / plan filters — { data, total }
 *   - Role chips: student / teacher / parent (parent → role=guardian)
 *   - Grade + plan selects (student-only)
 *   - Search input
 *   - Per-row checkbox + "select all" header checkbox
 *   - Bulk actions when ≥1 selected: Suspend / Restore / → Premium
 *     (POST /api/internal/admin/bulk-action)
 *   - "View →" per-row button → calls onSelectUser(student) so the parent
 *     page can render <UserDrawer> at top level
 *   - Pagination
 *
 * Cross-cutting state:
 *   - selectedUser is OWNED BY THE PARENT (so <UserDrawer> can mount at top
 *     level above the tab) — UsersTab notifies via onSelectUser.
 *   - refreshKey prop: when bumped by the parent (e.g. after UserDrawer
 *     completes an action), the table re-fetches.
 *
 * Visual styling kept on the legacy `S.*` / `C.*` dark-theme tokens.
 */

import { useState, useEffect, useCallback } from 'react';
import { adminHeaders } from '@alfanumrik/lib/admin-session';
import { useAdminFetch } from '../_hooks/useAdminFetch';
import type { Student } from '../_lib/internal-admin-types';

const C = {
  bg2: '#0d1117',
  border: '#21262d',
  text1: '#e6edf3',
  text2: '#8b949e',
  text3: '#484f58',
  orange: '#E8581C',
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#f59e0b',
  red: '#ef4444',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  badge: (color: string, bg?: string): React.CSSProperties => ({
    fontSize: 10, padding: '2px 8px', borderRadius: 10,
    background: bg || `${color}18`, color,
    fontWeight: 600, whiteSpace: 'nowrap' as const,
  }),
  btn: (color: string = C.orange): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    background: `${color}15`, color, border: `1px solid ${color}30`,
    transition: 'all 0.15s',
  }),
  btnDanger: { padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: `${C.red}15`, color: C.red, border: `1px solid ${C.red}30` },
  input: { padding: '7px 12px', borderRadius: 7, border: `1px solid ${C.border}`, background: C.bg2, color: C.text1, fontSize: 16, outline: 'none', fontFamily: 'inherit' },
  select: { padding: '7px 12px', borderRadius: 7, border: `1px solid ${C.border}`, background: C.bg2, color: C.text1, fontSize: 16, outline: 'none', fontFamily: 'inherit', cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: { textAlign: 'left' as const, padding: '9px 12px', borderBottom: `1px solid ${C.border}`, color: C.text3, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 1.2, whiteSpace: 'nowrap' as const },
  td: { padding: '9px 12px', borderBottom: `1px solid ${C.bg2}`, color: C.text2, verticalAlign: 'middle' as const },
};

export interface UsersTabProps {
  secret: string;
  onSelectUser: (student: Student) => void;
  onToast?: (msg: string) => void;
  /** Bumped by parent after UserDrawer completes an action — triggers re-fetch. */
  refreshKey?: number;
}

export default function UsersTab({ secret, onSelectUser, onToast, refreshKey = 0 }: UsersTabProps) {
  const apiFetch = useAdminFetch(secret);
  const [users, setUsers] = useState<Student[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [userRole, setUserRole] = useState('student');
  const [userSearch, setUserSearch] = useState('');
  const [userGrade, setUserGrade] = useState('');
  const [userPlan, setUserPlan] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());

  const fetchUsers = useCallback(async () => {
    const p = new URLSearchParams({ role: userRole, page: String(userPage), limit: '25' });
    if (userSearch) p.set('search', userSearch);
    if (userGrade) p.set('grade', userGrade);
    if (userPlan) p.set('plan', userPlan);
    try {
      const d = await apiFetch<{ data: Student[]; total: number }>(`/api/internal/admin/users?${p}`);
      setUsers(d.data || []);
      setUserTotal(d.total || 0);
    } catch { /* preserve pre-refactor "if (res.ok)" silent failure */ }
  }, [apiFetch, userRole, userPage, userSearch, userGrade, userPlan]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers, refreshKey]);

  const bulkAction = async (action: string, extras?: Record<string, unknown>) => {
    const ids = Array.from(selectedUsers);
    if (ids.length === 0) { onToast?.('No users selected'); return; }
    const res = await fetch('/api/internal/admin/bulk-action', {
      method: 'POST',
      headers: adminHeaders(secret),
      body: JSON.stringify({ action, ids, ...extras }),
    });
    const d = await res.json();
    onToast?.(res.ok ? `Done: ${d.affected} users affected` : `Error: ${d.error}`);
    setSelectedUsers(new Set());
    fetchUsers();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>User Management</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {selectedUsers.size > 0 && (
            <>
              <button onClick={() => bulkAction('suspend')} style={S.btnDanger}>⛔ Suspend {selectedUsers.size}</button>
              <button onClick={() => bulkAction('restore')} style={S.btn(C.green)}>✅ Restore {selectedUsers.size}</button>
              <button onClick={() => bulkAction('upgrade_plan', { plan: 'premium' })} style={S.btn(C.yellow)}>⭐ → Premium</button>
            </>
          )}
          <button onClick={fetchUsers} style={S.btn()}>↻</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {['student', 'teacher', 'parent'].map(r => (
          <button key={r} onClick={() => { setUserRole(r === 'parent' ? 'guardian' : r); setUserPage(1); }}
            style={{ ...S.btn(), ...(userRole === (r === 'parent' ? 'guardian' : r) ? { background: `${C.orange}20`, borderColor: C.orange } : {}) }}>
            {r === 'student' ? '🎓' : r === 'teacher' ? '👩‍🏫' : '👨‍👩‍👧'} {r}
          </button>
        ))}
        <input value={userSearch} onChange={e => { setUserSearch(e.target.value); setUserPage(1); }}
          placeholder="Search name..." style={{ ...S.input, width: 160 }} />
        {userRole === 'student' && (
          <>
            <select value={userGrade} onChange={e => { setUserGrade(e.target.value); setUserPage(1); }} style={S.select}>
              <option value="">All Grades</option>
              {['6','7','8','9','10','11','12'].map(g => <option key={g} value={g}>Grade {g}</option>)}
            </select>
            <select value={userPlan} onChange={e => { setUserPlan(e.target.value); setUserPage(1); }} style={S.select}>
              <option value="">All Plans</option>
              <option value="free">Free</option>
              <option value="basic">Basic</option>
              <option value="premium">Premium</option>
            </select>
          </>
        )}
      </div>

      <div style={{ fontSize: 11, color: C.text3, marginBottom: 8 }}>
        {userTotal.toLocaleString()} users
        {selectedUsers.size > 0 && ` · ${selectedUsers.size} selected`}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}><input type="checkbox" onChange={e => setSelectedUsers(e.target.checked ? new Set(users.map(u => u.id)) : new Set())} /></th>
              <th style={S.th}>Name</th>
              <th style={S.th}>Email</th>
              {userRole === 'student' && <><th style={S.th}>Grade</th><th style={S.th}>XP</th><th style={S.th}>Plan</th><th style={S.th}>Streak</th></>}
              <th style={S.th}>Status</th>
              <th style={S.th}>Joined</th>
              <th style={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={10} style={{ ...S.td, textAlign: 'center', padding: 32, color: C.text3 }}>No users found</td></tr>
            )}
            {users.map(u => (
              <tr key={u.id} style={{ background: selectedUsers.has(u.id) ? `${C.orange}08` : 'transparent' }}>
                <td style={S.td}>
                  <input type="checkbox" checked={selectedUsers.has(u.id)}
                    onChange={e => { const s = new Set(selectedUsers); e.target.checked ? s.add(u.id) : s.delete(u.id); setSelectedUsers(s); }} />
                </td>
                <td style={{ ...S.td, fontWeight: 600, color: C.text1 }}>{u.name || '—'}</td>
                <td style={{ ...S.td, fontSize: 11 }}>{u.email || '—'}</td>
                {userRole === 'student' && (
                  <>
                    <td style={S.td}>{u.grade || '—'}</td>
                    <td style={S.td}><span style={{ color: C.yellow, fontWeight: 700 }}>{(u.xp_total ?? 0).toLocaleString()}</span></td>
                    <td style={S.td}>
                      <span style={S.badge(u.subscription_plan === 'premium' ? C.yellow : u.subscription_plan === 'basic' ? C.blue : C.text3)}>
                        {u.subscription_plan || 'free'}
                      </span>
                    </td>
                    <td style={S.td}>{u.streak_days ?? 0}🔥</td>
                  </>
                )}
                <td style={S.td}>
                  <span style={S.badge(u.is_active !== false ? C.green : C.red)}>
                    {u.is_active !== false ? 'Active' : 'Suspended'}
                  </span>
                </td>
                <td style={{ ...S.td, fontSize: 11, color: C.text3 }}>{new Date(u.created_at).toLocaleDateString()}</td>
                <td style={S.td}>
                  <button onClick={() => onSelectUser(u)} style={{ ...S.btn(), padding: '4px 10px', fontSize: 11 }}>View →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
        <button disabled={userPage <= 1} onClick={() => setUserPage(p => p - 1)} style={S.btn()}>← Prev</button>
        <span style={{ fontSize: 12, color: C.text3 }}>Page {userPage} / {Math.max(1, Math.ceil(userTotal / 25))}</span>
        <button disabled={users.length < 25} onClick={() => setUserPage(p => p + 1)} style={S.btn()}>Next →</button>
      </div>
    </div>
  );
}
