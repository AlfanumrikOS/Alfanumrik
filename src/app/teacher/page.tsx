'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabaseUrl as SUPABASE_URL, supabaseAnonKey as SUPABASE_ANON } from '@/lib/supabase';
import type { HeatmapData, HeatmapCell, HeatmapRow, RiskAlert } from '@/lib/types';
import { BottomNav } from '@/components/ui';

// ============================================================
// BILINGUAL HELPERS (P7)
// ============================================================
const tt = (isHi: boolean, en: string, hi: string) => isHi ? hi : en;

/* ─── Local interfaces for teacher dashboard API data ─── */
interface HeatmapConcept {
  id: string;
  title: string;
  chapter: number;
}

interface DashboardClass {
  id: string;
  name: string;
  student_count: number;
  avg_mastery?: number;
}

interface DashboardStats {
  total_students: number;
  active_alerts: number;
  critical_alerts: number;
  active_assignments: number;
}

interface DashboardTeacher {
  name: string;
}

interface DashboardData {
  teacher?: DashboardTeacher;
  classes?: DashboardClass[];
  stats?: DashboardStats;
}

interface PollData {
  poll_id: string;
  question_text?: string;
  response_count?: number;
}

interface PollResults {
  accuracy_pct: number;
}

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
  if (p >= 0.95) return 'bg-emerald-600';
  if (p >= 0.80) return 'bg-violet-600';
  if (p >= 0.60) return 'bg-blue-600';
  if (p >= 0.30) return 'bg-amber-600';
  if (p > 0.1) return 'bg-amber-400';
  return 'bg-slate-800';
}

const SEV: Record<string, { bg: string; border: string }> = {
  critical: { bg: 'bg-red-600', border: 'border-red-500' },
  high: { bg: 'bg-orange-600', border: 'border-orange-500' },
  medium: { bg: 'bg-amber-600', border: 'border-amber-400' },
  low: { bg: 'bg-blue-600', border: 'border-blue-500' },
};

const CHAPTER_NAMES: Record<number, string> = {
  1: 'Forces', 2: 'Motion', 3: 'Light', 4: 'Heat', 5: 'Sound',
  6: 'Atoms', 7: 'Cells', 8: 'Plants', 9: 'Animals', 10: 'Earth',
  11: 'Weather', 12: 'Matter',
};

