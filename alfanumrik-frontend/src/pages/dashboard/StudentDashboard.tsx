import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import DashboardLayout from '../../components/shared/DashboardLayout';
import { StudentProfile, GuardianStudentLink, GuardianProfile } from '../../types/auth';

interface LinkWithGuardian extends GuardianStudentLink { guardian: GuardianProfile; }

export default function StudentDashboard() {
  const { user, profile } = useAuth();
  const student = profile as StudentProfile | null;
  const [links, setLinks] = useState<LinkWithGuardian[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchLinks = useCallback(async () => {
    if (!student) return;
    const { data } = await supabase.from('guardian_student_links').select('*, guardian:guardians(*)').eq('student_id', student.id).order('created_at', { ascending: false });
    if (data) setLinks(data as LinkWithGuardian[]);
  }, [student]);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  const handleCopyCode = () => {
    if (student?.invite_code) { navigator.clipboard.writeText(student.invite_code); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const handleInviteByEmail = async (e: React.FormEvent) => {
    e.preventDefault(); if (!user) return;
    setInviteMsg(null); setInviteLoading(true);
    setInviteMsg({ ok: true, text: `Share your invite code "${student?.invite_code}" with ${inviteEmail}. They can use it during parent signup to connect instantly.` });
    setInviteEmail(''); setInviteLoading(false);
  };

  const handleRespond = async (linkId: string, action: 'approved' | 'rejected') => {
    if (!user) return; setActionLoading(linkId);
    const { data } = await supabase.rpc('student_respond_to_link_request', { p_student_auth_id: user.id, p_link_id: linkId, p_action: action });
    setActionLoading(null);
    if (data && (data as { success: boolean }).success) fetchLinks();
  };

  const handleRevoke = async (linkId: string) => {
    if (!user || !confirm('Revoke this connection?')) return; setActionLoading(linkId);
    await supabase.rpc('revoke_guardian_link', { p_requester_auth_id: user.id, p_link_id: linkId });
    setActionLoading(null); fetchLinks();
  };

  const pending = links.filter(l => l.status === 'pending');
  const approved = links.filter(l => l.status === 'approved');

  return (
    <DashboardLayout>
      <div className="max-w-3xl">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-slate-900">Welcome, {student?.name?.split(' ')[0] || 'Student'} 👋</h1>
          <p className="text-slate-400 text-sm mt-1">{student?.grade} • {student?.board} • {student?.preferred_language === 'hi' ? 'हिन्दी' : 'English'} medium</p>
        </div>

        {/* Invite Code */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-5 shadow-sm">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Your Invite Code</h2>
          <div className="flex items-center gap-4">
            <code className="text-2xl font-extrabold tracking-[0.2em] px-6 py-3 rounded-xl" style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(249,115,22,0.06))', color: '#7c3aed' }}>
              {student?.invite_code || '…'}
            </code>
            <button onClick={handleCopyCode} className="px-4 py-2 text-sm font-bold text-orange-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors">
              {copied ? '✓ Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-3">Share this with your parents so they can connect to your account.</p>
        </div>

        {/* Pending */}
        {pending.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-5">
            <h2 className="text-sm font-bold text-amber-700 mb-3">Pending Requests ({pending.length})</h2>
            <div className="space-y-2.5">
              {pending.map(link => (
                <div key={link.id} className="flex items-center justify-between bg-white rounded-xl p-4 border border-amber-100">
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{link.guardian?.name}</p>
                    <p className="text-xs text-slate-400">{link.guardian?.email} wants to connect</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleRespond(link.id, 'approved')} disabled={actionLoading === link.id}
                      className="px-4 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 disabled:opacity-50">Accept</button>
                    <button onClick={() => handleRespond(link.id, 'rejected')} disabled={actionLoading === link.id}
                      className="px-4 py-1.5 bg-red-50 text-red-600 text-xs font-bold rounded-lg hover:bg-red-100 disabled:opacity-50">Decline</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Invite Parent */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800 mb-3">Invite a Parent</h2>
          <form onSubmit={handleInviteByEmail} className="flex gap-3">
            <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="Parent's email address" required
              className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none"/>
            <button type="submit" disabled={inviteLoading}
              className="px-5 py-2.5 text-white text-sm font-bold rounded-xl hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)' }}>
              {inviteLoading ? 'Sending…' : 'Send Invite'}
            </button>
          </form>
          {inviteMsg && <p className={`mt-3 text-xs font-medium ${inviteMsg.ok ? 'text-green-600' : 'text-red-500'}`}>{inviteMsg.text}</p>}
        </div>

        {/* Connected */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800 mb-4">Connected Parents ({approved.length})</h2>
          {approved.length === 0 ? (
            <p className="text-slate-400 text-sm py-4 text-center">No parents connected yet. Share your invite code above.</p>
          ) : (
            <div className="space-y-2.5">
              {approved.map(link => (
                <div key={link.id} className="flex items-center justify-between bg-slate-50 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-purple-600 font-bold text-sm" style={{ background: 'rgba(124,58,237,0.08)' }}>
                      {link.guardian?.name?.charAt(0) || '?'}
                    </div>
                    <div>
                      <p className="font-bold text-slate-800 text-sm">{link.guardian?.name}</p>
                      <p className="text-xs text-slate-400">{link.guardian?.relationship || 'Parent'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2.5 py-1 rounded-full">Connected</span>
                    <button onClick={() => handleRevoke(link.id)} disabled={actionLoading === link.id} className="text-[10px] text-slate-400 hover:text-red-500 font-medium">Revoke</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
