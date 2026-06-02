'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase, supabaseUrl as SUPABASE_URL, supabaseAnonKey as SUPABASE_ANON, getFeatureFlags } from '@/lib/supabase';
import type { HeatmapData, HeatmapCell, HeatmapRow, RiskAlert } from '@/lib/types';
import { SUBJECT_ROTATION } from '@/lib/challenge-config';
import { useAtlasFlag } from '@/lib/use-atlas-flag';
import { useRealtimeRevalidator } from '@/hooks/useRealtimeRevalidator';
import { REALTIME_FLAGS } from '@/lib/feature-flags';
import AtlasTeacher from './AtlasTeacher';

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

interface ChallengeClassData {
  todaySubject: string;
  todaySubjectLabel: string;
  solvedToday: number;
  totalStudents: number;
  avgStreak: number;
  topStreakers: { name: string; streak: number }[];
}

async function api(action: string, params: Record<string, unknown> = {}) {
  // Build headers — always include apikey; add Bearer token when a session exists
  // so the teacher-dashboard Edge Function can authenticate the caller via JWT.
  // Pattern mirrors chatWithFoxy() in src/lib/supabase.ts.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON,
  };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch { /* fall through — edge function may still accept apikey */ }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/teacher-dashboard`, {
    method: 'POST',
    headers,
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

function InterventionsTab({
  alerts,
  classId,
  dash,
  isHi,
  teacherId,
}: {
  alerts: RiskAlert[];
  classId: string;
  dash: DashboardData | null;
  isHi: boolean;
  teacherId: string;
}) {
  const [topics, setTopics] = useState<any[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<string>('');
  const [lessonNotes, setLessonNotes] = useState<string>('');
  const [todayLesson, setTodayLesson] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [momentAlerts, setMomentAlerts] = useState<any[]>([]);
  const [deployingIntervention, setDeployingIntervention] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ message: msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const t = (en: string, hi: string) => (isHi ? hi : en);

  const fetchTodayLesson = useCallback(async () => {
    if (!classId) return;
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const res = await api('get_lesson_plans', {
        class_id: classId,
        start_date: todayStr,
        end_date: todayStr,
      });
      if (res && res.length > 0) {
        setTodayLesson(res[0]);
        setSelectedTopicId(res[0].topic_id);
        setLessonNotes(res[0].notes || '');
      } else {
        setTodayLesson(null);
        setSelectedTopicId('');
        setLessonNotes('');
      }
    } catch (err) {
      console.error('Error fetching today\'s lesson:', err);
    }
  }, [classId]);

  const fetchTopicsForClass = useCallback(async () => {
    if (!classId) return;
    try {
      const { data: classData } = await supabase
        .from('classes')
        .select('grade')
        .eq('id', classId)
        .maybeSingle();

      const grade = classData?.grade || '6';

      const { data: topicsData } = await supabase
        .from('curriculum_topics')
        .select('id, title, chapter_number')
        .eq('grade', grade)
        .eq('is_active', true)
        .order('chapter_number', { ascending: true })
        .order('display_order', { ascending: true });

      setTopics(topicsData || []);
    } catch (err) {
      console.error('Error fetching curriculum topics:', err);
    }
  }, [classId]);

  const fetchMomentAlerts = useCallback(async () => {
    if (!classId) return;
    try {
      const res = await api('get_in_the_moment_alerts', { class_id: classId });
      setMomentAlerts(res || []);
    } catch (err) {
      console.error('Error fetching in-the-moment alerts:', err);
    }
  }, [classId]);

  useEffect(() => {
    fetchTodayLesson();
    fetchTopicsForClass();
    fetchMomentAlerts();
  }, [classId, fetchTodayLesson, fetchTopicsForClass, fetchMomentAlerts]);

  const syncToBell = async () => {
    if (!classId || !selectedTopicId) return;
    setSyncing(true);
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      await api('set_lesson_plan', {
        class_id: classId,
        date: todayStr,
        topic_id: selectedTopicId,
        notes: lessonNotes,
      });
      await fetchTodayLesson();
      showToast(t('Synced successfully with Foxy micro-tasks!', 'Foxy सूक्ष्म-कार्यों के साथ सफलतापूर्वक सिंक किया गया!'));
    } catch (err) {
      console.error('Error syncing lesson plan:', err);
      showToast(t('Failed to sync lesson plan', 'पाठ योजना सिंक करने में विफल'), 'error');
    } finally {
      setSyncing(false);
    }
  };

  const deployIntervention = async (alertObj: any) => {
    const alertId = alertObj.id;
    setDeployingIntervention(prev => ({ ...prev, [alertId]: true }));
    try {
      const studentTiers = {
        tier1: alertObj.tiers.tier1.map((s: any) => s.id),
        tier2: alertObj.tiers.tier2.map((s: any) => s.id),
        tier3: alertObj.tiers.tier3.map((s: any) => s.id),
      };

      const res = await api('deploy_intervention', {
        class_id: classId,
        topic_id: alertObj.topic_id,
        tiers: studentTiers,
      });

      if (res.success) {
        showToast(t('Intervention pathways deployed successfully!', 'हस्तक्षेप पथों को सफलतापूर्वक तैनात किया गया!'));
      }
    } catch (err) {
      console.error('Error deploying intervention:', err);
      showToast(t('Failed to deploy intervention pathways', 'हस्तक्षेप पथों को तैनात करने में विफल'), 'error');
    } finally {
      setDeployingIntervention(prev => ({ ...prev, [alertId]: false }));
    }
  };

  const criticalCount = alerts.filter(a => a.severity === 'critical' || a.severity === 'high').length;
  const avgMastery = dash?.classes?.[0]?.avg_mastery ?? 0;
  const studentCount = dash?.stats?.total_students ?? 0;
  const weakStudents = alerts.length;

  const suggestions: { icon: string; title: string; desc: string; color: string }[] = [];

  if (criticalCount > 0) {
    suggestions.push({
      icon: '🚨',
      title: t(`${criticalCount} students need urgent help`, `${criticalCount} छात्रों को तत्काल मदद चाहिए`),
      desc: t('These students have critical learning gaps. Consider one-on-one revision or a remedial quiz.', 'इन छात्रों में गंभीर सीखने की कमियां हैं। एक-एक करके रिवीज़न या उपचारात्मक क्विज़ पर विचार करें।'),
      color: 'border-red-600',
    });
  }

  if (avgMastery < 50 && studentCount > 0) {
    suggestions.push({
      icon: '📊',
      title: t('Class mastery below 50%', 'कक्षा मास्टरी 50% से कम'),
      desc: t(`Average mastery is ${avgMastery}%. Consider re-teaching the weakest chapters before moving forward.`, `औसत मास्टरी ${avgMastery}% है। आगे बढ़ने से पहले कमज़ोर अध्यायों को दोबारा पढ़ाने पर विचार करें।`),
      color: 'border-amber-600',
    });
  }

  if (weakStudents > 3) {
    suggestions.push({
      icon: '📝',
      title: t(`${weakStudents} students struggling — assign revision quiz`, `${weakStudents} छात्र कठिनाई में — रिवीज़न क्विज़ दें`),
      desc: t('A targeted revision quiz on weak topics would help these students catch up with the class.', 'कमज़ोर विषयों पर लक्षित रिवीज़न क्विज़ इन छात्रों को कक्षा के साथ चलने में मदद करेगी।'),
      color: 'border-indigo-500',
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      icon: '✅',
      title: t('Class is on track', 'कक्षा सही दिशा में है'),
      desc: t('No urgent interventions needed. Continue with the current teaching plan.', 'कोई तत्काल हस्तक्षेप आवश्यक नहीं। वर्तमान शिक्षण योजना जारी रखें।'),
      color: 'border-emerald-600',
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Lesson Planner Card */}
      <div className="td-card">
        <div className="td-card-head">
          <h3>{t('Classroom Lesson Planner', 'कक्षा पाठ योजनाकार')}</h3>
        </div>
        <div className="mt-3">
          <p className="text-slate-400 text-xs mb-3">
            {t('Sync Foxy daily micro-tasks to today\'s lesson topic', 'Foxy के दैनिक सूक्ष्म-कार्यों को आज के पाठ विषय से सिंक करें')}
          </p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-slate-500 text-[10px] uppercase font-bold tracking-wide block mb-1">
                {t('Select Synced Topic', 'सिंक किया गया विषय चुनें')}
              </label>
              <select
                value={selectedTopicId}
                onChange={e => setSelectedTopicId(e.target.value)}
                className="td-input"
              >
                <option value="">-- {t('Select curriculum topic', 'विषय चुनें')} --</option>
                {topics.map(topic => (
                  <option key={topic.id} value={topic.id}>
                    {topic.chapter_number != null ? `Ch ${topic.chapter_number}: ` : ''}{topic.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-slate-500 text-[10px] uppercase font-bold tracking-wide block mb-1">
                {t('Lesson Planner Notes', 'पाठ योजना नोट्स')}
              </label>
              <input
                type="text"
                placeholder={t('Optional notes…', 'वैकल्पिक नोट्स…')}
                value={lessonNotes}
                onChange={e => setLessonNotes(e.target.value)}
                className="td-input"
              />
            </div>
          </div>

          <div className="flex justify-between items-center mt-3">
            {todayLesson ? (
              <span className="text-emerald-500 text-xs font-semibold">
                ✓ {t('Synced: ', 'सिंक किया गया: ')} {todayLesson.curriculum_topics?.title}
              </span>
            ) : (
              <span className="text-slate-500 text-xs">
                {t('No topic synced for today', 'आज के लिए कोई विषय सिंक नहीं है')}
              </span>
            )}
            <button
              onClick={syncToBell}
              disabled={!selectedTopicId || syncing}
              className="py-1.5 px-3 bg-indigo-500 text-white rounded-lg text-xs font-semibold cursor-pointer border-none"
            >
              {syncing ? t('Syncing…', 'सिंक हो रहा है…') : t('Sync to Bell', 'घंटी से सिंक करें')}
            </button>
          </div>
        </div>
      </div>

      {/* In-the-Moment Struggles Card */}
      {momentAlerts.length > 0 && (
        <div className="td-card border-red-900/45">
          <div className="td-card-head">
            <h3 className="text-red-400 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse inline-block" />
              {t('In-the-Moment Struggles', 'सक्रिय शैक्षणिक संघर्ष')}
            </h3>
            <span className="td-badge bg-red-600/15 text-red-400">{momentAlerts.length}</span>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {momentAlerts.map(alert => (
              <div key={alert.id} className="bg-slate-800 rounded-lg p-3 border border-red-900/20">
                <div className="font-semibold text-slate-200 text-sm">{alert.topic_title}</div>
                <div className="text-slate-400 text-xs mt-1">
                  {alert.struggling_count} {t('students struggling today', 'छात्रों को आज कठिनाई हो रही है')}
                </div>

                <details className="mt-2 text-xs">
                  <summary className="text-indigo-400 cursor-pointer font-medium">
                    {t('View Tiers & Accuracy', 'टियर और सटीकता देखें')}
                  </summary>
                  <div className="mt-2 flex flex-col gap-1.5 bg-slate-900/50 p-2 rounded">
                    {alert.tiers.tier1.length > 0 && (
                      <div>
                        <span className="text-red-400 font-semibold">Tier 1 (Intensive &lt;30%):</span>
                        <div className="text-slate-300 ml-2">
                          {alert.tiers.tier1.map((s: any) => `${s.name} (${Math.round(s.accuracy * 100)}%)`).join(', ')}
                        </div>
                      </div>
                    )}
                    {alert.tiers.tier2.length > 0 && (
                      <div>
                        <span className="text-amber-500 font-semibold">Tier 2 (Targeted 30%-60%):</span>
                        <div className="text-slate-300 ml-2">
                          {alert.tiers.tier2.map((s: any) => `${s.name} (${Math.round(s.accuracy * 100)}%)`).join(', ')}
                        </div>
                      </div>
                    )}
                    {alert.tiers.tier3.length > 0 && (
                      <div>
                        <span className="text-emerald-500 font-semibold">Tier 3 (On-Track &gt;60%):</span>
                        <div className="text-slate-300 ml-2">
                          {alert.tiers.tier3.map((s: any) => `${s.name} (${Math.round(s.accuracy * 100)}%)`).join(', ')}
                        </div>
                      </div>
                    )}
                  </div>
                </details>

                <button
                  onClick={() => deployIntervention(alert)}
                  disabled={deployingIntervention[alert.id]}
                  className="mt-3 w-full py-1.5 bg-indigo-600 text-white rounded text-xs font-semibold cursor-pointer border-none"
                >
                  {deployingIntervention[alert.id] ? t('Deploying…', 'तैनात हो रहा है…') : t('Deploy Interventions', 'हस्तक्षेप तैनात करें')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legacy Suggestions */}
      <div className="td-card">
        <div className="td-card-head">
          <h3>{t('Intervention suggestions', 'हस्तक्षेप सुझाव')}</h3>
          <span className="td-badge bg-indigo-500">{t('AI-powered', 'AI-संचालित')}</span>
        </div>
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
    </div>
  );
}

function PollTab({ classId, teacherId, isHi, realtimeEnabled }: { classId: string; teacherId: string; isHi: boolean; realtimeEnabled: boolean }) {
  const [q, setQ] = useState(''); const [opts, setOpts] = useState(['','','','']); const [correctIdx, setCorrectIdx] = useState(0);
  const [poll, setPoll] = useState<PollData | null>(null); const [results, setResults] = useState<PollResults | null>(null); const [loading, setLoading] = useState(false);
  const launch = async () => { if (!q.trim()) return; setLoading(true); const data = await api('launch_poll', { teacher_id: teacherId, class_id: classId, question_text: q, options: opts.filter(o => o.trim()), correct_index: correctIdx, question_type: 'mcq', time_limit: 60 }); setPoll(data); setResults(null); setLoading(false); };
  const close = async () => { if (!poll?.poll_id) return; const data = await api('close_poll', { teacher_id: teacherId, poll_id: poll.poll_id }); setResults(data); setPoll(null); };

  // Phase C.6 — realtime poll-response revalidation.
  // Subscribe to classroom_poll_responses INSERT events filtered by the
  // active poll_id. Each student vote produces one INSERT, so we refresh
  // the poll details (specifically response_count) immediately. No
  // throttle — votes are sparse and visible-immediately IS the UX goal.
  const activePollId = poll?.poll_id || '';
  const refreshPoll = useCallback(async () => {
    if (!activePollId) return;
    try {
      const data = await api('get_poll_details', { teacher_id: teacherId, poll_id: activePollId });
      if (data) setPoll((prev) => (prev ? { ...prev, ...data } : data));
    } catch {
      // Edge function may not support get_poll_details yet — non-fatal.
      // The next user action (e.g. close poll) will reconcile state.
    }
  }, [activePollId, teacherId]);

  useRealtimeRevalidator({
    enabled: realtimeEnabled && Boolean(activePollId),
    channel: `teacher-poll-${activePollId || 'none'}`,
    table: 'classroom_poll_responses',
    event: 'INSERT',
    filter: activePollId ? `poll_id=eq.${activePollId}` : null,
    onChange: refreshPoll,
  });
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
  // Synchronous Atlas dispatch — see src/lib/use-atlas-flag.ts.
  const atlas = useAtlasFlag('teacher');
  if (atlas) return <AtlasTeacher />;
  return <LegacyTeacherPage />;
}

function LegacyTeacherPage() {
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole, isHi } = useAuth();
  const router = useRouter();
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [tab, setTab] = useState('heatmap');
  const [loading, setLoading] = useState(true);
  const [challengeData, setChallengeData] = useState<ChallengeClassData | null>(null);
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);

  // Get teacher_id from auth session (no more hardcoded IDs)
  const teacherId = teacher?.id || '';
  const classId = dash?.classes?.[0]?.id || '';

  // Phase C.6 — gate realtime subscriptions on ff_realtime_subscriptions_v1.
  // Fetched once on mount; the hook short-circuits when disabled so the cost
  // of leaving the call here is one fetch on dashboard open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flags = await getFeatureFlags({ role: 'teacher' });
        if (!cancelled) setRealtimeEnabled(Boolean(flags[REALTIME_FLAGS.SUBSCRIPTIONS_V1]));
      } catch {
        if (!cancelled) setRealtimeEnabled(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) {
      router.replace('/login');
    }
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  const load = useCallback(async () => {
    // If AuthContext hasn't produced a teacher yet, stop the spinner so the
    // empty-state render path can take over. When teacherId later becomes
    // available, this callback's deps change and the effect re-runs.
    if (!teacherId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const d = await api('get_dashboard', { teacher_id: teacherId });
      setDash(d);
      const firstClassId = d?.classes?.[0]?.id;
      if (firstClassId) {
        const [h, a] = await Promise.all([
          api('get_heatmap', { teacher_id: teacherId, class_id: firstClassId, subject: 'math' }),
          api('get_alerts', { teacher_id: teacherId, class_id: firstClassId }),
        ]);
        setHeatmap(h); setAlerts(a.alerts || []);

        // Load daily challenge data for the class
        try {
          const todayDow = new Date().getDay();
          const rotation = SUBJECT_ROTATION[todayDow];
          const todaySubject = rotation?.subject ?? 'mixed';
          const todayLabel = rotation?.labelEn ?? 'Daily Challenge';
          const todayStr = new Date().toISOString().split('T')[0];

          // Use the teacher-dashboard edge function to get student IDs in class,
          // then query challenge tables. If challenge endpoints don't exist in the
          // edge function, fall back to graceful empty state.
          let challengeResult: ChallengeClassData | null = null;
          try {
            const cData = await api('get_challenge_summary', {
              teacher_id: teacherId,
              class_id: firstClassId,
              date: todayStr,
            });
            if (cData) {
              challengeResult = {
                todaySubject,
                todaySubjectLabel: todayLabel,
                solvedToday: cData.solved_today ?? 0,
                totalStudents: d?.stats?.total_students ?? 0,
                avgStreak: cData.avg_streak ?? 0,
                topStreakers: Array.isArray(cData.top_streakers)
                  ? cData.top_streakers.slice(0, 5).map((s: any) => ({
                      name: s.name ?? '?',
                      streak: s.current_streak ?? 0,
                    }))
                  : [],
              };
            }
          } catch {
            // Edge function may not support this action yet -- use static defaults
            challengeResult = {
              todaySubject,
              todaySubjectLabel: todayLabel,
              solvedToday: 0,
              totalStudents: d?.stats?.total_students ?? 0,
              avgStreak: 0,
              topStreakers: [],
            };
          }
          setChallengeData(challengeResult);
        } catch {
          // Challenge data is optional -- gracefully degrade
          setChallengeData(null);
        }
      }
    } catch (err) {
      // Surface the failure to the console but always release the spinner in
      // the finally block so the user sees an empty/retry state instead of
      // hanging forever.
      console.error('Teacher dashboard load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  useEffect(() => { load(); }, [load]);

  // Phase C.6 — realtime heatmap revalidation.
  // Subscribe to student_learning_profiles UPDATE events. RLS on
  // student_learning_profiles already restricts visibility to the teacher's
  // classes via the teacher_class_students join, so a school-wide channel
  // here only fires for THIS teacher's students. Throttled 2s because a
  // large class can emit dozens of profile updates per minute after a
  // synchronous quiz.
  useRealtimeRevalidator({
    enabled: realtimeEnabled && Boolean(classId),
    channel: `teacher-heatmap-${classId || 'none'}`,
    table: 'student_learning_profiles',
    event: 'UPDATE',
    filter: null,
    throttleMs: 2000,
    onChange: load,
  });

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

  // Defensive: if loading finished but we still have no teacher profile (AuthContext
  // hasn't caught up, or the session expired), show a friendly retry state instead
  // of rendering against null data and crashing downstream.
  if (!teacher) return (
    <div className="max-w-[960px] mx-auto px-4 py-5 font-['Plus_Jakarta_Sans','Sora',system-ui,sans-serif] text-slate-200 bg-[#0B1120] min-h-screen">
      <div className="text-center py-20">
        <div className="text-5xl mb-4">&#x1F464;</div>
        <h2 className="text-xl font-bold text-slate-100 mb-2">
          {tt(isHi, 'Setting up your teacher account', 'आपका शिक्षक खाता सेट हो रहा है')}
        </h2>
        <p className="text-sm text-slate-500 mb-5 max-w-[360px] mx-auto">
          {tt(isHi,
            'Please refresh in a moment. If this persists, try signing out and back in.',
            'कृपया एक क्षण में रिफ्रेश करें। यदि यह बना रहे, तो साइन आउट करके फिर से लॉग इन करें।'
          )}
        </p>
        <button onClick={() => window.location.reload()} className="py-2.5 px-6 bg-indigo-500 text-white border-none rounded-lg text-sm font-semibold cursor-pointer">
          {tt(isHi, 'Refresh', 'रिफ्रेश')}
        </button>
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
          {cls?.name ? (
            <p className="text-sm text-slate-500 mt-1">
              {cls.name} ({cls.student_count} {tt(isHi, 'students', 'छात्र')})
              {cls.avg_mastery != null && (
                <span className="text-indigo-500 ml-2">
                  {tt(isHi, 'Avg mastery', 'औसत मास्टरी')}: {cls.avg_mastery}%
                </span>
              )}
            </p>
          ) : (
            <p className="text-sm text-slate-500 mt-1">
              {tt(isHi, 'No classes assigned yet.', 'अभी तक कोई कक्षा नहीं सौंपी गई है।')}{' '}
              <a href="/teacher/classes" className="text-indigo-400 underline hover:text-indigo-300">
                {tt(isHi, 'Create your first class →', 'अपनी पहली कक्षा बनाएं →')}
              </a>
            </p>
          )}
        </div>
        <button onClick={load} className="py-2 px-4 bg-transparent text-indigo-500 border border-indigo-500 rounded-lg text-[13px] font-medium cursor-pointer">{tt(isHi, 'Refresh', 'रिफ्रेश')}</button>
      </header>

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

      {/* ═══ Daily Challenge Card ═══ */}
      {challengeData && (
        <div className="bg-slate-900 rounded-[14px] px-5 py-4 border border-orange-900/30 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[15px] font-semibold text-orange-400 m-0 flex items-center gap-2">
              <span>🔥</span>
              {tt(isHi, 'डेली चैलेंज', 'Daily Challenge')}
            </h3>
            <span className="text-xs py-0.5 px-2.5 rounded-full bg-orange-500/10 text-orange-400 font-semibold">
              {isHi ? (SUBJECT_ROTATION[new Date().getDay()]?.labelHi ?? 'आज का चैलेंज') : challengeData.todaySubjectLabel}
            </span>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-slate-800/60 rounded-lg py-2.5 px-3 text-center">
              <p className="text-orange-400 text-lg font-bold m-0">
                {challengeData.solvedToday}/{challengeData.totalStudents}
              </p>
              <p className="text-[10px] text-slate-500 m-0 mt-0.5">
                {tt(isHi, 'आज हल किया', 'Solved today')}
              </p>
            </div>
            <div className="bg-slate-800/60 rounded-lg py-2.5 px-3 text-center">
              <p className="text-orange-400 text-lg font-bold m-0">
                {challengeData.avgStreak}
              </p>
              <p className="text-[10px] text-slate-500 m-0 mt-0.5">
                {tt(isHi, 'औसत स्ट्रीक (दिन)', 'Avg streak (days)')}
              </p>
            </div>
            <div className="bg-slate-800/60 rounded-lg py-2.5 px-3 text-center">
              <p className="text-orange-400 text-lg font-bold m-0">
                {challengeData.totalStudents > 0
                  ? Math.round((challengeData.solvedToday / challengeData.totalStudents) * 100)
                  : 0}%
              </p>
              <p className="text-[10px] text-slate-500 m-0 mt-0.5">
                {tt(isHi, 'भागीदारी', 'Participation')}
              </p>
            </div>
          </div>

          {/* Top streakers */}
          {challengeData.topStreakers.length > 0 ? (
            <div>
              <p className="text-[11px] text-slate-500 uppercase tracking-wide mb-2 m-0">
                {tt(isHi, 'टॉप स्ट्रीक', 'Top Streaks')}
              </p>
              <div className="flex flex-col gap-1.5">
                {challengeData.topStreakers.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 bg-slate-800/40 rounded-lg py-1.5 px-3">
                    <span className="text-sm w-6 text-center flex-shrink-0">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                    </span>
                    <span className="text-[13px] text-slate-200 flex-1 truncate">{s.name}</span>
                    <span className="text-[13px] font-semibold text-orange-400">
                      🔥 {s.streak} {tt(isHi, 'दिन', 'days')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-slate-500 italic m-0">
              {tt(isHi, 'अभी कोई चैलेंज डेटा नहीं', 'No challenge data yet')}
            </p>
          )}
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
      {tab === 'interventions' && <InterventionsTab alerts={alerts} classId={classId} dash={dash} isHi={isHi} teacherId={teacherId} />}
      {tab === 'alerts' && <AlertsTab alerts={alerts} onResolve={resolveAlert} isHi={isHi} />}
      {tab === 'poll' && <PollTab classId={classId} teacherId={teacherId} isHi={isHi} realtimeEnabled={realtimeEnabled} />}
      
    </div>
  );
}
