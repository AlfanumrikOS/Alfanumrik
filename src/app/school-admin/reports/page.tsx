'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Card,
  Button,
  Input,
  Select,
  Badge,
  Skeleton,
  EmptyState,
} from '@/components/ui';

/* ─────────────────────────────────────────────────────────────
   BILINGUAL HELPER (P7)
───────────────────────────────────────────────────────────── */
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

/* ─────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────── */
type ReportTab = 'school_overview' | 'class_performance' | 'student_detail' | 'subject_gaps';

interface SubjectPerformance {
  subject: string;
  quiz_count: number;
  avg_score: number;
  student_count: number;
}

interface GradePerformance {
  /** Always a string "6"–"12" per P5 */
  grade: string;
  student_count: number;
  avg_score: number;
  quiz_count: number;
}

interface SchoolOverviewData {
  total_quizzes: number;
  avg_score: number;
  active_students: number;
  completion_rate: number;
  subject_performance: SubjectPerformance[];
  grade_performance: GradePerformance[];
}

interface ClassOption {
  id: string;
  name: string;
  /** Always a string "6"–"12" per P5 */
  grade: string;
}

interface ClassStudentRank {
  name: string;
  avg_score: number;
}

interface ClassSubjectBreakdown {
  subject: string;
  avg_score: number;
  quiz_count: number;
}

interface ClassPerformanceData {
  class_avg_score: number;
  completion_rate: number;
  top_students: ClassStudentRank[];
  bottom_students: ClassStudentRank[];
  subject_breakdown: ClassSubjectBreakdown[];
}

interface StudentSearchResult {
  id: string;
  name: string;
  /** Always a string "6"–"12" per P5 */
  grade: string;
  xp_total: number;
  last_active: string | null;
}

interface StudentSubjectScore {
  subject: string;
  avg_score: number;
  quiz_count: number;
}

interface StudentDetailData {
  student: StudentSearchResult;
  total_quizzes: number;
  avg_score: number;
  best_subject: string | null;
  weakest_subject: string | null;
  subject_scores: StudentSubjectScore[];
}

interface SubjectGapEntry {
  subject: string;
  avg_score: number;
  quiz_count: number;
  status: 'critical' | 'needs_attention' | 'good';
}

interface SubjectGapsData {
  gaps: SubjectGapEntry[];
}

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */
const TABS: { key: ReportTab; labelEn: string; labelHi: string }[] = [
  { key: 'school_overview', labelEn: 'School Overview', labelHi: 'स्कूल अवलोकन' },
  { key: 'class_performance', labelEn: 'Class Performance', labelHi: 'कक्षा प्रदर्शन' },
  { key: 'student_detail', labelEn: 'Student Detail', labelHi: 'छात्र विवरण' },
  { key: 'subject_gaps', labelEn: 'Subject Gaps', labelHi: 'विषय अंतर' },
];

const GRADE_VALUES = ['6', '7', '8', '9', '10', '11', '12'] as const;

/* ─────────────────────────────────────────────────────────────
   STYLE HELPERS
───────────────────────────────────────────────────────────── */
const SUCCESS_COLOR = '#22C55E';
const WARNING_COLOR = '#EAB308';
const DANGER_COLOR = '#EF4444';

function scoreColor(score: number): string {
  if (score >= 80) return SUCCESS_COLOR;
  if (score >= 50) return WARNING_COLOR;
  return DANGER_COLOR;
}

function gapStatusLabel(status: string, isHi: boolean): string {
  if (status === 'critical') return t(isHi, 'Critical', 'गंभीर');
  if (status === 'needs_attention') return t(isHi, 'Needs Attention', 'ध्यान आवश्यक');
  return t(isHi, 'Good', 'अच्छा');
}

function gapStatusColor(status: string): string {
  if (status === 'critical') return DANGER_COLOR;
  if (status === 'needs_attention') return WARNING_COLOR;
  return SUCCESS_COLOR;
}

/* ─────────────────────────────────────────────────────────────
   SKELETON COMPONENTS
───────────────────────────────────────────────────────────── */
function StatCardsSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} variant="rect" height={90} rounded="rounded-xl" />
      ))}
    </div>
  );
}

