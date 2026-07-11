'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { authedFetch } from '@alfanumrik/lib/school-admin/authed-fetch';
import type { ClassAtRiskRow, OverviewResponse, TeacherEngagementRow } from '@alfanumrik/lib/school-admin/command-center-types';
import { Button, DataState, MetricTrust, PageHeader, ProgressBar, StatusBadge, Surface, type MetricTrustProps } from '@alfanumrik/ui/v3';
import { useSchoolV3Scope } from './SchoolAdminV3Shell';

function useSchoolResource<T>(path: string) {
  const { schoolId } = useSchoolV3Scope();
  const [data, setData] = useState<T | null>(null);
  const [retrievedAt, setRetrievedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const scopedPath = useMemo(() => {
    if (!schoolId) return null;
    const url = new URL(path, 'https://alfanumrik.local');
    url.searchParams.set('school_id', schoolId);
    return `${url.pathname}${url.search}`;
  }, [path, schoolId]);
  useEffect(() => {
    if (!scopedPath) {
      setLoading(false);
      setError(true);
      return;
    }
    let active = true;
    setLoading(true);
    setError(false);
    authedFetch(scopedPath)
      .then(async (response) => {
        if (!response.ok) throw new Error(`request:${response.status}`);
        return response.json() as Promise<T>;
      })
      .then((body) => { if (active) { setData(body); setRetrievedAt(new Date().toISOString()); } })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt, scopedPath]);
  return { data, loading, error, retrievedAt, retry: () => setAttempt((value) => value + 1) };
}

function SchoolLink({ href, ...props }: ComponentProps<typeof Link>) {
  const { withSchoolScope } = useSchoolV3Scope();
  return <Link href={typeof href === 'string' ? withSchoolScope(href) : href} {...props} />;
}

function Metric({ label, value, trust }: { label: string; value: number | string | null; trust: MetricTrustProps }) {
  return <Surface className="p-4"><p className="text-sm text-secondary-ink">{label}</p><p className="mt-1 text-2xl font-bold">{value ?? '—'}</p><MetricTrust {...trust} /></Surface>;
}

export function SchoolV3Overview() {
  const { schoolName, academicYear, withSchoolScope } = useSchoolV3Scope();
  const overview = useSchoolResource<OverviewResponse>('/api/school-admin/overview');
  const risks = useSchoolResource<{ data: ClassAtRiskRow[] }>('/api/school-admin/classes-at-risk?limit=5');
  return (
    <div className="space-y-5">
      <PageHeader title="School overview" description={`${schoolName} · ${academicYear} · Exceptions and decisions requiring attention.`} />
      {overview.loading ? <DataState state="loading" title="Loading governed school metrics" /> : overview.error || !overview.data ? <DataState state="error" title="School overview is temporarily unavailable" action={<Button onClick={overview.retry}>Try again</Button>} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Active students" value={overview.data.data.active_students} trust={{ source: 'School overview read model', definition: 'Active learner profiles within the authenticated school scope.', freshness: null, retrievedAt: overview.retrievedAt ? new Date(overview.retrievedAt).toLocaleString('en-IN') : null, evidenceHref: withSchoolScope('/school-admin/students') }} />
            <Metric label="Teachers" value={overview.data.data.teacher_count} trust={{ source: 'School overview read model', definition: 'Teacher profiles in the authenticated school roster.', freshness: null, retrievedAt: overview.retrievedAt ? new Date(overview.retrievedAt).toLocaleString('en-IN') : null, evidenceHref: withSchoolScope('/school-admin/teachers') }} />
            <Metric label="Seat use" value={overview.data.data.seat_utilization_pct == null ? null : `${overview.data.data.seat_utilization_pct}%`} trust={{ source: 'School overview read model', definition: 'Active students divided by current purchased seat capacity; unavailable when capacity is absent.', freshness: null, retrievedAt: overview.retrievedAt ? new Date(overview.retrievedAt).toLocaleString('en-IN') : null }} />
            <Metric label="Average mastery" value={overview.data.data.avg_mastery == null ? null : `${Math.round(overview.data.data.avg_mastery * 100)}%`} trust={{ source: 'School overview read model', definition: 'Mean BKT knowledge probability across the active school roster.', freshness: null, retrievedAt: overview.retrievedAt ? new Date(overview.retrievedAt).toLocaleString('en-IN') : null, evidenceHref: withSchoolScope('/school-admin/insights') }} />
          </div>
          <Surface className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">Classes requiring intervention</h2><MetricTrust source="Class-risk read model" definition="Classes with students below the governed BKT at-risk threshold; counts and mastery are returned by the school-scoped read model." freshness={null} retrievedAt={risks.retrievedAt ? new Date(risks.retrievedAt).toLocaleString('en-IN') : null} evidenceHref={withSchoolScope('/school-admin/insights')} /></div><SchoolLink className="v3-button v3-button--secondary" href="/school-admin/insights">Open insights</SchoolLink></div>
            {risks.loading ? <div className="mt-4"><DataState state="loading" title="Loading class risks" /></div> : risks.error ? <div className="mt-4"><DataState state="error" title="Class risks unavailable" action={<Button onClick={risks.retry}>Try again</Button>} /></div> : !(risks.data?.data?.length) ? <div className="mt-4"><DataState state="empty" title="No class risk evidence" description="No risk rows were returned for the current school scope." /></div> : <div className="mt-4 space-y-3">{risks.data.data.map((row) => <div key={row.class_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"><div><p className="font-semibold">{row.class_name}</p><p className="text-sm text-secondary-ink">{row.student_count} students · {row.at_risk_count} need attention</p></div><StatusBadge tone={row.at_risk_count > 0 ? 'warning' : 'success'}>{row.avg_mastery == null ? '—' : `${Math.round(row.avg_mastery * 100)}% mastery`}</StatusBadge></div>)}</div>}
          </Surface>
        </>
      )}
    </div>
  );
}

function DestinationGrid({ items }: { items: Array<{ href: string; title: string; description: string }> }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((item) => <SchoolLink key={item.href} href={item.href}><Surface className="h-full p-5 transition-transform hover:-translate-y-0.5"><h2 className="font-bold">{item.title}</h2><p className="mt-2 text-sm text-secondary-ink">{item.description}</p><span className="mt-4 inline-block text-sm font-semibold text-action-orange">Open →</span></Surface></SchoolLink>)}</div>;
}

export function SchoolV3People() {
  const students = useSchoolResource<{ data?: Array<{ id: string; name: string | null; grade: string | null; is_active?: boolean }>; pagination?: { total?: number } }>('/api/school-admin/students?page=1&limit=8');
  const teachers = useSchoolResource<{ data?: Array<{ id: string; name: string | null; subjects_taught?: string[]; is_active?: boolean }>; pagination?: { total?: number } }>('/api/school-admin/teachers?page=1&limit=8');
  return <div className="space-y-5"><PageHeader title="People" description="Live school rosters within the authenticated tenant boundary." actions={<div className="flex gap-2"><SchoolLink className="v3-button v3-button--secondary" href="/school-admin/invite-codes">Invite</SchoolLink><SchoolLink className="v3-button v3-button--primary" href="/school-admin/enroll">Enrol</SchoolLink></div>} />
    <div className="grid gap-4 xl:grid-cols-2">
      <Surface className="p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-bold">Students</h2><p className="text-sm text-secondary-ink">{students.data?.pagination?.total ?? '—'} in the current roster</p></div><SchoolLink href="/school-admin/students" className="text-sm font-semibold">Manage</SchoolLink></div>{students.loading ? <DataState state="loading" compact title="Loading students" /> : students.error ? <DataState state="permission" compact title="Student roster unavailable" description="Your role may not manage students." /> : !(students.data?.data?.length) ? <DataState state="empty" compact title="No students" /> : <div className="mt-4 divide-y divide-border">{students.data.data.map((student) => <div key={student.id} className="flex items-center justify-between py-3"><div><p className="font-semibold">{student.name ?? 'Student'}</p><p className="text-sm text-secondary-ink">Grade {student.grade ?? '—'}</p></div><StatusBadge tone={student.is_active == null ? 'neutral' : student.is_active ? 'success' : 'warning'}>{student.is_active == null ? '—' : student.is_active ? 'Active' : 'Inactive'}</StatusBadge></div>)}</div>}</Surface>
      <Surface className="p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-bold">Teachers</h2><p className="text-sm text-secondary-ink">{teachers.data?.pagination?.total ?? '—'} in the teaching roster</p></div><SchoolLink href="/school-admin/teachers" className="text-sm font-semibold">Manage</SchoolLink></div>{teachers.loading ? <DataState state="loading" compact title="Loading teachers" /> : teachers.error ? <DataState state="permission" compact title="Teacher roster unavailable" description="Your role may not manage teachers." /> : !(teachers.data?.data?.length) ? <DataState state="empty" compact title="No teachers" /> : <div className="mt-4 divide-y divide-border">{teachers.data.data.map((teacher) => <div key={teacher.id} className="flex items-center justify-between py-3"><div><p className="font-semibold">{teacher.name ?? 'Teacher'}</p><p className="text-sm text-secondary-ink">{teacher.subjects_taught?.join(', ') || 'Subjects —'}</p></div><StatusBadge tone={teacher.is_active == null ? 'neutral' : teacher.is_active ? 'success' : 'warning'}>{teacher.is_active == null ? '—' : teacher.is_active ? 'Active' : 'Inactive'}</StatusBadge></div>)}</div>}</Surface>
    </div>
    <DestinationGrid items={[{ href: '/school-admin/parents', title: 'Parent relationships', description: 'Guardian relationships and communication access.' }, { href: '/school-admin/staff', title: 'Staff & roles', description: 'Administrative roles and governed capabilities.' }]} />
  </div>;
}

export function SchoolV3Academics() {
  const classes = useSchoolResource<{ data?: Array<{ id: string; name: string; grade: string; section: string; subject?: string; enrolled_count?: number }> }>('/api/school-admin/classes?page=1&limit=8');
  const exams = useSchoolResource<{ data?: { exams?: Array<{ id: string; title: string; subject: string; grade: string; status: string; start_time: string }> } }>('/api/school-admin/exams?page=1&limit=6&upcoming=true');
  return <div className="space-y-5"><PageHeader title="Academics" description="Live classes and upcoming assessment operations—not generic ERP data." />
    <div className="grid gap-4 xl:grid-cols-2">
      <Surface className="p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Classes</h2><SchoolLink href="/school-admin/classes" className="text-sm font-semibold">Manage</SchoolLink></div>{classes.loading ? <DataState state="loading" compact title="Loading classes" /> : classes.error ? <DataState state="permission" compact title="Classes unavailable" /> : !(classes.data?.data?.length) ? <DataState state="empty" compact title="No classes" /> : <div className="mt-4 divide-y divide-border">{classes.data.data.map((item) => <div key={item.id} className="flex items-center justify-between py-3"><div><p className="font-semibold">{item.name}</p><p className="text-sm text-secondary-ink">Grade {item.grade} · {item.section}{item.subject ? ` · ${item.subject}` : ''}</p></div><span className="text-sm">{item.enrolled_count ?? '—'} learners</span></div>)}</div>}</Surface>
      <Surface className="p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Upcoming assessments</h2><SchoolLink href="/school-admin/exams" className="text-sm font-semibold">Manage</SchoolLink></div>{exams.loading ? <DataState state="loading" compact title="Loading assessments" /> : exams.error ? <DataState state="permission" compact title="Assessments unavailable" /> : !(exams.data?.data?.exams?.length) ? <DataState state="empty" compact title="No upcoming assessments" /> : <div className="mt-4 divide-y divide-border">{exams.data.data.exams.map((exam) => <div key={exam.id} className="py-3"><div className="flex items-center justify-between gap-3"><p className="font-semibold">{exam.title}</p><StatusBadge tone="info">{exam.status}</StatusBadge></div><p className="mt-1 text-sm text-secondary-ink">{exam.subject} · Grade {exam.grade} · {new Date(exam.start_time).toLocaleDateString('en-IN')}</p></div>)}</div>}</Surface>
    </div>
    <DestinationGrid items={[{ href: '/school-admin/content', title: 'Learning content', description: 'Curriculum-aligned learning resources.' }, { href: '/school-admin/announcements', title: 'Announcements', description: 'Academic communication to the school community.' }]} />
  </div>;
}

export function SchoolV3Insights() {
  const { withSchoolScope } = useSchoolV3Scope();
  const engagement = useSchoolResource<{ data: TeacherEngagementRow[] }>('/api/school-admin/teacher-engagement?limit=12');
  return <div className="space-y-5"><PageHeader title="Insights" description="Evidence-backed school and teaching signals. Unavailable values remain —." />{engagement.loading ? <DataState state="loading" title="Loading teacher engagement" /> : engagement.error ? <DataState state="error" title="Teacher engagement is temporarily unavailable" action={<Button onClick={engagement.retry}>Try again</Button>} /> : !(engagement.data?.data?.length) ? <DataState state="empty" title="No engagement evidence" /> : <div className="space-y-3">{engagement.data.data.map((row) => { const denominator = row.remediation_assigned_count; const pct = denominator > 0 ? Math.round(row.remediation_resolved_count / denominator * 100) : null; return <Surface key={row.teacher_id} className="p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="font-bold">{row.teacher_name}</h2><p className="text-sm text-secondary-ink">{row.class_count} classes · {row.remediation_assigned_count} interventions</p></div><span className="font-semibold">{pct == null ? '—' : `${pct}% resolved`}</span></div><div className="mt-3">{pct == null ? <p className="text-secondary-ink" aria-label={`${row.teacher_name} intervention resolution unavailable`}>—</p> : <ProgressBar value={pct} label={`${row.teacher_name} intervention resolution`} showValue />}</div><MetricTrust source="Teacher engagement read model" definition="Resolved interventions divided by assigned interventions; unavailable when none were assigned." freshness={null} retrievedAt={engagement.retrievedAt ? new Date(engagement.retrievedAt).toLocaleString('en-IN') : null} evidenceHref={withSchoolScope('/school-admin/teachers')} /></Surface>; })}</div>}</div>;
}

export function SchoolV3Settings() {
  return <div className="space-y-5"><PageHeader title="Settings & governance" description="Institution configuration, access, data and audit controls." /><DestinationGrid items={[{ href: '/school-admin/branding', title: 'School identity', description: 'Approved logo and controlled tenant accent.' }, { href: '/school-admin/modules', title: 'Modules', description: 'Entitled learning capabilities.' }, { href: '/school-admin/rbac', title: 'Roles & access', description: 'Fail-closed administrative permissions.' }, { href: '/school-admin/audit-log', title: 'Audit log', description: 'Review governed administrative activity.' }, { href: '/school-admin/api-keys', title: 'API access', description: 'Manage integration credentials securely.' }, { href: '/school-admin/setup', title: 'School setup', description: 'Complete required institution configuration.' }]} /></div>;
}
