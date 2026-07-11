'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import { authHeader } from '@alfanumrik/lib/api/auth-header';
import { useTeacherAllowedSubjects } from '@alfanumrik/lib/useTeacherAllowedSubjects';
import { useExperienceV3 } from '@alfanumrik/lib/use-experience-v3';
import { useAlerts, useHeatmap, useTeacherDashboard } from '@alfanumrik/lib/teacher/use-teacher-data';
import type { RiskAlert } from '@alfanumrik/lib/types';
import { ActionQueue, Button as V3Button, DataState, PageHeader, RecommendationCard, StatusBadge, Surface } from '@alfanumrik/ui/v3';
import { useTeacherV3Scope } from './TeacherV3LayoutGate';
import { metricOrUnavailable } from './teacher-v3-contract';

const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

function Metric({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <article className="v3-metric"><small>{label}</small><strong>{metricOrUnavailable(value)}</strong></article>;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

async function teacherEdge<T>(action: string, params: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token || !SUPABASE_URL) throw new Error('teacher.session_unavailable');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/teacher-dashboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action, ...params }),
  });
  if (!response.ok) throw new Error(`teacher.${action}_failed:${response.status}`);
  return response.json() as Promise<T>;
}

export function TeacherTodayV3() {
  const { isHi, teacher } = useAuth();
  const scope = useTeacherV3Scope();
  const dashboard = useTeacherDashboard();
  const alertsQuery = useAlerts(scope.classId ?? undefined, Boolean(scope.classId));
  const activeClass = scope.classes.find((item) => item.id === scope.classId) ?? null;
  const alerts = useMemo<RiskAlert[]>(() => {
    const raw = alertsQuery.data as unknown;
    if (Array.isArray(raw)) return raw as RiskAlert[];
    return (raw as { alerts?: RiskAlert[] } | undefined)?.alerts ?? [];
  }, [alertsQuery.data]);

  if (dashboard.isLoading || scope.loading) return <DataState state="loading" title={tt(isHi, 'Loading today’s attention queue…', 'आज की ध्यान सूची लोड हो रही है…')} />;
  if (dashboard.error || alertsQuery.error) return <DataState state="error" title={tt(isHi, 'Teacher data is unavailable', 'शिक्षक डेटा उपलब्ध नहीं है')} description={tt(isHi, 'Missing values are not replaced with browser estimates.', 'गुम मानों की जगह ब्राउज़र अनुमान नहीं दिखाए गए हैं।')} action={<V3Button variant="secondary" onClick={() => { void dashboard.mutate(); void alertsQuery.mutate(); }}>{tt(isHi, 'Try again', 'फिर कोशिश करें')}</V3Button>} />;
  if (!scope.classId) return <DataState state="empty" title={tt(isHi, 'No assigned class', 'कोई निर्धारित कक्षा नहीं')} description={tt(isHi, 'Ask a school administrator to assign a class before viewing learner data.', 'सीखने वाला डेटा देखने से पहले स्कूल एडमिन से कक्षा असाइन करवाएँ।')} />;

  const critical = alerts.filter((alert) => alert.severity === 'critical' || alert.severity === 'high');
  const queueItems = alerts.map((alert) => ({
    id: alert.id,
    title: alert.student_name,
    description: alert.description,
    meta: <span>{alert.title}</span>,
    status: <StatusBadge tone={alert.severity === 'critical' || alert.severity === 'high' ? 'danger' : alert.severity === 'medium' ? 'warning' : 'info'}>{alert.severity}</StatusBadge>,
    href: `/teacher/students?class=${encodeURIComponent(scope.classId ?? '')}&student=${encodeURIComponent(alert.student_id)}`,
    actionLabel: tt(isHi, 'Inspect evidence', 'प्रमाण देखें'),
  }));

  return (
    <section className="v3-page" data-testid="teacher-v3-today">
      <PageHeader
        eyebrow={tt(isHi, 'Today’s attention queue', 'आज की ध्यान सूची')}
        title={tt(isHi, `Welcome, ${teacher?.name ?? 'Teacher'}`, `${teacher?.name ?? 'शिक्षक'}, आपका स्वागत है`)}
        description={tt(isHi, 'See who needs attention, inspect the evidence and act.', 'देखें किसे ध्यान चाहिए, प्रमाण जाँचें और कार्रवाई करें।')}
        metadata={activeClass ? <StatusBadge tone="role">{activeClass.name}</StatusBadge> : undefined}
      />

      <div className="v3-metrics">
        <Metric label={tt(isHi, 'Students', 'छात्र')} value={activeClass?.student_count} />
        <Metric label={tt(isHi, 'Average mastery', 'औसत मास्टरी')} value={activeClass?.avg_mastery == null ? null : `${activeClass.avg_mastery}%`} />
        <Metric label={tt(isHi, 'Needs attention', 'ध्यान आवश्यक')} value={alertsQuery.data ? alerts.length : null} />
        <Metric label={tt(isHi, 'High priority', 'उच्च प्राथमिकता')} value={alertsQuery.data ? critical.length : null} />
      </div>

      {critical[0] ? (
        <RecommendationCard
          accent="teacher"
          eyebrow={tt(isHi, 'Highest priority', 'सर्वोच्च प्राथमिकता')}
          title={critical[0].student_name}
          description={critical[0].description}
          reason={critical[0].recommended_action ?? tt(isHi, 'Open the evidence before assigning an intervention.', 'हस्तक्षेप देने से पहले प्रमाण खोलें।')}
          meta={<StatusBadge tone="danger">{critical[0].severity}</StatusBadge>}
          primaryAction={{ label: tt(isHi, 'Inspect evidence', 'प्रमाण देखें'), href: `/teacher/students?class=${encodeURIComponent(scope.classId)}&student=${encodeURIComponent(critical[0].student_id)}` }}
          secondaryAction={{ label: tt(isHi, 'Assign', 'असाइन करें'), href: `/teacher/assign?class=${encodeURIComponent(scope.classId)}&student=${encodeURIComponent(critical[0].student_id)}` }}
        />
      ) : (
        <Surface variant="accent"><DataState compact state="empty" title={tt(isHi, 'No active learner alerts', 'कोई सक्रिय छात्र अलर्ट नहीं')} description={tt(isHi, 'There is nothing requiring intervention in this class right now.', 'इस कक्षा में अभी हस्तक्षेप की आवश्यकता नहीं है।')} /></Surface>
      )}

      <ActionQueue title={tt(isHi, 'Learners needing attention', 'ध्यान चाहने वाले छात्र')} items={queueItems} empty={<p>{tt(isHi, 'No current alerts.', 'कोई वर्तमान अलर्ट नहीं।')}</p>} />
    </section>
  );
}