function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Skeleton variant="rect" height={40} rounded="rounded-lg" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="rect" height={36} rounded="rounded-lg" />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   STAT CARD (inline for this page)
───────────────────────────────────────────────────────────── */
function ReportStatCard({ value, label, color }: { value: string | number; label: string; color: string }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: '16px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span style={{ fontSize: 24, fontWeight: 700, color, fontFamily: 'Sora, system-ui, sans-serif' }}>
        {value}
      </span>
      <span style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>{label}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   SORTABLE TABLE
───────────────────────────────────────────────────────────── */
type SortDir = 'asc' | 'desc';

interface TableColumn<T> {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  sortValue?: (row: T) => number | string;
  align?: 'left' | 'right' | 'center';
}

function SortableTable<T>({ columns, data, defaultSort, defaultDir = 'desc' }: {
  columns: TableColumn<T>[];
  data: T[];
  defaultSort?: string;
  defaultDir?: SortDir;
}) {
  const [sortKey, setSortKey] = useState(defaultSort || columns[0]?.key || '');
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return data;
    const copy = [...data];
    copy.sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      const sa = String(va);
      const sb = String(vb);
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return copy;
  }, [data, sortKey, sortDir, columns]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  return (
    <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e7eb' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => col.sortValue && handleSort(col.key)}
                style={{
                  padding: '10px 12px',
                  textAlign: col.align || 'left',
                  fontWeight: 600,
                  color: '#374151',
                  cursor: col.sortValue ? 'pointer' : 'default',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  borderBottom: '1px solid #e5e7eb',
                }}
              >
                {col.label}
                {col.sortValue && sortKey === col.key && (
                  <span style={{ marginLeft: 4, fontSize: 10 }}>
                    {sortDir === 'asc' ? '\u25B2' : '\u25BC'}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, idx) => (
            <tr
              key={idx}
              style={{
                background: idx % 2 === 0 ? '#fff' : '#f9fafb',
                borderBottom: idx < sorted.length - 1 ? '1px solid #f3f4f6' : undefined,
              }}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  style={{
                    padding: '10px 12px',
                    textAlign: col.align || 'left',
                    color: '#374151',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   SCORE BAR (simple inline bar for student subject scores)
───────────────────────────────────────────────────────────── */
function ScoreBar({ score, label }: { score: number; label: string }) {
  const color = scoreColor(score);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: '#374151', minWidth: 100, textAlign: 'right' }}>
        {label}
      </span>
      <div style={{ flex: 1, background: '#f3f4f6', borderRadius: 6, height: 18, overflow: 'hidden', position: 'relative' }}>
        <div
          style={{
            width: `${Math.min(100, Math.max(0, score))}%`,
            height: '100%',
            background: color,
            borderRadius: 6,
            transition: 'width 0.3s ease',
          }}
        />
        <span
          style={{
            position: 'absolute',
            right: 6,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 10,
            fontWeight: 700,
            color: score > 30 ? '#fff' : '#374151',
          }}
        >
          {Math.round(score)}%
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────── */
export default function SchoolAdminReportsPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi } = useAuth();

  /* ── Auth & school state ── */
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(true);

  /* ── Tab state ── */
  const [activeTab, setActiveTab] = useState<ReportTab>('school_overview');

  /* ── Data state for each tab ── */
  const [overviewData, setOverviewData] = useState<SchoolOverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [classOptionsLoading, setClassOptionsLoading] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [classData, setClassData] = useState<ClassPerformanceData | null>(null);
  const [classLoading, setClassLoading] = useState(false);
  const [classError, setClassError] = useState<string | null>(null);

  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [studentSearchResults, setStudentSearchResults] = useState<StudentSearchResult[]>([]);
  const [studentSearchLoading, setStudentSearchLoading] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [studentData, setStudentData] = useState<StudentDetailData | null>(null);
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);

  const [gapGradeFilter, setGapGradeFilter] = useState('');
  const [gapsData, setGapsData] = useState<SubjectGapsData | null>(null);
  const [gapsLoading, setGapsLoading] = useState(false);
  const [gapsError, setGapsError] = useState<string | null>(null);

  /* ─────────────────────────────────────────────────────────────
     AUTH HELPERS
  ───────────────────────────────────────────────────────────── */
  const getToken = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const fetchAdminRecord = useCallback(async () => {
    if (!authUserId) return;
    setLoadingAdmin(true);

    const { data, error } = await supabase
      .from('school_admins')
      .select('school_id')
      .eq('auth_user_id', authUserId)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) {
      router.replace('/login');
      return;
    }

    setSchoolId(data.school_id as string);
    setLoadingAdmin(false);
  }, [authUserId, router]);

  /* ── Auth redirect guard ── */
  useEffect(() => {
    if (!authLoading && !authUserId) {
      router.replace('/login');
    }
  }, [authLoading, authUserId, router]);

  /* ── Fetch admin record once auth is ready ── */
  useEffect(() => {
    if (!authLoading && authUserId) {
      fetchAdminRecord();
    }
  }, [authLoading, authUserId, fetchAdminRecord]);

  /* ─────────────────────────────────────────────────────────────
     REPORT API HELPER
  ───────────────────────────────────────────────────────────── */
  const fetchReport = useCallback(async (type: string, params: Record<string, string> = {}): Promise<any> => {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');

    const qs = new URLSearchParams({ type, ...params });
    const res = await fetch(`/api/school-admin/reports?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }

    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  }, [getToken]);

  /* ─────────────────────────────────────────────────────────────
     TAB 1: SCHOOL OVERVIEW
  ───────────────────────────────────────────────────────────── */
  const loadOverview = useCallback(async () => {
    if (!schoolId) return;
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const data = await fetchReport('school_overview');
      setOverviewData(data as SchoolOverviewData);
    } catch (err: any) {
      setOverviewError(err.message || 'Failed to load overview');
    } finally {
      setOverviewLoading(false);
    }
  }, [schoolId, fetchReport]);

  /* ─────────────────────────────────────────────────────────────
     TAB 2: CLASS PERFORMANCE
  ───────────────────────────────────────────────────────────── */
  const loadClassOptions = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setClassOptionsLoading(true);
    try {
      const res = await fetch('/api/school-admin/classes', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setClassOptions((json.data ?? json) as ClassOption[]);
      }
    } catch {
      // Non-critical — class dropdown may be empty
    } finally {
      setClassOptionsLoading(false);
    }
  }, [getToken]);

  const loadClassPerformance = useCallback(async (classId: string) => {
    if (!schoolId || !classId) return;
    setClassLoading(true);
    setClassError(null);
    try {
      const data = await fetchReport('class_performance', { class_id: classId });
      setClassData(data as ClassPerformanceData);
    } catch (err: any) {
      setClassError(err.message || 'Failed to load class data');
    } finally {
      setClassLoading(false);
    }
  }, [schoolId, fetchReport]);

  /* ─────────────────────────────────────────────────────────────
     TAB 3: STUDENT DETAIL
  ───────────────────────────────────────────────────────────── */
  const searchStudents = useCallback(async (query: string) => {
    if (!schoolId || query.trim().length < 2) {
      setStudentSearchResults([]);
      return;
    }
    setStudentSearchLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const qs = new URLSearchParams({ type: 'student_search', query: query.trim() });
      const res = await fetch(`/api/school-admin/reports?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setStudentSearchResults((json.data ?? []) as StudentSearchResult[]);
      }
    } catch {
      // Search failure is non-critical; silently show empty results
    } finally {
      setStudentSearchLoading(false);
    }
  }, [schoolId, getToken]);

  const loadStudentDetail = useCallback(async (studentId: string) => {
    if (!schoolId) return;
    setStudentLoading(true);
    setStudentError(null);
    try {
      const data = await fetchReport('student_detail', { student_id: studentId });
      setStudentData(data as StudentDetailData);
    } catch (err: any) {
      setStudentError(err.message || 'Failed to load student data');
    } finally {
      setStudentLoading(false);
    }
  }, [schoolId, fetchReport]);

  /* ─────────────────────────────────────────────────────────────
     TAB 4: SUBJECT GAPS
  ───────────────────────────────────────────────────────────── */
  const loadSubjectGaps = useCallback(async (gradeFilter: string) => {
    if (!schoolId) return;
    setGapsLoading(true);
    setGapsError(null);
    try {
      const params: Record<string, string> = {};
      if (gradeFilter) params.grade = gradeFilter;
      const data = await fetchReport('subject_gaps', params);
      setGapsData(data as SubjectGapsData);
    } catch (err: any) {
      setGapsError(err.message || 'Failed to load subject gaps');
    } finally {
      setGapsLoading(false);
    }
  }, [schoolId, fetchReport]);

  /* ─────────────────────────────────────────────────────────────
     TAB CHANGE EFFECTS
  ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!schoolId) return;
    if (activeTab === 'school_overview' && !overviewData && !overviewLoading) {
      loadOverview();
    }
    if (activeTab === 'class_performance' && classOptions.length === 0 && !classOptionsLoading) {
      loadClassOptions();
    }
    if (activeTab === 'subject_gaps' && !gapsData && !gapsLoading) {
      loadSubjectGaps(gapGradeFilter);
    }
  }, [
    schoolId, activeTab,
    overviewData, overviewLoading, loadOverview,
    classOptions.length, classOptionsLoading, loadClassOptions,
    gapsData, gapsLoading, gapGradeFilter, loadSubjectGaps,
  ]);

  /* ── Load class performance when class selection changes ── */
  useEffect(() => {
    if (selectedClassId) {
      loadClassPerformance(selectedClassId);
    } else {
      setClassData(null);
    }
  }, [selectedClassId, loadClassPerformance]);

  /* ── Debounced student search ── */
  useEffect(() => {
    if (activeTab !== 'student_detail') return;
    if (studentSearchQuery.trim().length < 2) {
      setStudentSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      searchStudents(studentSearchQuery);
    }, 400);
    return () => clearTimeout(timer);
  }, [studentSearchQuery, activeTab, searchStudents]);

  /* ── Load student detail when student is selected ── */
  useEffect(() => {
    if (selectedStudentId) {
      loadStudentDetail(selectedStudentId);
    } else {
      setStudentData(null);
    }
  }, [selectedStudentId, loadStudentDetail]);

  /* ── Reload subject gaps when grade filter changes ── */
  useEffect(() => {
    if (activeTab === 'subject_gaps' && schoolId) {
      loadSubjectGaps(gapGradeFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gapGradeFilter]);

  /* ─────────────────────────────────────────────────────────────
     GRADE OPTIONS (P5 — grades are strings)
  ───────────────────────────────────────────────────────────── */
  const gradeSelectOptions = useMemo(() => {
    const allLabel = t(isHi, 'All Grades', 'सभी कक्षाएं');
    return [
      { value: '', label: allLabel },
      ...GRADE_VALUES.map((g) => ({
        value: g,
        label: t(isHi, `Grade ${g}`, `कक्षा ${g}`),
      })),
    ];
  }, [isHi]);

  const classSelectOptions = useMemo(() => {
    return [
      { value: '', label: t(isHi, 'Select a class', 'कक्षा चुनें') },
      ...classOptions.map((c) => ({
        value: c.id,
        label: `${c.name} (${t(isHi, `Grade ${c.grade}`, `कक्षा ${c.grade}`)})`,
      })),
    ];
  }, [classOptions, isHi]);

  /* ─────────────────────────────────────────────────────────────
     LOADING / AUTH STATES
  ───────────────────────────────────────────────────────────── */
  const isPageLoading = authLoading || loadingAdmin;

  if (isPageLoading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton variant="title" height={28} width="40%" />
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} variant="rect" height={38} width={140} rounded="rounded-lg" />
            ))}
          </div>
          <StatCardsSkeleton />
          <div style={{ marginTop: 20 }}>
            <TableSkeleton />
          </div>
        </div>
      </div>
    );
  }

  /* ─────────────────────────────────────────────────────────────
     TAB CONTENT RENDERERS
  ───────────────────────────────────────────────────────────── */

  /* ── Tab 1: School Overview ── */
  function renderOverview() {
    if (overviewLoading) {
      return (
        <>
          <StatCardsSkeleton />
          <div style={{ marginTop: 24 }}>
            <Skeleton variant="title" height={18} width="30%" />
            <div style={{ marginTop: 10 }}><TableSkeleton /></div>
          </div>
          <div style={{ marginTop: 24 }}>
            <Skeleton variant="title" height={18} width="30%" />
            <div style={{ marginTop: 10 }}><TableSkeleton /></div>
          </div>
        </>
      );
    }

    if (overviewError) {
      return (
        <Card className="text-center py-8">
          <p style={{ color: DANGER_COLOR, fontSize: 14, marginBottom: 12 }}>{overviewError}</p>
          <Button variant="primary" onClick={loadOverview}>
            {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </Button>
        </Card>
      );
    }

    if (!overviewData) return null;

    const { total_quizzes, avg_score, active_students, completion_rate, subject_performance, grade_performance } = overviewData;

    const subjectCols: TableColumn<SubjectPerformance>[] = [
      {
        key: 'subject',
        label: t(isHi, 'Subject', 'विषय'),
        render: (r) => <span style={{ fontWeight: 600 }}>{r.subject}</span>,
        sortValue: (r) => r.subject,
      },
      {
        key: 'quiz_count',
        label: t(isHi, 'Quizzes', 'क्विज़'),
        render: (r) => r.quiz_count,
        sortValue: (r) => r.quiz_count,
        align: 'right',
      },
      {
        key: 'avg_score',
        label: t(isHi, 'Avg Score', 'औसत स्कोर'),
        render: (r) => (
          <span style={{ fontWeight: 700, color: scoreColor(r.avg_score) }}>
            {Math.round(r.avg_score)}%
          </span>
        ),
        sortValue: (r) => r.avg_score,
        align: 'right',
      },
      {
        key: 'student_count',
        label: t(isHi, 'Students', 'छात्र'),
        render: (r) => r.student_count,
        sortValue: (r) => r.student_count,
        align: 'right',
      },
    ];

    const gradeCols: TableColumn<GradePerformance>[] = [
      {
        key: 'grade',
        label: t(isHi, 'Grade', 'कक्षा'),
        render: (r) => (
          <Badge color="var(--color-brand-primary, #7C3AED)" size="sm">
            {t(isHi, `Grade ${r.grade}`, `कक्षा ${r.grade}`)}
          </Badge>
        ),
        sortValue: (r) => r.grade,
      },
      {
        key: 'student_count',
        label: t(isHi, 'Students', 'छात्र'),
        render: (r) => r.student_count,
        sortValue: (r) => r.student_count,
        align: 'right',
      },
      {
        key: 'avg_score',
        label: t(isHi, 'Avg Score', 'औसत स्कोर'),
        render: (r) => (
          <span style={{ fontWeight: 700, color: scoreColor(r.avg_score) }}>
            {Math.round(r.avg_score)}%
          </span>
        ),
        sortValue: (r) => r.avg_score,
        align: 'right',
      },
      {
        key: 'quiz_count',
        label: t(isHi, 'Quizzes', 'क्विज़'),
        render: (r) => r.quiz_count,
        sortValue: (r) => r.quiz_count,
        align: 'right',
      },
    ];

    return (
      <>
        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <ReportStatCard
            value={total_quizzes.toLocaleString('en-IN')}
            label={t(isHi, 'Total Quizzes', 'कुल क्विज़')}
            color="var(--color-brand-primary, #7C3AED)"
          />
          <ReportStatCard
            value={`${Math.round(avg_score)}%`}
            label={t(isHi, 'Avg Score', 'औसत स्कोर')}
            color={scoreColor(avg_score)}
          />
          <ReportStatCard
            value={active_students.toLocaleString('en-IN')}
            label={t(isHi, 'Active Students', 'सक्रिय छात्र')}
            color="var(--color-brand-secondary, #F97316)"
          />
          <ReportStatCard
            value={`${Math.round(completion_rate)}%`}
            label={t(isHi, 'Completion Rate', 'पूर्णता दर')}
            color={scoreColor(completion_rate)}
          />
        </div>

        {/* Subject performance table */}
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 10 }}>
            {t(isHi, 'Subject Performance', 'विषय प्रदर्शन')}
          </h3>
          {subject_performance.length > 0 ? (
            <SortableTable columns={subjectCols} data={subject_performance} defaultSort="avg_score" />
          ) : (
            <EmptyState
              icon="---"
              title={t(isHi, 'No subject data yet', 'अभी कोई विषय डेटा नहीं')}
              description={t(isHi, 'Data will appear as students take quizzes.', 'छात्रों के क्विज़ देने पर डेटा दिखेगा।')}
            />
          )}
        </div>

        {/* Grade performance table */}
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 10 }}>
            {t(isHi, 'Grade Performance', 'कक्षा प्रदर्शन')}
          </h3>
          {grade_performance.length > 0 ? (
            <SortableTable columns={gradeCols} data={grade_performance} defaultSort="avg_score" />
          ) : (
            <EmptyState
              icon="---"
              title={t(isHi, 'No grade data yet', 'अभी कोई कक्षा डेटा नहीं')}
              description={t(isHi, 'Data will appear as students take quizzes.', 'छात्रों के क्विज़ देने पर डेटा दिखेगा।')}
            />
          )}
        </div>
      </>
    );
  }

  /* ── Tab 2: Class Performance ── */
  function renderClassPerformance() {
    return (
      <>
        {/* Class selector */}
        <div style={{ maxWidth: 400 }}>
          <Select
            label={t(isHi, 'Select Class', 'कक्षा चुनें')}
            value={selectedClassId}
            onChange={setSelectedClassId}
            options={classSelectOptions}
            disabled={classOptionsLoading}
          />
        </div>

        {/* No selection */}
        {!selectedClassId && !classLoading && (
          <div style={{ marginTop: 24 }}>
            <EmptyState
              icon="---"
              title={t(isHi, 'Select a class to view performance', 'प्रदर्शन देखने के लिए कक्षा चुनें')}
              description={t(isHi, 'Choose a class from the dropdown above.', 'ऊपर ड्रॉपडाउन से कक्षा चुनें।')}
            />
          </div>
        )}

        {/* Loading */}
        {classLoading && (
          <div style={{ marginTop: 20 }}>
            <StatCardsSkeleton />
            <div style={{ marginTop: 16 }}><TableSkeleton rows={5} /></div>
          </div>
        )}

        {/* Error */}
        {classError && !classLoading && (
          <div style={{ marginTop: 20 }}>
            <Card className="text-center py-6">
              <p style={{ color: DANGER_COLOR, fontSize: 14, marginBottom: 12 }}>{classError}</p>
              <Button variant="primary" onClick={() => selectedClassId && loadClassPerformance(selectedClassId)}>
                {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
              </Button>
            </Card>
          </div>
        )}

        {/* Loaded data */}
        {classData && !classLoading && !classError && (
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <ReportStatCard
                value={`${Math.round(classData.class_avg_score)}%`}
                label={t(isHi, 'Class Avg Score', 'कक्षा औसत स्कोर')}
                color={scoreColor(classData.class_avg_score)}
              />
              <ReportStatCard
                value={`${Math.round(classData.completion_rate)}%`}
                label={t(isHi, 'Completion Rate', 'पूर्णता दर')}
                color={scoreColor(classData.completion_rate)}
              />
            </div>

            {/* Top 5 */}
            {classData.top_students.length > 0 && (
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 8 }}>
                  {t(isHi, 'Top 5 Students', 'शीर्ष 5 छात्र')}
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {classData.top_students.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        background: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: 8,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>
                        {i + 1}. {s.name}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor(s.avg_score) }}>
                        {Math.round(s.avg_score)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bottom 5 */}
            {classData.bottom_students.length > 0 && (
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 8 }}>
                  {t(isHi, 'Bottom 5 Students', 'निचले 5 छात्र')}
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {classData.bottom_students.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        background: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: 8,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>
                        {i + 1}. {s.name}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor(s.avg_score) }}>
                        {Math.round(s.avg_score)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Subject breakdown */}
            {classData.subject_breakdown.length > 0 && (
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 8 }}>
                  {t(isHi, 'Subject Breakdown', 'विषय वार विश्लेषण')}
                </h4>
                <SortableTable
                  columns={[
                    {
                      key: 'subject',
                      label: t(isHi, 'Subject', 'विषय'),
                      render: (r: ClassSubjectBreakdown) => <span style={{ fontWeight: 600 }}>{r.subject}</span>,
                      sortValue: (r: ClassSubjectBreakdown) => r.subject,
                    },
                    {
                      key: 'avg_score',
                      label: t(isHi, 'Avg Score', 'औसत स्कोर'),
                      render: (r: ClassSubjectBreakdown) => (
                        <span style={{ fontWeight: 700, color: scoreColor(r.avg_score) }}>
                          {Math.round(r.avg_score)}%
                        </span>
                      ),
                      sortValue: (r: ClassSubjectBreakdown) => r.avg_score,
                      align: 'right' as const,
                    },
                    {
                      key: 'quiz_count',
                      label: t(isHi, 'Quizzes', 'क्विज़'),
                      render: (r: ClassSubjectBreakdown) => r.quiz_count,
                      sortValue: (r: ClassSubjectBreakdown) => r.quiz_count,
                      align: 'right' as const,
                    },
                  ]}
                  data={classData.subject_breakdown}
                  defaultSort="avg_score"
                />
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  /* ── Tab 3: Student Detail ── */
  function renderStudentDetail() {
    return (
      <>
        {/* Search */}
        <div style={{ maxWidth: 400 }}>
          <Input
            label={t(isHi, 'Search Student', 'छात्र खोजें')}
            placeholder={t(isHi, 'Type at least 2 characters...', 'कम से कम 2 अक्षर लिखें...')}
            value={studentSearchQuery}
            onChange={(e) => {
              setStudentSearchQuery(e.target.value);
              setSelectedStudentId(null);
              setStudentData(null);
            }}
            aria-label={t(isHi, 'Search student by name', 'नाम से छात्र खोजें')}
          />
        </div>

        {/* Search results dropdown */}
        {studentSearchQuery.trim().length >= 2 && studentSearchResults.length > 0 && !selectedStudentId && (
          <div
            style={{
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              marginTop: 4,
              maxWidth: 400,
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            {studentSearchResults.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSelectedStudentId(s.id);
                  setStudentSearchQuery(s.name);
                  setStudentSearchResults([]);
                }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%',
                  padding: '10px 12px',
                  border: 'none',
                  borderBottom: '1px solid #f3f4f6',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 500, color: '#111' }}>{s.name}</span>
                <Badge color="var(--color-brand-primary, #7C3AED)" size="sm">
                  {t(isHi, `Grade ${s.grade}`, `कक्षा ${s.grade}`)}
                </Badge>
              </button>
            ))}
          </div>
        )}

        {/* Search loading */}
        {studentSearchLoading && (
          <div style={{ marginTop: 8 }}>
            <Skeleton variant="rect" height={40} width={300} rounded="rounded-lg" />
          </div>
        )}

        {/* No results */}
        {studentSearchQuery.trim().length >= 2 &&
          !studentSearchLoading &&
          studentSearchResults.length === 0 &&
          !selectedStudentId && (
            <p style={{ marginTop: 8, fontSize: 13, color: '#6b7280' }}>
              {t(isHi, 'No students found.', 'कोई छात्र नहीं मिला।')}
            </p>
          )}

        {/* Student detail loading */}
        {studentLoading && (
          <div style={{ marginTop: 20 }}>
            <Skeleton variant="rect" height={120} rounded="rounded-xl" />
            <div style={{ marginTop: 16 }}>
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} variant="rect" height={20} rounded="rounded-lg" className="mb-2" />
              ))}
            </div>
          </div>
        )}

        {/* Student detail error */}
        {studentError && !studentLoading && (
          <div style={{ marginTop: 20 }}>
            <Card className="text-center py-6">
              <p style={{ color: DANGER_COLOR, fontSize: 14, marginBottom: 12 }}>{studentError}</p>
              <Button variant="primary" onClick={() => selectedStudentId && loadStudentDetail(selectedStudentId)}>
                {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
              </Button>
            </Card>
          </div>
        )}

        {/* Student detail loaded */}
        {studentData && !studentLoading && !studentError && (
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Student profile card */}
            <div
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                padding: 20,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: 16,
              }}
            >
              <div>
                <h4 style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 4 }}>
                  {studentData.student.name}
                </h4>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Badge color="var(--color-brand-primary, #7C3AED)" size="sm">
                    {t(isHi, `Grade ${studentData.student.grade}`, `कक्षा ${studentData.student.grade}`)}
                  </Badge>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>
                    {studentData.student.xp_total.toLocaleString('en-IN')} XP
                  </span>
                </div>
                {studentData.student.last_active && (
                  <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
                    {t(isHi, 'Last active:', 'अंतिम सक्रिय:')}{' '}
                    {new Date(studentData.student.last_active).toLocaleDateString(isHi ? 'hi-IN' : 'en-IN')}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-brand-secondary, #F97316)' }}>
                    {studentData.total_quizzes}
                  </span>
                  <p style={{ fontSize: 11, color: '#6b7280' }}>{t(isHi, 'Quizzes', 'क्विज़')}</p>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: 22, fontWeight: 700, color: scoreColor(studentData.avg_score) }}>
                    {Math.round(studentData.avg_score)}%
                  </span>
                  <p style={{ fontSize: 11, color: '#6b7280' }}>{t(isHi, 'Avg Score', 'औसत स्कोर')}</p>
                </div>
              </div>
            </div>

            {/* Best / weakest subjects */}
            {(studentData.best_subject || studentData.weakest_subject) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {studentData.best_subject && (
                  <div
                    style={{
                      background: `${SUCCESS_COLOR}0D`,
                      border: `1px solid ${SUCCESS_COLOR}40`,
                      borderRadius: 10,
                      padding: 14,
                    }}
                  >
                    <p style={{ fontSize: 11, fontWeight: 600, color: SUCCESS_COLOR, marginBottom: 4 }}>
                      {t(isHi, 'Best Subject', 'सबसे अच्छा विषय')}
                    </p>
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{studentData.best_subject}</p>
                  </div>
                )}
                {studentData.weakest_subject && (
                  <div
                    style={{
                      background: `${DANGER_COLOR}0D`,
                      border: `1px solid ${DANGER_COLOR}40`,
                      borderRadius: 10,
                      padding: 14,
                    }}
                  >
                    <p style={{ fontSize: 11, fontWeight: 600, color: DANGER_COLOR, marginBottom: 4 }}>
                      {t(isHi, 'Weakest Subject', 'सबसे कमज़ोर विषय')}
                    </p>
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{studentData.weakest_subject}</p>
                  </div>
                )}
              </div>
            )}

            {/* Subject score bars */}
            {studentData.subject_scores.length > 0 && (
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 10 }}>
                  {t(isHi, 'Subject Scores', 'विषय अंक')}
                </h4>
                {studentData.subject_scores.map((ss) => (
                  <ScoreBar key={ss.subject} label={ss.subject} score={ss.avg_score} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Default state — no search yet */}
        {!studentSearchQuery.trim() && !selectedStudentId && (
          <div style={{ marginTop: 24 }}>
            <EmptyState
              icon="---"
              title={t(isHi, 'Search for a student', 'छात्र खोजें')}
              description={t(isHi, 'Type a student name above to view their academic detail.', 'छात्र का शैक्षणिक विवरण देखने के लिए ऊपर नाम टाइप करें।')}
            />
          </div>
        )}
      </>
    );
  }

  /* ── Tab 4: Subject Gaps ── */
  function renderSubjectGaps() {
    const gapCols: TableColumn<SubjectGapEntry>[] = [
      {
        key: 'subject',
        label: t(isHi, 'Subject', 'विषय'),
        render: (r) => <span style={{ fontWeight: 600 }}>{r.subject}</span>,
        sortValue: (r) => r.subject,
      },
      {
        key: 'avg_score',
        label: t(isHi, 'Avg Score', 'औसत स्कोर'),
        render: (r) => (
          <span style={{ fontWeight: 700, color: scoreColor(r.avg_score) }}>
            {Math.round(r.avg_score)}%
          </span>
        ),
        sortValue: (r) => r.avg_score,
        align: 'right',
      },
      {
        key: 'quiz_count',
        label: t(isHi, 'Quizzes', 'क्विज़'),
        render: (r) => r.quiz_count,
        sortValue: (r) => r.quiz_count,
        align: 'right',
      },
      {
        key: 'status',
        label: t(isHi, 'Status', 'स्थिति'),
        render: (r) => (
          <span
            style={{
              fontWeight: 700,
              fontSize: 12,
              color: gapStatusColor(r.status),
              padding: '3px 10px',
              borderRadius: 20,
              background: `${gapStatusColor(r.status)}15`,
              display: 'inline-block',
            }}
          >
            {gapStatusLabel(r.status, isHi)}
          </span>
        ),
        sortValue: (r) => (r.status === 'critical' ? 0 : r.status === 'needs_attention' ? 1 : 2),
      },
    ];

    return (
      <>
        {/* Grade filter */}
        <div style={{ maxWidth: 300 }}>
          <Select
            label={t(isHi, 'Filter by Grade', 'कक्षा के अनुसार फ़िल्टर करें')}
            value={gapGradeFilter}
            onChange={(v) => setGapGradeFilter(v)}
            options={gradeSelectOptions}
          />
        </div>

        {/* Loading */}
        {gapsLoading && (
          <div style={{ marginTop: 16 }}>
            <TableSkeleton rows={5} />
          </div>
        )}

        {/* Error */}
        {gapsError && !gapsLoading && (
          <div style={{ marginTop: 16 }}>
            <Card className="text-center py-6">
              <p style={{ color: DANGER_COLOR, fontSize: 14, marginBottom: 12 }}>{gapsError}</p>
              <Button variant="primary" onClick={() => loadSubjectGaps(gapGradeFilter)}>
                {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
              </Button>
            </Card>
          </div>
        )}

        {/* Data */}
        {gapsData && !gapsLoading && !gapsError && (
          <div style={{ marginTop: 16 }}>
            {gapsData.gaps.length > 0 ? (
              <SortableTable columns={gapCols} data={gapsData.gaps} defaultSort="status" defaultDir="asc" />
            ) : (
              <EmptyState
                icon="---"
                title={t(isHi, 'No subject data available', 'कोई विषय डेटा उपलब्ध नहीं')}
                description={t(isHi, 'Data will appear once students start taking quizzes.', 'छात्रों के क्विज़ देने पर डेटा दिखेगा।')}
              />
            )}
          </div>
        )}
      </>
    );
  }

  /* ─────────────────────────────────────────────────────────────
     RENDER
  ───────────────────────────────────────────────────────────── */
  return (
    <div style={{ minHeight: '100%' }}>
      {/* Page title */}
      <h1
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: '#111',
          fontFamily: 'Sora, system-ui, sans-serif',
          marginBottom: 20,
        }}
      >
        {t(isHi, 'Academic Reports', 'शैक्षणिक रिपोर्ट')}
      </h1>

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label={t(isHi, 'Report tabs', 'रिपोर्ट टैब')}
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '2px solid #e5e7eb',
          marginBottom: 24,
          overflowX: 'auto',
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? 'var(--color-brand-primary, #7C3AED)' : '#6b7280',
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--color-brand-primary, #7C3AED)' : '2px solid transparent',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                marginBottom: -2,
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              {t(isHi, tab.labelEn, tab.labelHi)}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div
        role="tabpanel"
        aria-label={t(isHi,
          TABS.find((tb) => tb.key === activeTab)?.labelEn || '',
          TABS.find((tb) => tb.key === activeTab)?.labelHi || ''
        )}
      >
        {activeTab === 'school_overview' && renderOverview()}
        {activeTab === 'class_performance' && renderClassPerformance()}
        {activeTab === 'student_detail' && renderStudentDetail()}
        {activeTab === 'subject_gaps' && renderSubjectGaps()}
      </div>
    </div>
  );
}
