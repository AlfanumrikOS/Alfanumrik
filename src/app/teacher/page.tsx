'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabaseUrl as SUPABASE_URL, supabaseAnonKey as SUPABASE_ANON } from '@/lib/supabase';
import type { HeatmapData, HeatmapCell, RiskAlert } from '@/lib/types';
import { BottomNav } from '@/components/ui';

async function api(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/teacher-dashboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`API error ${res.status}: ${errorText}`);
  }
  return res.json();
}

function heatColor(p: number) {
  if (p >= 0.95) return '#059669';
  if (p >= 0.80) return '#7C3AED';
  if (p >= 0.60) return '#2563EB';
  if (p >= 0.30) return '#D97706';
  if (p > 0.1) return '#F59E0B';
  return '#1E293B';
}

const SEV: Record<string, { bg: string; border: string }> = {
  critical: { bg: '#DC2626', border: '#EF4444' },
  high: { bg: '#EA580C', border: '#F97316' },
  medium: { bg: '#D97706', border: '#F59E0B' },
  low: { bg: '#2563EB', border: '#3B82F6' },
};

function HeatmapTab({ data }: { data: HeatmapData }) {
  const [selected, setSelected] = useState<(HeatmapCell & { student: string; concept: string }) | null>(null);
  if (!data?.matrix?.length) return <div style={{ padding: 40, textAlign: 'center', color: '#475569', fontStyle: 'italic' }}>No mastery data yet — students need to start practicing.</div>;
  const concepts = (data.concepts || []).slice(0, 12);
  return (
    <div className="td-card">
      <div className="td-card-head"><h3>Mastery heatmap</h3><span className="td-badge">{data.student_count} students × {data.concept_count} concepts</span></div>
      <div style={{ overflowX: 'auto', marginTop: 14 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead><tr>
            <th style={{ padding: '6px 8px', color: '#64748B', fontWeight: 500, fontSize: 10, textAlign: 'left', borderBottom: '1px solid #1E293B', minWidth: 110 }}>Student</th>
            <th style={{ padding: '6px 4px', color: '#64748B', fontWeight: 500, fontSize: 10, textAlign: 'center', borderBottom: '1px solid #1E293B' }}>Avg</th>
            {concepts.map((c: any, i: number) => <th key={i} style={{ padding: '6px 4px', color: '#64748B', fontWeight: 500, fontSize: 10, textAlign: 'center', borderBottom: '1px solid #1E293B' }} title={c.title}>Ch{c.chapter}</th>)}
          </tr></thead>
          <tbody>
            {data.matrix.map((row: any, ri: number) => (
              <tr key={ri}>
                <td style={{ padding: '6px 8px', color: '#E2E8F0', fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap' }}>{row.student_name}</td>
                <td style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, color: '#E2E8F0', fontSize: 13 }}>{row.avg_mastery}%</td>
                {(row.cells || []).slice(0, 12).map((cell: any, ci: number) => (
                  <td key={ci} style={{ padding: '5px 3px', textAlign: 'center', cursor: 'pointer' }}
                    onClick={() => setSelected({ student: row.student_name, concept: concepts[ci]?.title, ...cell })}>
                    <span style={{ display: 'inline-block', minWidth: 32, padding: '4px 2px', borderRadius: 4, fontSize: 10, fontWeight: 500, backgroundColor: heatColor(cell.p_know), color: '#fff', opacity: cell.attempts > 0 ? 1 : 0.3 }}>
                      {cell.attempts > 0 ? Math.round(cell.p_know * 100) : '—'}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div style={{ marginTop: 12, padding: 12, backgroundColor: '#1E293B', borderRadius: 8, fontSize: 13, color: '#E2E8F0' }}>
          <strong>{selected.student}</strong> on <strong>{selected.concept}</strong>: P(know) = {Math.round(selected.p_know * 100)}%, level = {selected.level}, {selected.attempts} attempts
          <button onClick={() => setSelected(null)} style={{ marginLeft: 12, fontSize: 11, color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </div>
  );
}

function AlertsTab({ alerts, onResolve }: { alerts: RiskAlert[]; onResolve: (id: string) => void }) {
  if (!alerts?.length) return <div className="td-card"><div className="td-card-head"><h3>At-risk alerts</h3></div><div style={{ padding: 30, textAlign: 'center', color: '#475569', fontStyle: 'italic' }}>No at-risk students detected.</div></div>;
  return (
    <div className="td-card">
      <div className="td-card-head"><h3>At-risk alerts</h3><span className="td-badge" style={{ backgroundColor: '#DC2626' }}>{alerts.length}</span></div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {alerts.map((a: any) => { const s = SEV[a.severity] || SEV.medium; return (
          <div key={a.id} style={{ backgroundColor: '#1E293B', borderRadius: 8, padding: 12, borderLeft: `3px solid ${s.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, backgroundColor: s.bg, color: '#fff', textTransform: 'uppercase' as const }}>{a.severity}</span>
                <span style={{ marginLeft: 8, fontWeight: 600, color: '#F1F5F9', fontSize: 14 }}>{a.title}</span>
              </div>
              <button onClick={() => onResolve(a.id)} style={{ padding: '4px 10px', background: 'transparent', color: '#94A3B8', border: '1px solid #334155', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>Resolve</button>
            </div>
            <p style={{ color: '#94A3B8', fontSize: 13, margin: '6px 0' }}>{a.description}</p>
            {a.recommended_action && <p style={{ color: '#6366F1', fontSize: 12, margin: 0, fontStyle: 'italic' }}>Action: {a.recommended_action}</p>}
          </div>
        ); })}
      </div>
    </div>
  );
}

function PollTab({ classId, teacherId }: { classId: string; teacherId: string }) {
  const [q, setQ] = useState(''); const [opts, setOpts] = useState(['','','','']); const [correctIdx, setCorrectIdx] = useState(0);
  const [poll, setPoll] = useState<any>(null); const [results, setResults] = useState<any>(null); const [loading, setLoading] = useState(false);
  const launch = async () => { if (!q.trim()) return; setLoading(true); const data = await api('launch_poll', { teacher_id: teacherId, class_id: classId, question_text: q, options: opts.filter(o => o.trim()), correct_index: correctIdx, question_type: 'mcq', time_limit: 60 }); setPoll(data); setResults(null); setLoading(false); };
  const close = async () => { if (!poll?.poll_id) return; const data = await api('close_poll', { teacher_id: teacherId, poll_id: poll.poll_id }); setResults(data); setPoll(null); };
  return (
    <div className="td-card">
      <div className="td-card-head"><h3>Classroom response</h3>{poll && <span className="td-badge" style={{ backgroundColor: '#059669' }}>LIVE</span>}</div>
      {!poll && !results && (<div style={{ marginTop: 14 }}>
        <input className="td-input" placeholder="Type your question..." value={q} onChange={e => setQ(e.target.value)} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '10px 0' }}>
          {opts.map((o, i) => (<div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="radio" name="c" checked={correctIdx === i} onChange={() => setCorrectIdx(i)} style={{ accentColor: '#6366F1' }} />
            <input className="td-input" style={{ margin: 0, flex: 1 }} placeholder={`Option ${String.fromCharCode(65+i)}`} value={o} onChange={e => { const n=[...opts]; n[i]=e.target.value; setOpts(n); }} />
          </div>))}
        </div>
        <button className="td-btn-primary" onClick={launch} disabled={loading}>{loading ? 'Launching...' : 'Launch to class'}</button>
      </div>)}
      {poll && !results && (<div style={{ marginTop: 14, backgroundColor: '#1E293B', borderRadius: 8, padding: 14 }}>
        <p style={{ color: '#F1F5F9', fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>{poll.question_text || q}</p>
        <p style={{ color: '#6366F1', fontSize: 24, fontWeight: 700, margin: '8px 0' }}>{poll.response_count ?? 0} responded</p>
        <button className="td-btn-primary" style={{ backgroundColor: '#DC2626', marginTop: 10 }} onClick={close}>Close poll</button>
      </div>)}
      {results && (<div style={{ marginTop: 14, backgroundColor: '#1E293B', borderRadius: 8, padding: 14 }}>
        <span style={{ color: '#059669', fontWeight: 700, fontSize: 18 }}>{results.accuracy_pct}% correct</span>
        <button onClick={() => { setResults(null); setQ(''); setOpts(['','','','']); }} style={{ marginLeft: 12, padding: '4px 10px', background: 'transparent', color: '#6366F1', border: '1px solid #6366F1', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>New question</button>
      </div>)}
    </div>
  );
}

export default function TeacherPage() {
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole } = useAuth();
  const router = useRouter();
  const [dash, setDash] = useState<any>(null); // eslint-disable-line
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [tab, setTab] = useState('heatmap');
  const [loading, setLoading] = useState(true);

  // Get teacher_id from auth session (no more hardcoded IDs)
  const teacherId = teacher?.id || '';
  const classId = dash?.classes?.[0]?.id || '';

  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) {
      router.replace('/');
    }
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  const load = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    const d = await api('get_dashboard', { teacher_id: teacherId });
    setDash(d);
    const firstClassId = d?.classes?.[0]?.id;
    if (firstClassId) {
      const [h, a] = await Promise.all([
        api('get_heatmap', { teacher_id: teacherId, class_id: firstClassId, subject: 'math' }),
        api('get_alerts', { teacher_id: teacherId, class_id: firstClassId }),
      ]);
      setHeatmap(h); setAlerts(a.alerts || []);
    }
    setLoading(false);
  }, [teacherId]);

  useEffect(() => { load(); }, [load]);

  const resolveAlert = async (id: string) => {
    await api('resolve_alert', { teacher_id: teacherId, alert_id: id });
    setAlerts(prev => prev.filter(x => x.id !== id));
  };

  if (loading) return (<div style={pageStyle}><div style={{ textAlign: 'center', padding: 80, color: '#64748B' }}><div style={{ width: 40, height: 40, border: '3px solid #1E293B', borderTopColor: '#6366F1', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />Loading teacher dashboard...</div><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>);

  const cls = dash?.classes?.[0];
  const tabs = [{ id: 'heatmap', label: 'Mastery heatmap' }, { id: 'alerts', label: `Alerts${alerts.length ? ` (${alerts.length})` : ''}` }, { id: 'poll', label: 'Classroom response' }];

  return (
    <div style={pageStyle}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .td-card{background:#0F172A;border-radius:14px;padding:18px 20px;border:1px solid #1E293B} .td-card-head{display:flex;justify-content:space-between;align-items:center} .td-card-head h3{font-size:16px;font-weight:600;color:#F1F5F9;margin:0} .td-badge{font-size:11px;font-weight:600;padding:3px 10px;border-radius:99px;background:#1E293B;color:#94A3B8} .td-input{width:100%;padding:10px 12px;background:#1E293B;border:1px solid #334155;border-radius:8px;color:#E2E8F0;font-size:14px;outline:none;box-sizing:border-box;margin-bottom:8px} .td-btn-primary{padding:10px 20px;background:#6366F1;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;width:100%} .td-btn-primary:disabled{opacity:0.5;cursor:default}`}</style>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #1E293B' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#F8FAFC', margin: 0 }}>{dash?.teacher?.name || 'Teacher Dashboard'}</h1>
          <p style={{ fontSize: 14, color: '#64748B', margin: '4px 0 0' }}>{cls?.name || 'Class 9-A'} ({cls?.student_count || 0} students){cls?.avg_mastery != null && <span style={{ color: '#6366F1', marginLeft: 8 }}>Avg mastery: {cls.avg_mastery}%</span>}</p>
        </div>
        <button onClick={load} style={{ padding: '8px 16px', background: 'transparent', color: '#6366F1', border: '1px solid #6366F1', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Refresh</button>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[{ label: 'Students', val: dash?.stats?.total_students || 0, color: '#6366F1' }, { label: 'Alerts', val: dash?.stats?.active_alerts || 0, color: (dash?.stats?.critical_alerts || 0) > 0 ? '#DC2626' : '#D97706' }, { label: 'Assignments', val: dash?.stats?.active_assignments || 0, color: '#059669' }].map((s,i) => (
          <div key={i} style={{ backgroundColor: '#0F172A', borderRadius: 12, padding: '14px 16px', border: '1px solid #1E293B' }}>
            <p style={{ color: '#64748B', fontSize: 11, margin: 0, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{s.label}</p>
            <p style={{ color: s.color, fontSize: 26, fontWeight: 700, margin: '4px 0 0' }}>{s.val}</p>
          </div>
        ))}
      </div>
      <nav style={{ display: 'flex', gap: 4, padding: 4, backgroundColor: '#0F172A', borderRadius: 10, border: '1px solid #1E293B', marginBottom: 16 }}>
        {tabs.map(t => (<button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: tab === t.id ? 600 : 500, backgroundColor: tab === t.id ? '#6366F1' : 'transparent', color: tab === t.id ? '#fff' : '#64748B' }}>{t.label}</button>))}
      </nav>
      {tab === 'heatmap' && heatmap && <HeatmapTab data={heatmap} />}
      {tab === 'alerts' && <AlertsTab alerts={alerts} onResolve={resolveAlert} />}
      {tab === 'poll' && <PollTab classId={classId} teacherId={teacherId} />}
      <BottomNav />
    </div>
  );
}

const pageStyle: React.CSSProperties = { maxWidth: 960, margin: '0 auto', padding: '20px 16px', fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif", color: '#E2E8F0', backgroundColor: '#0B1120', minHeight: '100vh' };