export function TeacherStudentsV3() {
  const { isHi } = useAuth();
  const scope = useTeacherV3Scope();
  const heatmap = useHeatmap(scope.classId ?? undefined);

  if (!scope.classId) return <DataState state="empty" title={tt(isHi, 'Choose an assigned class', 'निर्धारित कक्षा चुनें')} />;
  if (heatmap.isLoading) return <DataState state="loading" title={tt(isHi, 'Loading learner evidence…', 'छात्र प्रमाण लोड हो रहा है…')} />;
  if (heatmap.error) return <DataState state="error" title={tt(isHi, 'Learner evidence is unavailable', 'छात्र प्रमाण उपलब्ध नहीं है')} description={tt(isHi, 'No scores have been estimated in the browser.', 'ब्राउज़र में किसी स्कोर का अनुमान नहीं लगाया गया है।')} action={<V3Button variant="secondary" onClick={() => void heatmap.mutate()}>{tt(isHi, 'Try again', 'फिर कोशिश करें')}</V3Button>} />;

  const rows = heatmap.data?.matrix ?? [];
  const sorted = [...rows].sort((a, b) => a.avg_mastery - b.avg_mastery);
  return (
    <section className="v3-page" data-testid="teacher-v3-students">
      <PageHeader eyebrow={tt(isHi, 'Class evidence', 'कक्षा प्रमाण')} title={tt(isHi, 'Students', 'छात्र')} description={tt(isHi, 'Learners needing attention appear first. Open a learner to inspect supporting evidence.', 'ध्यान चाहने वाले छात्र पहले दिखते हैं। प्रमाण देखने के लिए छात्र खोलें।')} />
      {!sorted.length ? <DataState state="empty" title={tt(isHi, 'No mastery evidence yet', 'अभी कोई मास्टरी प्रमाण नहीं')} description={tt(isHi, 'Evidence appears after learners complete assessed practice.', 'छात्रों के आकलित अभ्यास के बाद प्रमाण दिखेगा।')} /> : (
        <div className="v3-list">
          {sorted.map((student) => {
            const tone = student.avg_mastery < 40 ? 'danger' : student.avg_mastery < 65 ? 'warning' : 'success';
            const studentId = (student as typeof student & { student_id?: string }).student_id;
            const content = (
              <>
                <span><strong>{student.student_name}</strong><small>{tt(isHi, 'Average mastery', 'औसत मास्टरी')}: {student.avg_mastery == null ? '—' : `${Math.round(student.avg_mastery)}%`}</small></span>
                <StatusBadge tone={tone}>{student.avg_mastery < 40 ? tt(isHi, 'Needs attention', 'ध्यान चाहिए') : student.avg_mastery < 65 ? tt(isHi, 'Developing', 'विकासशील') : tt(isHi, 'On track', 'सही दिशा में')}</StatusBadge>
              </>
            );
            return studentId ? (
              <Link className="v3-list-row" href={`/teacher/students?class=${encodeURIComponent(scope.classId ?? '')}&student=${encodeURIComponent(studentId)}`} key={studentId}>{content}</Link>
            ) : (
              <article className="v3-list-row" key={student.student_name}>{content}</article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function TeacherInsightsV3() {
  const { isHi } = useAuth();
  const scope = useTeacherV3Scope();
  const heatmap = useHeatmap(scope.classId ?? undefined);
  if (!scope.classId) return <DataState state="empty" title={tt(isHi, 'Choose an assigned class', 'निर्धारित कक्षा चुनें')} />;
  if (heatmap.isLoading) return <DataState state="loading" title={tt(isHi, 'Loading class insights…', 'कक्षा इनसाइट लोड हो रही है…')} />;
  if (heatmap.error) return <DataState state="error" title={tt(isHi, 'Class insights are unavailable', 'कक्षा इनसाइट उपलब्ध नहीं है')} description={tt(isHi, 'No client-side estimate is shown.', 'कोई क्लाइंट-साइड अनुमान नहीं दिखाया गया है।')} action={<V3Button variant="secondary" onClick={() => void heatmap.mutate()}>{tt(isHi, 'Try again', 'फिर कोशिश करें')}</V3Button>} />;
  const concepts = heatmap.data?.concepts ?? [];
  return (
    <section className="v3-page" data-testid="teacher-v3-insights">
      <PageHeader eyebrow={tt(isHi, 'Governed class evidence', 'नियंत्रित कक्षा प्रमाण')} title={tt(isHi, 'Insights', 'इनसाइट')} description={tt(isHi, 'Use assessed mastery evidence to decide where the class needs support.', 'आकलित मास्टरी प्रमाण से तय करें कि कक्षा को कहाँ सहायता चाहिए।')} />
      <div className="v3-metrics">
        <Metric label={tt(isHi, 'Learners represented', 'दिखाए गए छात्र')} value={heatmap.data?.student_count} />
        <Metric label={tt(isHi, 'Concepts represented', 'दिखाई गई अवधारणाएँ')} value={heatmap.data?.concept_count} />
      </div>
      <Surface>
        <h2>{tt(isHi, 'Concept evidence', 'अवधारणा प्रमाण')}</h2>
        {concepts.length ? <div className="v3-list">{concepts.map((concept) => <article className="v3-list-row" key={concept.id}><span><small>{tt(isHi, 'Chapter', 'अध्याय')} {concept.chapter}</small><strong>{concept.title}</strong></span></article>)}</div> : <DataState compact state="empty" title={tt(isHi, 'No assessed concepts yet', 'अभी कोई आकलित अवधारणा नहीं')} />}
      </Surface>
    </section>
  );
}

export function TeacherAssignV3() {
  const { isHi } = useAuth();
  const scope = useTeacherV3Scope();
  const { unlocked: subjects, isLoading: subjectsLoading, error: subjectsError, refresh } = useTeacherAllowedSubjects();
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [chapter, setChapter] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [questionCount, setQuestionCount] = useState(10);
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'success' | 'error'; message?: string }>({ kind: 'idle' });

  useEffect(() => { if (!subject && subjects[0]) setSubject(subjects[0].code); }, [subject, subjects]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!scope.classId || !title.trim() || !subject) return;
    setStatus({ kind: 'saving' });
    try {
      const response = await fetch('/api/teacher/assignments', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ class_id: scope.classId, title: title.trim(), subject, chapter: chapter.trim() || null, difficulty, question_count: questionCount, due_date: dueDate || null, type: 'quiz' }),
      });
      const body = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (!response.ok || !body.success) throw new Error(body.error || `HTTP ${response.status}`);
      setTitle(''); setChapter(''); setDueDate('');
      setStatus({ kind: 'success', message: tt(isHi, 'Assignment created.', 'असाइनमेंट बनाया गया।') });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : tt(isHi, 'Could not create assignment.', 'असाइनमेंट नहीं बन सका।') });
    }
  }

  if (!scope.classId) return <DataState state="permission" title={tt(isHi, 'No assigned class', 'कोई निर्धारित कक्षा नहीं')} />;
  if (subjectsLoading) return <DataState state="loading" title={tt(isHi, 'Loading assignment options…', 'असाइनमेंट विकल्प लोड हो रहे हैं…')} />;
  if (subjectsError) return <DataState state="error" title={tt(isHi, 'Subjects are unavailable', 'विषय उपलब्ध नहीं हैं')} action={<V3Button variant="secondary" onClick={refresh}>{tt(isHi, 'Try again', 'फिर कोशिश करें')}</V3Button>} />;
  return (
    <section className="v3-page" data-testid="teacher-v3-assign">
      <PageHeader eyebrow={tt(isHi, 'Create an intervention or assignment', 'हस्तक्षेप या असाइनमेंट बनाएँ')} title={tt(isHi, 'Assign', 'असाइन')} description={tt(isHi, 'The selected class comes from the validated teacher scope.', 'चुनी गई कक्षा सत्यापित शिक्षक स्कोप से आती है।')} />
      <Surface variant="raised">
        <form className="v3-form-grid" onSubmit={submit}>
          <label>{tt(isHi, 'Title', 'शीर्षक')}<input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>{tt(isHi, 'Subject', 'विषय')}<select required value={subject} onChange={(event) => setSubject(event.target.value)}>{subjects.map((item) => <option key={item.code} value={item.code}>{isHi ? item.nameHi : item.name}</option>)}</select></label>
          <label>{tt(isHi, 'Chapter or focus', 'अध्याय या फोकस')}<input maxLength={200} value={chapter} onChange={(event) => setChapter(event.target.value)} /></label>
          <label>{tt(isHi, 'Difficulty', 'कठिनाई')}<select value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}><option value="easy">{tt(isHi, 'Easy', 'आसान')}</option><option value="medium">{tt(isHi, 'Medium', 'मध्यम')}</option><option value="hard">{tt(isHi, 'Hard', 'कठिन')}</option></select></label>
          <label>{tt(isHi, 'Questions', 'प्रश्न')}<input type="number" min={1} max={200} value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} /></label>
          <label>{tt(isHi, 'Due date', 'अंतिम तिथि')}<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          <div className="v3-form-actions"><V3Button type="submit" loading={status.kind === 'saving'} disabled={!title.trim() || !subject}>{tt(isHi, 'Create assignment', 'असाइनमेंट बनाएँ')}</V3Button></div>
        </form>
        {status.kind === 'success' ? <p role="status" className="v3-success-copy">{status.message}</p> : null}
        {status.kind === 'error' ? <p role="alert" className="v3-error-copy">{status.message}</p> : null}
      </Surface>
    </section>
  );
}