function HeatmapTab({ data, isHi }: { data: HeatmapData; isHi: boolean }) {
  const [selected, setSelected] = useState<(HeatmapCell & { student: string; concept: string }) | null>(null);
  if (!data?.matrix?.length) return <div className="p-10 text-center text-slate-600 italic">{tt(isHi, 'No mastery data yet — students need to start practicing.', 'अभी तक कोई मास्टरी डेटा नहीं — छात्रों को अभ्यास शुरू करना होगा।')}</div>;
  const concepts = (data.concepts || []).slice(0, 12);
  return (
    <div className="td-card">
      <div className="td-card-head"><h3>{tt(isHi, 'Mastery heatmap', 'मास्टरी हीटमैप')}</h3><span className="td-badge">{data.student_count} {tt(isHi, 'students', 'छात्र')} × {data.concept_count} {tt(isHi, 'concepts', 'अवधारणाएं')}</span></div>
      <div className="overflow-x-auto mt-3.5">
        <table className="border-collapse w-full text-xs">
          <thead><tr>
            <th className="px-2 py-1.5 text-slate-500 font-medium text-[10px] text-left border-b border-slate-800 min-w-[110px]">{tt(isHi, 'Student', 'छात्र')}</th>
            <th className="px-1 py-1.5 text-slate-500 font-medium text-[10px] text-center border-b border-slate-800">{tt(isHi, 'Avg', 'औसत')}</th>
            {concepts.map((c: HeatmapConcept, i: number) => (
              <th key={i} className="px-1 py-1.5 text-slate-500 font-medium text-[10px] text-center border-b border-slate-800" title={c.title}>
                Ch{c.chapter}{CHAPTER_NAMES[c.chapter] ? `: ${CHAPTER_NAMES[c.chapter].slice(0, 6)}` : ''}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {data.matrix.map((row: HeatmapRow, ri: number) => (
              <tr key={ri}>
                <td className="px-2 py-1.5 text-slate-200 font-medium text-[13px] whitespace-nowrap">{row.student_name}</td>
                <td className="px-1 py-1.5 text-center font-semibold text-slate-200 text-[13px]">{row.avg_mastery}%</td>
                {(row.cells || []).slice(0, 12).map((cell: HeatmapCell, ci: number) => (
                  <td key={ci} className="py-[5px] px-[3px] text-center cursor-pointer"
                    onClick={() => setSelected({ student: row.student_name, concept: concepts[ci]?.title, ...cell })}>
                    <span className={`inline-block min-w-[32px] py-1 px-0.5 rounded text-[10px] font-medium text-white ${heatColor(cell.p_know)} ${cell.attempts > 0 ? 'opacity-100' : 'opacity-30'}`}>
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
        <div className="mt-3 p-3 bg-slate-800 rounded-lg text-[13px] text-slate-200">
          <strong>{selected.student}</strong> on <strong>{selected.concept}</strong>: P(know) = {Math.round(selected.p_know * 100)}%, level = {selected.level}, {selected.attempts} attempts
          <button onClick={() => setSelected(null)} className="ml-3 text-[11px] text-slate-400 bg-transparent border-none cursor-pointer">✕</button>
        </div>
      )}
    </div>
  );
}

function AlertsTab({ alerts, onResolve, isHi }: { alerts: RiskAlert[]; onResolve: (id: string) => void; isHi: boolean }) {
  if (!alerts?.length) return <div className="td-card"><div className="td-card-head"><h3>{tt(isHi, 'At-risk alerts', 'जोखिम अलर्ट')}</h3></div><div className="p-[30px] text-center text-slate-600 italic">{tt(isHi, 'No at-risk students detected.', 'कोई जोखिम वाले छात्र नहीं मिले।')}</div></div>;
  return (
    <div className="td-card">
      <div className="td-card-head"><h3>{tt(isHi, 'At-risk alerts', 'जोखिम अलर्ट')}</h3><span className="td-badge bg-red-600">{alerts.length}</span></div>
      <div className="mt-3 flex flex-col gap-2.5">
        {alerts.map((a: RiskAlert) => { const s = SEV[a.severity] || SEV.medium; return (
          <div key={a.id} className={`bg-slate-800 rounded-lg p-3 border-l-[3px] ${s.border}`}>
            <div className="flex justify-between items-center">
              <div>
                <span className={`text-[10px] font-bold py-0.5 px-2 rounded ${s.bg} text-white uppercase`}>{a.severity}</span>
                <span className="ml-2 font-semibold text-slate-100 text-sm">{a.title}</span>
              </div>
              <button onClick={() => onResolve(a.id)} className="py-1 px-2.5 bg-transparent text-slate-400 border border-slate-700 rounded-md text-[11px] cursor-pointer">{tt(isHi, 'Resolve', 'हल करें')}</button>
            </div>
            <p className="text-slate-400 text-[13px] my-1.5">{a.description}</p>
            {a.recommended_action && <p className="text-indigo-500 text-xs m-0 italic">{tt(isHi, 'Action', 'कार्रवाई')}: {a.recommended_action}</p>}
          </div>
        ); })}
      </div>
    </div>
  );
}

function InterventionsTab({ alerts, classId, dash, isHi }: { alerts: RiskAlert[]; classId: string; dash: DashboardData | null; isHi: boolean }) {
  const criticalCount = alerts.filter(a => a.severity === 'critical' || a.severity === 'high').length;
  const avgMastery = dash?.classes?.[0]?.avg_mastery ?? 0;
  const studentCount = dash?.stats?.total_students ?? 0;
  const weakStudents = alerts.length;

  // Generate actionable suggestions based on class state
  const suggestions: { icon: string; title: string; desc: string; action: string; color: string }[] = [];

  if (criticalCount > 0) {
    suggestions.push({
      icon: '🚨',
      title: tt(isHi, `${criticalCount} students need urgent help`, `${criticalCount} छात्रों को तत्काल मदद चाहिए`),
      desc: tt(isHi, 'These students have critical learning gaps. Consider one-on-one revision or a remedial quiz.', 'इन छात्रों में गंभीर सीखने की कमियां हैं। एक-एक करके रिवीज़न या उपचारात्मक क्विज़ पर विचार करें।'),
      action: tt(isHi, 'View at-risk students', 'जोखिम वाले छात्र देखें'),
      color: 'border-red-600',
    });
  }

  if (avgMastery < 50 && studentCount > 0) {
    suggestions.push({
      icon: '📊',
      title: tt(isHi, 'Class mastery below 50%', 'कक्षा मास्टरी 50% से कम'),
      desc: tt(isHi, `Average mastery is ${avgMastery}%. Consider re-teaching the weakest chapters before moving forward.`, `औसत मास्टरी ${avgMastery}% है। आगे बढ़ने से पहले कमज़ोर अध्यायों को दोबारा पढ़ाने पर विचार करें।`),
      action: tt(isHi, 'View mastery heatmap', 'मास्टरी हीटमैप देखें'),
      color: 'border-amber-600',
    });
  }

  if (weakStudents > 3) {
    suggestions.push({
      icon: '📝',
      title: tt(isHi, `${weakStudents} students struggling — assign revision quiz`, `${weakStudents} छात्र कठिनाई में — रिवीज़न क्विज़ दें`),
      desc: tt(isHi, 'A targeted revision quiz on weak topics would help these students catch up with the class.', 'कमज़ोर विषयों पर लक्षित रिवीज़न क्विज़ इन छात्रों को कक्षा के साथ चलने में मदद करेगी।'),
      action: tt(isHi, 'Create quiz for weak topics', 'कमज़ोर विषयों के लिए क्विज़ बनाएं'),
      color: 'border-indigo-500',
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      icon: '✅',
      title: tt(isHi, 'Class is on track', 'कक्षा सही दिशा में है'),
      desc: tt(isHi, 'No urgent interventions needed. Continue with the current teaching plan.', 'कोई तत्काल हस्तक्षेप आवश्यक नहीं। वर्तमान शिक्षण योजना जारी रखें।'),
      action: '',
      color: 'border-emerald-600',
    });
  }

  return (
    <div className="td-card">
      <div className="td-card-head"><h3>{tt(isHi, 'Intervention suggestions', 'हस्तक्षेप सुझाव')}</h3><span className="td-badge bg-indigo-500">{/* eslint-disable-next-line react/jsx-no-comment-textnodes */}{tt(isHi, 'AI-powered', 'AI-संचालित')}</span></div>
      <div className="mt-3 flex flex-col gap-2.5">
        {suggestions.map((s, i) => (
          <div key={i} className={`bg-slate-800 rounded-lg p-3.5 border-l-[3px] ${s.color}`}>
            <div className="flex items-start gap-2.5">
              <span className="text-xl shrink-0">{s.icon}</span>
              <div className="flex-1">
                <div className="font-semibold text-slate-100 text-sm mb-1">{s.title}</div>
                <p className="text-slate-400 text-[13px] m-0 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PollTab({ classId, teacherId, isHi }: { classId: string; teacherId: string; isHi: boolean }) {
  const [q, setQ] = useState(''); const [opts, setOpts] = useState(['','','','']); const [correctIdx, setCorrectIdx] = useState(0);
  const [poll, setPoll] = useState<PollData | null>(null); const [results, setResults] = useState<PollResults | null>(null); const [loading, setLoading] = useState(false);
  const launch = async () => { if (!q.trim()) return; setLoading(true); const data = await api('launch_poll', { teacher_id: teacherId, class_id: classId, question_text: q, options: opts.filter(o => o.trim()), correct_index: correctIdx, question_type: 'mcq', time_limit: 60 }); setPoll(data); setResults(null); setLoading(false); };
  const close = async () => { if (!poll?.poll_id) return; const data = await api('close_poll', { teacher_id: teacherId, poll_id: poll.poll_id }); setResults(data); setPoll(null); };
  return (
    <div className="td-card">
      <div className="td-card-head"><h3>{tt(isHi, 'Classroom response', 'कक्षा प्रतिक्रिया')}</h3>{poll && <span className="td-badge bg-emerald-600">LIVE</span>}</div>
      {!poll && !results && (<div className="mt-3.5">
        <input className="td-input" placeholder={tt(isHi, 'Type your question...', 'अपना प्रश्न लिखें...')} value={q} onChange={e => setQ(e.target.value)} />
        <div className="grid grid-cols-2 gap-2 my-2.5">
          {opts.map((o, i) => (<div key={i} className="flex gap-1.5 items-center">
            <input type="radio" name="c" checked={correctIdx === i} onChange={() => setCorrectIdx(i)} className="accent-indigo-500" />
            <input className="td-input !m-0 flex-1" placeholder={`${tt(isHi, 'Option', 'विकल्प')} ${String.fromCharCode(65+i)}`} value={o} onChange={e => { const n=[...opts]; n[i]=e.target.value; setOpts(n); }} />
          </div>))}
        </div>
        <button className="td-btn-primary" onClick={launch} disabled={loading}>{loading ? tt(isHi, 'Launching...', 'लॉन्च हो रहा है...') : tt(isHi, 'Launch to class', 'कक्षा में लॉन्च करें')}</button>
      </div>)}
      {poll && !results && (<div className="mt-3.5 bg-slate-800 rounded-lg p-3.5">
        <p className="text-slate-100 text-[15px] font-semibold mb-2">{poll.question_text || q}</p>
        <p className="text-indigo-500 text-2xl font-bold my-2">{poll.response_count ?? 0} {tt(isHi, 'responded', 'ने जवाब दिया')}</p>
        <button className="td-btn-primary !bg-red-600 mt-2.5" onClick={close}>{tt(isHi, 'Close poll', 'पोल बंद करें')}</button>
      </div>)}
      {results && (<div className="mt-3.5 bg-slate-800 rounded-lg p-3.5">
        <span className="text-emerald-600 font-bold text-lg">{results.accuracy_pct}% {tt(isHi, 'correct', 'सही')}</span>
        <button onClick={() => { setResults(null); setQ(''); setOpts(['','','','']); }} className="ml-3 py-1 px-2.5 bg-transparent text-indigo-500 border border-indigo-500 rounded-md text-xs cursor-pointer">{tt(isHi, 'New question', 'नया प्रश्न')}</button>
      </div>)}
    </div>
  );
}

export default function TeacherPage() {
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole, isHi } = useAuth();
  const router = useRouter();
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [tab, setTab] = useState('heatmap');
  const [loading, setLoading] = useState(true);

  // Get teacher_id from auth session (no more hardcoded IDs)
  const teacherId = teacher?.id || '';
  const classId = dash?.classes?.[0]?.id || '';

  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) {
      router.replace('/login');
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

  if (loading) return (
    <div className="max-w-[960px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-slate-200 bg-[#0B1120] min-h-screen">
      <div className="text-center py-20 text-slate-500">
        <div className="w-10 h-10 border-[3px] border-slate-800 border-t-indigo-500 rounded-full mx-auto mb-4 animate-spin" />
        {tt(isHi, 'Loading teacher dashboard...', 'शिक्षक डैशबोर्ड लोड हो रहा है...')}
      </div>
    </div>
  );

  // Empty state: no classes
  if (!dash?.classes?.length) return (
    <div className="max-w-[960px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-slate-200 bg-[#0B1120] min-h-screen">
      <div className="text-center py-20">
        <div className="text-5xl mb-4">&#x1F3EB;</div>
        <h2 className="text-xl font-bold text-slate-100 mb-2">{tt(isHi, 'Welcome to your dashboard!', 'आपके डैशबोर्ड में स्वागत है!')}</h2>
        <p className="text-sm text-slate-500 mb-5 max-w-[360px] mx-auto">
          {tt(isHi,
            'Create your first class to start tracking student progress. Share the class code with students to get started.',
            'छात्रों की प्रगति ट्रैक करने के लिए अपनी पहली कक्षा बनाएं। शुरू करने के लिए छात्रों के साथ कक्षा कोड साझा करें।'
          )}
        </p>
        <button onClick={() => router.push('/teacher/classes')} className="py-2.5 px-6 bg-indigo-500 text-white border-none rounded-lg text-sm font-semibold cursor-pointer">
          {tt(isHi, 'Create a Class', 'कक्षा बनाएं')}
        </button>
      </div>
      <BottomNav />
    </div>
  );

  const cls = dash?.classes?.[0];
  const criticalAlerts = alerts.filter(a => a.severity === 'critical' || a.severity === 'high');
  const tabs = [
    { id: 'heatmap', label: tt(isHi, 'Mastery heatmap', 'मास्टरी हीटमैप') },
    { id: 'interventions', label: tt(isHi, 'Interventions', 'हस्तक्षेप') },
    { id: 'alerts', label: `${tt(isHi, 'Alerts', 'अलर्ट')}${alerts.length ? ` (${alerts.length})` : ''}` },
    { id: 'poll', label: tt(isHi, 'Classroom response', 'कक्षा प्रतिक्रिया') },
  ];

  return (
    <div className="max-w-[960px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-slate-200 bg-[#0B1120] min-h-screen">
      <style>{`.td-card{background:#0F172A;border-radius:14px;padding:18px 20px;border:1px solid #1E293B} .td-card-head{display:flex;justify-content:space-between;align-items:center} .td-card-head h3{font-size:16px;font-weight:600;color:#F1F5F9;margin:0} .td-badge{font-size:11px;font-weight:600;padding:3px 10px;border-radius:99px;background:#1E293B;color:#94A3B8} .td-input{width:100%;padding:10px 12px;background:#1E293B;border:1px solid #334155;border-radius:8px;color:#E2E8F0;font-size:14px;outline:none;box-sizing:border-box;margin-bottom:8px} .td-btn-primary{padding:10px 20px;background:#6366F1;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;width:100%} .td-btn-primary:disabled{opacity:0.5;cursor:default}`}</style>
      <header className="flex justify-between items-start mb-5 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-50 m-0">{dash?.teacher?.name || tt(isHi, 'Teacher Dashboard', 'शिक्षक डैशबोर्ड')}</h1>
          <p className="text-sm text-slate-500 mt-1">{cls?.name || 'Class 9-A'} ({cls?.student_count || 0} {tt(isHi, 'students', 'छात्र')}){cls?.avg_mastery != null && <span className="text-indigo-500 ml-2">{tt(isHi, 'Avg mastery', 'औसत मास्टरी')}: {cls.avg_mastery}%</span>}</p>
        </div>
        <button onClick={load} className="py-2 px-4 bg-transparent text-indigo-500 border border-indigo-500 rounded-lg text-[13px] font-medium cursor-pointer">{tt(isHi, 'Refresh', 'रिफ्रेश')}</button>
      </header>

      {/* Quick nav links */}
      <div className="flex gap-2 flex-wrap mb-4">
        {[
          { label: tt(isHi, '🏫 Classes', '🏫 कक्षाएं'), path: '/teacher/classes' },
          { label: tt(isHi, '📋 Assignments', '📋 असाइनमेंट'), path: '/teacher/assignments' },
          { label: tt(isHi, '👨‍🎓 Students', '👨‍🎓 छात्र'), path: '/teacher/students' },
          { label: tt(isHi, '📊 Reports', '📊 रिपोर्ट'), path: '/teacher/reports' },
        ].map(({ label, path }) => (
          <button key={path} onClick={() => router.push(path)} className="py-2 px-4 bg-slate-900 border border-slate-800 rounded-lg text-[13px] text-slate-400 font-medium cursor-pointer hover:border-indigo-500 hover:text-indigo-400 transition-colors">
            {label}
          </button>
        ))}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-3 mb-4">
        {[
          { label: tt(isHi, 'Students', 'छात्र'), val: dash?.stats?.total_students || 0, color: 'text-indigo-500' },
          { label: tt(isHi, 'Alerts', 'अलर्ट'), val: dash?.stats?.active_alerts || 0, color: (dash?.stats?.critical_alerts || 0) > 0 ? 'text-red-600' : 'text-amber-600' },
          { label: tt(isHi, 'Assignments', 'असाइनमेंट'), val: dash?.stats?.active_assignments || 0, color: 'text-emerald-600' },
        ].map((s,i) => (
          <div key={i} className="bg-slate-900 rounded-xl py-3.5 px-4 border border-slate-800">
            <p className="text-slate-500 text-[11px] m-0 uppercase tracking-wide">{s.label}</p>
            <p className={`${s.color} text-[26px] font-bold mt-1`}>{s.val}</p>
          </div>
        ))}
      </div>

      {/* Struggling Students Banner — at-a-glance alert for teachers */}
      {criticalAlerts.length > 0 && (
        <div className="bg-slate-900 rounded-[14px] px-5 py-4 border border-red-900/50 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[15px] font-semibold text-red-400 m-0">
              {tt(isHi,
                `${criticalAlerts.length} student${criticalAlerts.length > 1 ? 's' : ''} need${criticalAlerts.length === 1 ? 's' : ''} help`,
                `${criticalAlerts.length} छात्र${criticalAlerts.length > 1 ? 'ों' : ''} को मदद चाहिए`
              )}
            </h3>
            <button onClick={() => setTab('alerts')} className="text-xs text-indigo-400 bg-transparent border border-indigo-500/30 rounded-md px-3 py-1 cursor-pointer">
              {tt(isHi, 'View all', 'सभी देखें')}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {criticalAlerts.slice(0, 3).map((a) => {
              const sev = SEV[a.severity] || SEV.medium;
              return (
                <div key={a.id} className={`flex items-center gap-3 bg-slate-800/60 rounded-lg py-2.5 px-3 border-l-[3px] ${sev.border}`}>
                  <span className={`text-[10px] font-bold py-0.5 px-2 rounded ${sev.bg} text-white uppercase shrink-0`}>{a.severity}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-slate-200 m-0 truncate">{a.title}</p>
                    {a.recommended_action && <p className="text-[11px] text-indigo-400 m-0 mt-0.5 truncate">{a.recommended_action}</p>}
                  </div>
                  <button onClick={() => resolveAlert(a.id)} className="text-[11px] text-slate-400 bg-transparent border border-slate-700 rounded px-2 py-0.5 cursor-pointer shrink-0">
                    {tt(isHi, 'Resolve', 'हल करें')}
                  </button>
                </div>
              );
            })}
          </div>
          {criticalAlerts.length > 3 && (
            <p className="text-xs text-slate-500 mt-2 m-0">
              {tt(isHi,
                `+ ${criticalAlerts.length - 3} more alert${criticalAlerts.length - 3 > 1 ? 's' : ''}`,
                `+ ${criticalAlerts.length - 3} और अलर्ट`
              )}
            </p>
          )}
        </div>
      )}

      {/* No alerts — all clear */}
      {alerts.length === 0 && (dash?.stats?.total_students || 0) > 0 && (
        <div className="bg-slate-900 rounded-[14px] px-5 py-3.5 border border-emerald-900/30 mb-4 flex items-center gap-3">
          <span className="text-emerald-500 text-lg">&#x2713;</span>
          <p className="text-[13px] text-emerald-400 m-0 font-medium">
            {tt(isHi, 'All students are on track. No urgent issues detected.', 'सभी छात्र सही दिशा में हैं। कोई तत्काल समस्या नहीं मिली।')}
          </p>
        </div>
      )}

      {/* Tabs */}
      <nav className="flex gap-1 p-1 bg-slate-900 rounded-[10px] border border-slate-800 mb-4 overflow-x-auto">
        {tabs.map(tb => (<button key={tb.id} onClick={() => setTab(tb.id)} className={`py-2 px-4 border-none rounded-lg text-[13px] cursor-pointer whitespace-nowrap ${tab === tb.id ? 'font-semibold bg-indigo-500 text-white' : 'font-medium bg-transparent text-slate-500'}`}>{tb.label}</button>))}
      </nav>
      {tab === 'heatmap' && heatmap && <HeatmapTab data={heatmap} isHi={isHi} />}
      {tab === 'heatmap' && !heatmap && (
        <div className="td-card">
          <div className="text-center py-8 text-slate-500">
            <div className="text-3xl mb-3">&#x1F4CA;</div>
            <p className="text-[14px] font-medium text-slate-400 mb-1">{tt(isHi, 'No mastery data yet', 'अभी तक कोई मास्टरी डेटा नहीं')}</p>
            <p className="text-[13px] text-slate-600">{tt(isHi, 'Students need to complete quizzes before mastery data appears here.', 'यहाँ मास्टरी डेटा दिखने के लिए छात्रों को क्विज़ पूरी करनी होगी।')}</p>
          </div>
        </div>
      )}
      {tab === 'interventions' && <InterventionsTab alerts={alerts} classId={classId} dash={dash} isHi={isHi} />}
      {tab === 'alerts' && <AlertsTab alerts={alerts} onResolve={resolveAlert} isHi={isHi} />}
      {tab === 'poll' && <PollTab classId={classId} teacherId={teacherId} isHi={isHi} />}
      <BottomNav />
    </div>
  );
}
