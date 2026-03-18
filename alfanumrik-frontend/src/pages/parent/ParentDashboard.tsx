import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import DashboardLayout from '../../components/shared/DashboardLayout';
import { GuardianProfile, GuardianStudentLink, StudentProfile } from '../../types/auth';

interface LinkWithStudent extends GuardianStudentLink { student: StudentProfile; }

export default function ParentDashboard() {
  const { user, profile } = useAuth();
  const guardian = profile as GuardianProfile | null;
  const [links, setLinks] = useState<LinkWithStudent[]>([]);
  const [code, setCode] = useState('');
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);

  const fetchLinks = useCallback(async () => {
    if (!guardian) return;
    const { data } = await supabase.from('guardian_student_links').select('*, student:students(*)').eq('guardian_id', guardian.id).order('created_at', { ascending: false });
    if (data) setLinks(data as LinkWithStudent[]);
  }, [guardian]);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  const handleLinkByCode = async (e: React.FormEvent) => {
    e.preventDefault(); if (!user) return;
    setCodeMsg(null); setCodeLoading(true);
    const { data, error } = await supabase.rpc('link_guardian_via_invite_code', { p_guardian_auth_id: user.id, p_invite_code: code.trim() });
    setCodeLoading(false);
    const result = data as { success: boolean; error?: string; status?: string } | null;
    if (error) setCodeMsg({ ok: false, text: error.message });
    else if (result && !result.success) setCodeMsg({ ok: false, text: result.error || 'Failed to link' });
    else { setCodeMsg({ ok: true, text: `Connected successfully! Status: ${result?.status || 'approved'}` }); setCode(''); fetchLinks(); }
  };

  const approved = links.filter(l => l.status === 'approved');
  const pending = links.filter(l => l.status === 'pending');

  return (
    <DashboardLayout>
      <div className="max-w-3xl">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-slate-900">Welcome, {guardian?.name?.split(' ')[0] || 'Parent'} 👋</h1>
          <p className="text-slate-400 text-sm mt-1">Parent Dashboard</p>
        </div>

        {/* Connect via Code */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800 mb-2">Connect to a Student</h2>
          <p className="text-xs text-slate-400 mb-4">Enter your child's invite code. Ask them to share it from their dashboard.</p>
          <form onSubmit={handleLinkByCode} className="flex gap-3">
            <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. 2D792571" required
              className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-mono tracking-wider text-slate-800 placeholder:text-slate-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none uppercase"/>
            <button type="submit" disabled={codeLoading}
              className="px-6 py-2.5 text-white text-sm font-bold rounded-xl hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)' }}>
              {codeLoading ? 'Connecting…' : 'Connect'}
            </button>
          </form>
          {codeMsg && <p className={`mt-3 text-xs font-medium ${codeMsg.ok ? 'text-green-600' : 'text-red-500'}`}>{codeMsg.text}</p>}
        </div>

        {/* Pending */}
        {pending.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-5">
            <h2 className="text-sm font-bold text-amber-700 mb-3">Awaiting Approval ({pending.length})</h2>
            <div className="space-y-2.5">
              {pending.map(link => (
                <div key={link.id} className="flex items-center justify-between bg-white rounded-xl p-4 border border-amber-100">
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{link.student?.name}</p>
                    <p className="text-xs text-slate-400">{link.student?.grade} • Waiting for approval</p>
                  </div>
                  <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-2.5 py-1 rounded-full">Pending</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* My Children */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800 mb-4">My Children ({approved.length})</h2>
          {approved.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">👶</div>
              <p className="text-slate-400 text-sm">No children connected yet.</p>
              <p className="text-xs text-slate-400 mt-1">Use your child's invite code above.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {approved.map(link => (
                <div key={link.id} className="border border-slate-200 rounded-xl p-5 hover:border-orange-300 hover:shadow-sm transition-all">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center text-orange-600 text-xl font-bold" style={{ background: 'rgba(249,115,22,0.08)' }}>
                      {link.student?.name?.charAt(0) || '?'}
                    </div>
                    <div>
                      <p className="font-bold text-slate-900 text-sm">{link.student?.name}</p>
                      <p className="text-xs text-slate-400">{link.student?.grade}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span>🔥 {link.student?.streak_days || 0} day streak</span>
                    <span>⭐ {link.student?.xp_total || 0} XP</span>
                  </div>
                  <button className="w-full mt-3 py-2 text-xs font-bold text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors">View Progress →</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