interface GradeBookResponse {
  class?: { id: string; name: string };
  columns?: Array<{ key: string; label: string }>;
  rows?: Array<{ student_id: string; student_name: string; cells: Record<string, { score: number | null; max_score: number; status: string }> }>;
}

export function TeacherGradeV3() {
  const { isHi, teacher } = useAuth();
  const scope = useTeacherV3Scope();
  const { data, error, isLoading, mutate } = useSWR<GradeBookResponse>(
    teacher?.id && scope.classId ? ['v3-grade-book', teacher.id, scope.classId] : null,
    () => teacherEdge<GradeBookResponse>('get_grade_book', { teacher_id: teacher?.id, class_id: scope.classId, term: 'current' }),
    { revalidateOnFocus: false },
  );
  if (!scope.classId) return <DataState state="empty" title={tt(isHi, 'Choose an assigned class', 'निर्धारित कक्षा चुनें')} />;
  if (isLoading) return <DataState state="loading" title={tt(isHi, 'Loading grade evidence…', 'ग्रेड प्रमाण लोड हो रहा है…')} />;
  if (error) return <DataState state="error" title={tt(isHi, 'Grade evidence is unavailable', 'ग्रेड प्रमाण उपलब्ध नहीं है')} action={<V3Button variant="secondary" onClick={() => void mutate()}>{tt(isHi, 'Try again', 'फिर कोशिश करें')}</V3Button>} />;
  const columns = data?.columns ?? [];
  const rows = data?.rows ?? [];
  return <section className="v3-page" data-testid="teacher-v3-grade"><PageHeader eyebrow={tt(isHi, 'Current term', 'वर्तमान सत्र')} title={tt(isHi, 'Grade', 'ग्रेड')} description={tt(isHi, 'Review recorded evidence. Missing cells remain unavailable.', 'दर्ज प्रमाण देखें। गुम सेल अनुपलब्ध ही रहते हैं।')} actions={<Link className="v3-button v3-button--primary v3-button--md" href={`/teacher/submissions?class=${encodeURIComponent(scope.classId)}`}>{tt(isHi, 'Open grading queue', 'ग्रेडिंग सूची खोलें')}</Link>} /><Surface padding="none"><div className="v3-table-region" role="region" aria-label={tt(isHi, 'Grade book', 'ग्रेड बुक')} tabIndex={0}><table><thead><tr><th>{tt(isHi, 'Student', 'छात्र')}</th>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.student_id}><th>{row.student_name}</th>{columns.map((column) => { const cell = row.cells?.[column.key]; return <td key={column.key}>{cell?.score == null ? '—' : `${cell.score}/${cell.max_score}`}</td>; })}</tr>)}</tbody></table></div>{!rows.length ? <DataState compact state="empty" title={tt(isHi, 'No grade evidence yet', 'अभी कोई ग्रेड प्रमाण नहीं')} /> : null}</Surface></section>;
}

