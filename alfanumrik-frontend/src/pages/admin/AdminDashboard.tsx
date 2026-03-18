import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import DashboardLayout from '../../components/shared/DashboardLayout';

type Tab = 'overview' | 'users' | 'mappings' | 'audit';

interface UserRow { id: string; auth_user_id: string; name: string; email: string | null; grade?: string; is_active: boolean; account_status?: string; created_at: string; _type: string; }
interface MappingRow { id: string; status: string; created_at: string; guardian: { id: string; name: string; email: string | null; relationship: string }; student: { id: string; name: string; grade: string; invite_code: string }; }
interface AuditRow { id: string; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown> | null; created_at: string; admin_user: { name: string } | null; }

export default function AdminDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState({ students: 0, guardians: 0, pendingLinks: 0, totalLinks: 0 });
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [mappingFilter, setMappingFilter] = useState('');
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [manualGId, setManualGId] = useState('');
  const [manualSId, setManualSId] = useState('');
  const [manualMsg, setManualMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchStats = useCallback(async () => {
    const [s, g, pl, tl] = await Promise.all([
      supabase.from('students').select('id', { count: 'exact', head: true }),
      supabase.from('guardians').select('id', { count: 'exact', head: true }),
      supabase.from('guardian_student_links').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('guardian_student_links').select('id', { count: 'exact', head: true }),
    ]);
    setStats({ students: s.count || 0, guardians: g.count || 0, pendingLinks: pl.count || 0, totalLinks: tl.count || 0 });
  }, []);

  const fetchUsers = useCallback(async () => {
    const search = userSearch.toLowerCase();
    const sq = supabase.from('students').select('id, auth_user_id, name, email, grade, is_active, account_status, created_at').order('created_at', { ascending: false }).limit(50);
    if (search) sq.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    const { data: sData } = await sq;
    const gq = supabase.from('guardians').select('id, auth_user_id, name, email, created_at').order('created_at', { ascending: false }).limit(50);
    if (search) gq.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    const { data: gData } = await gq;
    const students = (sData || []).map(s => ({ ...s, _type: 'student' })) as UserRow[];
    const guardians = (gData || []).map(g => ({ ...g, _type: 'parent', is_active: true })) as UserRow[];
    setUsers([...students, ...guardians].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
  }, [userSearch]);

  const fetchMappings = useCallback(async () => {
    let q = supabase.from('guardian_student_links').select('*, guardian:guardians(id, name, email, relationship), student:students(id, name, grade, invite_code)').order('created_at', { ascending: false }).limit(50);
    if (mappingFilter) q = q.eq('status', mappingFilter);
    const { data } = await q;
    if (data) setMappings(data as unknown as MappingRow[]);
  }, [mappingFilter]);

  const fetchAudit = useCallback(async () => {
    const { data } = await supabase.from('admin_audit_log').select('*, admin_user:admin_users(name)').order('created_at', { ascending: false }).limit(100);
    if (data) setAuditLogs(data as unknown as AuditRow[]);
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { if (tab === 'users') fetchUsers(); if (tab === 'mappings') fetchMappings(); if (tab === 'audit') fetchAudit(); }, [tab, fetchUsers, fetchMappings, fetchAudit]);

  const handleUserAction = async (authUid: string, action: 'deactivate' | 'reactivate' | 'suspend') => {
    if (!user || !confirm(`${action} this user?`)) return;
    setActionLoading(authUid);
    await supabase.rpc('admin_update_user_status', { p_admin_auth_id: user.id, p_target_auth_user_id: authUid, p_action: action });
    setActionLoading(null); fetchUsers();
  };

  const handleMappingOverride = async (linkId: string, action: 'approved' | 'rejected' | 'revoked') => {
    if (!user) return; setActionLoading(linkId);
    await supabase.rpc('admin_override_mapping', { p_admin_auth_id: user.id, p_link_id: linkId, p_action: action, p_notes: 'Admin override' });
    setActionLoading(null); fetchMappings(); fetchStats();
  };

  const handleManualMapping = async (e: React.FormEvent) => {
    e.preventDefault(); if (!user) return; setManualMsg(null);
    const { data, error } = await supabase.rpc('admin_create_mapping', { p_admin_auth_id: user.id, p_guardian_id: manualGId.trim(), p_student_id: manualSId.trim() });
    const r = data as { success: boolean; error?: string } | null;
    if (error) setManualMsg({ ok: false, text: error.message });
    else if (r && !r.success) setManualMsg({ ok: false, text: r.error || 'Failed' });
    else { setManualMsg({ ok: true, text: 'Mapping created & approved!' }); setManualGId(''); setManualSId(''); fetchMappings(); }
  };

  const badge = (s: string) => {
    const c: Record<string, string> = { active: 'bg-green-50 text-green-700', approved: 'bg-green-50 text-green-700', pending: 'bg-amber-50 text-amber-700', deactivated: 'bg-slate-100 text-slate-500', suspended: 'bg-red-50 text-red-600', rejected: 'bg-red-50 text-red-600', revoked: 'bg-slate-100 text-slate-400' };
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c[s] || 'bg-slate-100 text-slate-500'}`}>{s}</span>;
  };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '📊' }, { id: 'users', label: 'Users', icon: '👥' },
    { id: 'mappings', label: 'Mappings', icon: '🔗' }, { id: 'audit', label: 'Audit Logs', icon: '📋' },
  ];

  return (
    <DashboardLayout>
      <div className="max-w-6xl">
        <h1 className="text-2xl font-extrabold text-slate-900 mb-6">Super Admin Panel</h1>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-7 w-fit">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${tab === t.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              <span className="mr-1">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[{ label: 'Students', value: stats.students, icon: '🎓', bg: 'rgba(249,115,22,0.06)' }, { label: 'Parents', value: stats.guardians, icon: '👨‍👩‍👧', bg: 'rgba(124,58,237,0.06)' }, { label: 'Pending Links', value: stats.pendingLinks, icon: '⏳', bg: 'rgba(245,158,11,0.08)' }, { label: 'Total Links', value: stats.totalLinks, icon: '🔗', bg: 'rgba(59,130,246,0.06)' }].map(s => (
              <div key={s.label} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg mb-3" style={{ background: s.bg }}>{s.icon}</div>
                <p className="text-3xl font-extrabold text-slate-900">{s.value}</p>
                <p className="text-xs text-slate-400 mt-1 font-medium">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {tab === 'users' && (
          <div>
            <input type="text" placeholder="Search by name or email…" value={userSearch} onChange={e => setUserSearch(e.target.value)}
              className="w-full max-w-md px-4 py-2.5 border border-slate-200 rounded-xl text-sm mb-4 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none"/>
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200"><tr>
                  <th className="text-left px-4 py-3 font-bold text-slate-500">User</th><th className="text-left px-4 py-3 font-bold text-slate-500">Role</th>
                  <th className="text-left px-4 py-3 font-bold text-slate-500">Status</th><th className="text-left px-4 py-3 font-bold text-slate-500">Joined</th>
                  <th className="text-right px-4 py-3 font-bold text-slate-500">Actions</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3"><p className="font-bold text-slate-800">{u.name}</p><p className="text-[10px] text-slate-400">{u.email || '—'}</p></td>
                      <td className="px-4 py-3"><span className="text-[10px] font-medium text-slate-500">{u._type}</span>{u.grade && <span className="text-[10px] text-slate-400 ml-1">({u.grade})</span>}</td>
                      <td className="px-4 py-3">{badge(u.account_status || (u.is_active ? 'active' : 'deactivated'))}</td>
                      <td className="px-4 py-3 text-[10px] text-slate-400">{new Date(u.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right">{u.auth_user_id && (
                        <div className="flex gap-1 justify-end">
                          {u.is_active && u.account_status !== 'suspended' && (<>
                            <button onClick={() => handleUserAction(u.auth_user_id, 'deactivate')} disabled={actionLoading === u.auth_user_id} className="px-2.5 py-1 text-[10px] font-medium text-slate-500 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50">Deactivate</button>
                            <button onClick={() => handleUserAction(u.auth_user_id, 'suspend')} disabled={actionLoading === u.auth_user_id} className="px-2.5 py-1 text-[10px] font-medium text-red-500 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50">Suspend</button>
                          </>)}
                          {(!u.is_active || u.account_status === 'deactivated' || u.account_status === 'suspended') && (
                            <button onClick={() => handleUserAction(u.auth_user_id, 'reactivate')} disabled={actionLoading === u.auth_user_id} className="px-2.5 py-1 text-[10px] font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100 disabled:opacity-50">Reactivate</button>
                          )}
                        </div>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && <p className="text-center py-8 text-slate-400 text-sm">No users found</p>}
            </div>
          </div>
        )}

        {tab === 'mappings' && (
          <div>
            <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-5 shadow-sm">
              <h3 className="text-xs font-bold text-slate-600 mb-3 uppercase tracking-wider">Manually Create Mapping</h3>
              <form onSubmit={handleManualMapping} className="flex gap-3 items-end">
                <div className="flex-1"><label className="block text-[10px] text-slate-400 mb-1 font-medium">Guardian ID (UUID)</label>
                  <input type="text" value={manualGId} onChange={e => setManualGId(e.target.value)} required placeholder="Guardian table ID" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:border-orange-400 outline-none"/></div>
                <div className="flex-1"><label className="block text-[10px] text-slate-400 mb-1 font-medium">Student ID (UUID)</label>
                  <input type="text" value={manualSId} onChange={e => setManualSId(e.target.value)} required placeholder="Students table ID" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:border-orange-400 outline-none"/></div>
                <button type="submit" className="px-5 py-2 text-white text-xs font-bold rounded-lg hover:opacity-90" style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)' }}>Create</button>
              </form>
              {manualMsg && <p className={`mt-2 text-[10px] font-medium ${manualMsg.ok ? 'text-green-600' : 'text-red-500'}`}>{manualMsg.text}</p>}
            </div>
            <div className="flex gap-2 mb-4 flex-wrap">
              {['', 'pending', 'approved', 'rejected', 'revoked'].map(f => (
                <button key={f} onClick={() => setMappingFilter(f)} className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all ${mappingFilter === f ? 'text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                  style={mappingFilter === f ? { background: 'linear-gradient(135deg, #f97316, #7c3aed)' } : {}}>{f || 'All'}</button>
              ))}
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200"><tr>
                  <th className="text-left px-4 py-3 font-bold text-slate-500">Parent</th><th className="text-left px-4 py-3 font-bold text-slate-500">Student</th>
                  <th className="text-left px-4 py-3 font-bold text-slate-500">Status</th><th className="text-left px-4 py-3 font-bold text-slate-500">Date</th>
                  <th className="text-right px-4 py-3 font-bold text-slate-500">Actions</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {mappings.map(m => (
                    <tr key={m.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3"><p className="font-bold text-slate-800">{m.guardian?.name}</p><p className="text-[10px] text-slate-400">{m.guardian?.email || '—'}</p></td>
                      <td className="px-4 py-3"><p className="font-bold text-slate-800">{m.student?.name}</p><p className="text-[10px] text-slate-400">{m.student?.grade} • {m.student?.invite_code}</p></td>
                      <td className="px-4 py-3">{badge(m.status)}</td>
                      <td className="px-4 py-3 text-[10px] text-slate-400">{new Date(m.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right"><div className="flex gap-1 justify-end">
                        {m.status === 'pending' && (<>
                          <button onClick={() => handleMappingOverride(m.id, 'approved')} disabled={actionLoading === m.id} className="px-2.5 py-1 text-[10px] font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100 disabled:opacity-50">Approve</button>
                          <button onClick={() => handleMappingOverride(m.id, 'rejected')} disabled={actionLoading === m.id} className="px-2.5 py-1 text-[10px] font-medium text-red-500 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50">Reject</button>
                        </>)}
                        {m.status === 'approved' && <button onClick={() => handleMappingOverride(m.id, 'revoked')} disabled={actionLoading === m.id} className="px-2.5 py-1 text-[10px] font-medium text-slate-500 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50">Revoke</button>}
                        {m.status === 'rejected' && <button onClick={() => handleMappingOverride(m.id, 'approved')} disabled={actionLoading === m.id} className="px-2.5 py-1 text-[10px] font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100 disabled:opacity-50">Override→Approve</button>}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {mappings.length === 0 && <p className="text-center py-8 text-slate-400 text-sm">No mappings found</p>}
            </div>
          </div>
        )}

        {tab === 'audit' && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200"><tr>
                <th className="text-left px-4 py-3 font-bold text-slate-500">Action</th><th className="text-left px-4 py-3 font-bold text-slate-500">Entity</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500">Details</th><th className="text-left px-4 py-3 font-bold text-slate-500">Time</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3"><span className="font-mono font-bold text-[10px] text-slate-700 bg-slate-100 px-2 py-0.5 rounded">{log.action}</span></td>
                    <td className="px-4 py-3 text-[10px] text-slate-500">{log.entity_type} {log.entity_id ? `(${log.entity_id.slice(0,8)}…)` : ''}</td>
                    <td className="px-4 py-3 text-[10px] text-slate-400 max-w-[200px] truncate">{log.details ? JSON.stringify(log.details).slice(0,80) : '—'}</td>
                    <td className="px-4 py-3 text-[10px] text-slate-400">{new Date(log.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {auditLogs.length === 0 && <p className="text-center py-8 text-slate-400 text-sm">No audit logs yet</p>}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