export function TeacherResourcesV3() {
  const { isHi } = useAuth();
  const scope = useTeacherV3Scope();
  return <section className="v3-page" data-testid="teacher-v3-resources"><PageHeader eyebrow={tt(isHi, 'Teaching tools', 'शिक्षण उपकरण')} title={tt(isHi, 'Resources', 'संसाधन')} description={tt(isHi, 'Create class-ready material without changing the active class scope.', 'सक्रिय कक्षा स्कोप बदले बिना कक्षा के लिए सामग्री बनाएँ।')} /><div className="v3-card-grid"><Link className="v3-card" href={`/teacher/worksheets?class=${encodeURIComponent(scope.classId ?? '')}`}><h2>{tt(isHi, 'Worksheets', 'वर्कशीट')}</h2><p>{tt(isHi, 'Create and reuse governed worksheets.', 'नियंत्रित वर्कशीट बनाएँ और दोबारा उपयोग करें।')}</p></Link><Link className="v3-card" href={`/teacher/assign?class=${encodeURIComponent(scope.classId ?? '')}`}><h2>{tt(isHi, 'Assignment composer', 'असाइनमेंट कंपोज़र')}</h2><p>{tt(isHi, 'Turn evidence into a targeted activity.', 'प्रमाण को लक्षित गतिविधि में बदलें।')}</p></Link></div></section>;
}

export function TeacherSettingsV3() {
  const { isHi, teacher } = useAuth();
  return <section className="v3-page" data-testid="teacher-v3-settings"><PageHeader eyebrow={tt(isHi, 'Account and preferences', 'खाता और प्राथमिकताएँ')} title={tt(isHi, 'Settings', 'सेटिंग्स')} description={tt(isHi, 'Your verified teacher identity and account controls.', 'आपकी सत्यापित शिक्षक पहचान और खाता नियंत्रण।')} /><Surface variant="raised"><dl className="v3-definition-list"><div><dt>{tt(isHi, 'Name', 'नाम')}</dt><dd>{teacher?.name ?? '—'}</dd></div><div><dt>{tt(isHi, 'School', 'स्कूल')}</dt><dd>{teacher?.school_name ?? '—'}</dd></div></dl><Link className="v3-button v3-button--secondary v3-button--md" href="/teacher/profile">{tt(isHi, 'Edit profile', 'प्रोफ़ाइल संपादित करें')}</Link></Surface></section>;
}

export function TeacherPageGate({ legacy, v3 }: { legacy: React.ReactNode; v3: React.ReactNode }) {
  const { enabled, loading, manifest, routeAllowed } = useExperienceV3('teacher');
  const { activeRole, isLoading: authLoading } = useAuth();
  if (loading || authLoading) return <DataState state="loading" title="Loading teacher workspace…" />;
  return <>{enabled && routeAllowed && manifest && activeRole === 'teacher' ? v3 : legacy}</>;
}
