'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { authedFetch } from '@alfanumrik/lib/school-admin/authed-fetch';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useSchoolAdminAuth } from '@alfanumrik/ui/school-admin/use-school-admin-auth';
import SchoolAdminPageHeader from '../_components/SchoolAdminPageHeader';
import {
  Card,
  Button,
  Input,
  Select,
  Badge,
  Skeleton,
  EmptyState,
} from '@alfanumrik/ui/ui';
// Phase 2 (Task 2.5) — the canonical elevated-variant Card primitive, distinct
// from the legacy `Card` above (no `variant` prop) already used for this
// page's error-state callouts. Aliased to avoid a naming collision.
import { Card as ElevatedCard } from '@alfanumrik/ui/ui/primitives';
import {
  StatCard,
  StatusBadge,
  ScoreBar,
  DataTable,
  type Column,
  type StatusBadgeVariant,
} from '@alfanumrik/ui/admin-ui';
import { LineChart, BarChart, type ChartSeries } from '@alfanumrik/ui/admin-ui/charts';

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

interface ScoreTrendPoint {
  /** YYYY-MM-DD */
  date: string;
  avg_score: number;
}

interface SchoolOverviewData {
  total_quizzes: number;
  avg_score: number;
  active_students: number;
  completion_rate: number;
  subject_performance: SubjectPerformance[];
  grade_performance: GradePerformance[];
  /** Phase 2 Task 2.2 — additive, optional (older API responses may omit it). */
  score_trend?: ScoreTrendPoint[];
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
   STYLE HELPERS (P10.1.3 — token-driven; StatusBadge owns the actual color)
───────────────────────────────────────────────────────────── */
/** Score → severity variant. Same 80/50 thresholds the page always used. */
function scoreVariant(score: number): StatusBadgeVariant {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'danger';
}

function gapStatusLabel(status: string, isHi: boolean): string {
  if (status === 'critical') return t(isHi, 'Critical', 'गंभीर');
  if (status === 'needs_attention') return t(isHi, 'Needs Attention', 'ध्यान आवश्यक');
  return t(isHi, 'Good', 'अच्छा');
}

function gapStatusVariant(status: string): StatusBadgeVariant {
  if (status === 'critical') return 'danger';
  if (status === 'needs_attention') return 'warning';
  return 'success';
}

/** StatusBadgeVariant → CSS token, for chart bar colour-banding (Task 2.3).
 *  Single source so the BarChart's per-bar fill and the StatusBadge pill
 *  always agree on the same severity → colour mapping. */
function variantColor(variant: StatusBadgeVariant): string {
  return `var(--${variant})`;
}

/** Numeric rank so gap severity can be sorted in the intended order
 *  (critical → needs_attention → good) rather than alphabetically. */
function gapStatusRank(status: string): number {
  return status === 'critical' ? 0 : status === 'needs_attention' ? 1 : 2;
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
   MAIN PAGE
───────────────────────────────────────────────────────────── */
export default function SchoolAdminReportsPage() {
  const { schoolId, isLoading: loadingAdmin } = useSchoolAdminAuth();
  const { isHi } = useAuth();

  /* ── Tab state ── */
  const [activeTab, setActiveTab] = useState<ReportTab>('school_overview');

  /* ── Data state for each tab ── */
  const [overviewData, setOverviewData] = useState<SchoolOverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [classOptionsLoading, setClassOptionsLoading] = useState(false);
  // Dropdown-specific error. The /api/school-admin/classes route is gated by the
  // `class.manage` permission, so a reports-only admin can get a 403; surfacing
  // that (instead of an inscrutable empty dropdown) is the point of this state.
  const [classOptionsError, setClassOptionsError] = useState<string | null>(null);
  // Distinguishes "loaded OK, zero classes" (empty hint) from "never loaded"
  // (no notice yet) so the empty hint only shows after a successful fetch.
  const [classOptionsLoaded, setClassOptionsLoaded] = useState(false);
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
     REPORT API HELPER — routed through authedFetch (Task 1.5): forwards the
     Bearer token itself, so callers no longer manage getToken()/headers.
  ───────────────────────────────────────────────────────────── */
  const fetchReport = useCallback(async (type: string, params: Record<string, string> = {}): Promise<any> => {
    const qs = new URLSearchParams({ type, ...params });
    const res = await authedFetch(`/api/school-admin/reports?${qs.toString()}`);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }

    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  }, []);

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
    setClassOptionsLoading(true);
    setClassOptionsError(null);
    try {
      const res = await authedFetch('/api/school-admin/classes');
      if (!res.ok) {
        // 403 (reports-only admin lacks class.manage) / 500 etc. — surface it
        // instead of silently leaving the dropdown empty.
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const json = await res.json();
      setClassOptions((json.data ?? json) as ClassOption[]);
      setClassOptionsLoaded(true);
    } catch (err: any) {
      setClassOptionsError(
        err?.message || t(isHi, "Couldn't load classes", 'कक्षाएं लोड नहीं हो सकीं')
      );
    } finally {
      setClassOptionsLoading(false);
    }
  }, [isHi]);

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
      const qs = new URLSearchParams({ type: 'student_search', query: query.trim() });
      const res = await authedFetch(`/api/school-admin/reports?${qs.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setStudentSearchResults((json.data ?? []) as StudentSearchResult[]);
      }
    } catch {
      // Search failure is non-critical; silently show empty results
    } finally {
      setStudentSearchLoading(false);
    }
  }, [schoolId]);

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
    if (
      activeTab === 'class_performance' &&
      classOptions.length === 0 &&
      !classOptionsLoading &&
      !classOptionsLoaded &&
      !classOptionsError
    ) {
      loadClassOptions();
    }
    if (activeTab === 'subject_gaps' && !gapsData && !gapsLoading) {
      loadSubjectGaps(gapGradeFilter);
    }
  }, [
    schoolId, activeTab,
    overviewData, overviewLoading, loadOverview,
    classOptions.length, classOptionsLoading, classOptionsLoaded, classOptionsError, loadClassOptions,
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
  if (loadingAdmin) {
    return (
      <div className="space-y-4">
        <div style={{ display: 'flex', gap: 8 }}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} variant="rect" height={38} width={140} rounded="rounded-lg" />
          ))}
        </div>
        <StatCardsSkeleton />
        <TableSkeleton />
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
          <p className="text-danger text-sm mb-3">{overviewError}</p>
          <Button variant="primary" onClick={loadOverview}>
            {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </Button>
        </Card>
      );
    }

    if (!overviewData) return null;

    const { total_quizzes, avg_score, active_students, completion_rate, subject_performance, grade_performance } = overviewData;

    const subjectCols: Column<SubjectPerformance & Record<string, unknown>>[] = [
      {
        key: 'subject',
        label: t(isHi, 'Subject', 'विषय'),
        render: (r) => <span className="font-semibold">{r.subject}</span>,
      },
      {
        key: 'quiz_count',
        label: t(isHi, 'Quizzes', 'क्विज़'),
      },
      {
        key: 'avg_score',
        label: t(isHi, 'Avg Score', 'औसत स्कोर'),
        render: (r) => <StatusBadge label={`${Math.round(r.avg_score)}%`} variant={scoreVariant(r.avg_score)} />,
      },
      {
        key: 'student_count',
        label: t(isHi, 'Students', 'छात्र'),
      },
    ];

    const gradeCols: Column<GradePerformance & Record<string, unknown>>[] = [
      {
        key: 'grade',
        label: t(isHi, 'Grade', 'कक्षा'),
        render: (r) => (
          <Badge color="var(--color-brand-primary, #7C3AED)" size="sm">
            {t(isHi, `Grade ${r.grade}`, `कक्षा ${r.grade}`)}
          </Badge>
        ),
      },
      {
        key: 'student_count',
        label: t(isHi, 'Students', 'छात्र'),
      },
      {
        key: 'avg_score',
        label: t(isHi, 'Avg Score', 'औसत स्कोर'),
        render: (r) => <StatusBadge label={`${Math.round(r.avg_score)}%`} variant={scoreVariant(r.avg_score)} />,
      },
      {
        key: 'quiz_count',
        label: t(isHi, 'Quizzes', 'क्विज़'),
      },
    ];

    const trendSeries: ChartSeries[] = [
      {
        name: t(isHi, 'Avg score %', 'औसत स्कोर %'),
        data: (overviewData.score_trend ?? []).map((p) => ({ x: p.date, y: p.avg_score })),
      },
    ];

    const subjectBarSeries: ChartSeries[] = [
      {
        name: t(isHi, 'Avg score %', 'औसत स्कोर %'),
        data: subject_performance.map((s) => ({ x: s.subject, y: s.avg_score })),
      },
    ];

    const gradeBarSeries: ChartSeries[] = [
      {
        name: t(isHi, 'Avg score %', 'औसत स्कोर %'),
        data: grade_performance.map((g) => ({
          x: t(isHi, `Grade ${g.grade}`, `कक्षा ${g.grade}`),
          y: g.avg_score,
        })),
      },
    ];

    return (
      <>
        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <StatCard
            value={total_quizzes.toLocaleString('en-IN')}
            label={t(isHi, 'Total Quizzes', 'कुल क्विज़')}
            accentColor="var(--color-brand-primary, #7C3AED)"
          />
          <StatCard
            value={`${Math.round(avg_score)}%`}
            label={t(isHi, 'Avg Score', 'औसत स्कोर')}
            accentColor={`var(--${scoreVariant(avg_score)})`}
          />
          <StatCard
            value={active_students.toLocaleString('en-IN')}
            label={t(isHi, 'Active Students', 'सक्रिय छात्र')}
            accentColor="var(--color-brand-secondary, #E8581C)"
          />
          <StatCard
            value={`${Math.round(completion_rate)}%`}
            label={t(isHi, 'Completion Rate', 'पूर्णता दर')}
            accentColor={`var(--${scoreVariant(completion_rate)})`}
          />
        </div>

        {/* Score trend line (Task 2.2) */}
        <ElevatedCard variant="elevated" className="p-4" style={{ marginTop: 24 }}>
          <h3 className="text-sm font-bold text-foreground mb-2.5">
            {t(isHi, 'Score Trend', 'स्कोर प्रवृत्ति')}
          </h3>
          <LineChart
            series={trendSeries}
            yLabel={t(isHi, 'Avg score %', 'औसत स्कोर %')}
            height={220}
            emptyLabel={t(isHi, 'No score trend data yet', 'अभी कोई स्कोर प्रवृत्ति डेटा नहीं')}
          />
        </ElevatedCard>

        {/* Subject performance bar + table */}
        <div style={{ marginTop: 24 }}>
          <h3 className="text-sm font-bold text-foreground mb-2.5">
            {t(isHi, 'Subject Performance', 'विषय प्रदर्शन')}
          </h3>
          {subject_performance.length > 0 ? (
            <>
              <ElevatedCard variant="elevated" className="p-4 mb-3">
                <BarChart
                  series={subjectBarSeries}
                  yLabel={t(isHi, 'Avg score %', 'औसत स्कोर %')}
                  height={220}
                  emptyLabel={t(isHi, 'No subject data yet', 'अभी कोई विषय डेटा नहीं')}
                />
              </ElevatedCard>
              <DataTable
                columns={subjectCols}
                data={subject_performance as (SubjectPerformance & Record<string, unknown>)[]}
                keyField="subject"
              />
            </>
          ) : (
            <EmptyState
              icon="---"
              title={t(isHi, 'No subject data yet', 'अभी कोई विषय डेटा नहीं')}
              description={t(isHi, 'Data will appear as students take quizzes.', 'छात्रों के क्विज़ देने पर डेटा दिखेगा।')}
            />
          )}
        </div>

        {/* Grade performance bar + table */}
        <div style={{ marginTop: 24 }}>
          <h3 className="text-sm font-bold text-foreground mb-2.5">
            {t(isHi, 'Grade Performance', 'कक्षा प्रदर्शन')}
          </h3>
          {grade_performance.length > 0 ? (
            <>
              <ElevatedCard variant="elevated" className="p-4 mb-3">
                <BarChart
                  series={gradeBarSeries}
                  yLabel={t(isHi, 'Avg score %', 'औसत स्कोर %')}
                  height={220}
                  emptyLabel={t(isHi, 'No grade data yet', 'अभी कोई कक्षा डेटा नहीं')}
                />
              </ElevatedCard>
              <DataTable
                columns={gradeCols}
                data={grade_performance as (GradePerformance & Record<string, unknown>)[]}
                keyField="grade"
              />
            </>
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
    const breakdownCols: Column<ClassSubjectBreakdown & Record<string, unknown>>[] = [
      {
        key: 'subject',
        label: t(isHi, 'Subject', 'विषय'),
        render: (r) => <span className="font-semibold">{r.subject}</span>,
      },
      {
        key: 'avg_score',
        label: t(isHi, 'Avg Score', 'औसत स्कोर'),
        render: (r) => <StatusBadge label={`${Math.round(r.avg_score)}%`} variant={scoreVariant(r.avg_score)} />,
      },
      {
        key: 'quiz_count',
        label: t(isHi, 'Quizzes', 'क्विज़'),
      },
    ];

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

          {/* Dropdown load error (e.g. 403 for a reports-only admin, or 500).
              Surfaced inline with a Retry instead of silently swallowing. */}
          {classOptionsError && !classOptionsLoading && (
            <div
              role="alert"
              className="mt-2 flex items-center gap-2.5 flex-wrap rounded-lg px-3 py-2"
              style={{
                background: 'color-mix(in srgb, var(--danger) 5%, transparent)',
                border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)',
              }}
            >
              <span className="text-xs text-danger flex-1" style={{ minWidth: 160 }}>
                {t(isHi, "Couldn't load classes.", 'कक्षाएं लोड नहीं हो सकीं।')}
              </span>
              <button
                type="button"
                onClick={loadClassOptions}
                className="text-xs font-bold text-danger bg-transparent rounded-md px-3 cursor-pointer"
                style={{ border: '1px solid var(--danger)', minHeight: 28 }}
              >
                {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
              </button>
            </div>
          )}

          {/* Genuine empty: loaded OK but the school has no classes yet.
              Distinct from the error case above. */}
          {!classOptionsError &&
            !classOptionsLoading &&
            classOptionsLoaded &&
            classOptions.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t(isHi, 'No classes found for this school yet.', 'इस स्कूल के लिए अभी कोई कक्षा नहीं मिली।')}
              </p>
            )}
        </div>

        {/* No selection — hidden when the dropdown failed to load (error notice
            shown instead) or when the school genuinely has no classes (empty
            hint shown instead), so we never stack two prompts. */}
        {!selectedClassId &&
          !classLoading &&
          !classOptionsError &&
          !(classOptionsLoaded && classOptions.length === 0) && (
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
              <p className="text-danger text-sm mb-3">{classError}</p>
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
              <StatCard
                value={`${Math.round(classData.class_avg_score)}%`}
                label={t(isHi, 'Class Avg Score', 'कक्षा औसत स्कोर')}
                accentColor={`var(--${scoreVariant(classData.class_avg_score)})`}
              />
              <StatCard
                value={`${Math.round(classData.completion_rate)}%`}
                label={t(isHi, 'Completion Rate', 'पूर्णता दर')}
                accentColor={`var(--${scoreVariant(classData.completion_rate)})`}
              />
            </div>

            {/* Top 5 */}
            {classData.top_students.length > 0 && (
              <div>
                <h4 className="text-[13px] font-bold text-foreground mb-2">
                  {t(isHi, 'Top 5 Students', 'शीर्ष 5 छात्र')}
                </h4>
                <div className="flex flex-col gap-1.5">
                  {classData.top_students.map((s, i) => (
                    <div
                      key={i}
                      className="flex justify-between items-center px-3 py-2 bg-surface-1 border border-surface-3 rounded-lg"
                    >
                      <span className="text-[13px] font-medium text-foreground">
                        {i + 1}. {s.name}
                      </span>
                      <StatusBadge label={`${Math.round(s.avg_score)}%`} variant={scoreVariant(s.avg_score)} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bottom 5 */}
            {classData.bottom_students.length > 0 && (
              <div>
                <h4 className="text-[13px] font-bold text-foreground mb-2">
                  {t(isHi, 'Bottom 5 Students', 'निचले 5 छात्र')}
                </h4>
                <div className="flex flex-col gap-1.5">
                  {classData.bottom_students.map((s, i) => (
                    <div
                      key={i}
                      className="flex justify-between items-center px-3 py-2 bg-surface-1 border border-surface-3 rounded-lg"
                    >
                      <span className="text-[13px] font-medium text-foreground">
                        {i + 1}. {s.name}
                      </span>
                      <StatusBadge label={`${Math.round(s.avg_score)}%`} variant={scoreVariant(s.avg_score)} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Subject breakdown bar + table (Task 2.3) */}
            {classData.subject_breakdown.length > 0 && (
              <div>
                <h4 className="text-[13px] font-bold text-foreground mb-2">
                  {t(isHi, 'Subject Breakdown', 'विषय वार विश्लेषण')}
                </h4>
                <ElevatedCard variant="elevated" className="p-4 mb-3">
                  <BarChart
                    series={[
                      {
                        name: t(isHi, 'Avg score %', 'औसत स्कोर %'),
                        data: classData.subject_breakdown.map((s) => ({ x: s.subject, y: s.avg_score })),
                      },
                    ]}
                    yLabel={t(isHi, 'Avg score %', 'औसत स्कोर %')}
                    height={220}
                    emptyLabel={t(isHi, 'No subject data yet', 'अभी कोई विषय डेटा नहीं')}
                  />
                </ElevatedCard>
                <DataTable
                  columns={breakdownCols}
                  data={classData.subject_breakdown as (ClassSubjectBreakdown & Record<string, unknown>)[]}
                  keyField="subject"
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
            className="bg-surface-1 border border-surface-3 rounded-lg mt-1 overflow-y-auto"
            style={{ maxWidth: 400, maxHeight: 240 }}
          >
            {studentSearchResults.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSelectedStudentId(s.id);
                  setStudentSearchQuery(s.name);
                  setStudentSearchResults([]);
                }}
                className="flex justify-between items-center w-full px-3 py-2.5 border-0 border-b border-surface-3 bg-transparent cursor-pointer text-left text-[13px]"
              >
                <span className="font-medium text-foreground">{s.name}</span>
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
            <p className="mt-2 text-[13px] text-muted-foreground">
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
              <p className="text-danger text-sm mb-3">{studentError}</p>
              <Button variant="primary" onClick={() => selectedStudentId && loadStudentDetail(selectedStudentId)}>
                {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
              </Button>
            </Card>
          </div>
        )}

        {/* Student detail loaded */}
        {studentData && !studentLoading && !studentError && (
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Student profile card (Task 2.5 — canonical Card primitive) */}
            <ElevatedCard variant="elevated" className="p-5 flex justify-between items-start flex-wrap gap-4">
              <div>
                <h4 className="text-base font-bold text-foreground mb-1">
                  {studentData.student.name}
                </h4>
                <div className="flex gap-2 flex-wrap items-center">
                  <Badge color="var(--color-brand-primary, #7C3AED)" size="sm">
                    {t(isHi, `Grade ${studentData.student.grade}`, `कक्षा ${studentData.student.grade}`)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {studentData.student.xp_total.toLocaleString('en-IN')} XP
                  </span>
                </div>
                {studentData.student.last_active && (
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {t(isHi, 'Last active:', 'अंतिम सक्रिय:')}{' '}
                    {new Date(studentData.student.last_active).toLocaleDateString(isHi ? 'hi-IN' : 'en-IN')}
                  </p>
                )}
              </div>
              <div className="flex gap-4 flex-wrap">
                <div className="text-center">
                  <span className="text-[22px] font-bold" style={{ color: 'var(--color-brand-secondary, #E8581C)' }}>
                    {studentData.total_quizzes}
                  </span>
                  <p className="text-[11px] text-muted-foreground">{t(isHi, 'Quizzes', 'क्विज़')}</p>
                </div>
                <div className="text-center">
                  <StatusBadge
                    label={`${Math.round(studentData.avg_score)}%`}
                    variant={scoreVariant(studentData.avg_score)}
                  />
                  <p className="text-[11px] text-muted-foreground mt-0.5">{t(isHi, 'Avg Score', 'औसत स्कोर')}</p>
                </div>
              </div>
            </ElevatedCard>

            {/* Subject score bars (Task 1.4/2.4). Best/weakest is now a caption
                UNDER the chart rather than two separate colored callout boxes
                — same data (studentData.best_subject/weakest_subject), single
                visual, no duplicate severity vocabulary. */}
            {studentData.subject_scores.length > 0 && (
              <div>
                <h4 className="text-[13px] font-bold text-foreground mb-2.5">
                  {t(isHi, 'Subject Scores', 'विषय अंक')}
                </h4>
                <div className="flex flex-col gap-2">
                  {studentData.subject_scores.map((ss) => (
                    <div key={ss.subject} className="flex items-center gap-2.5">
                      <span className="text-xs font-medium text-foreground" style={{ minWidth: 100, textAlign: 'right' }}>
                        {ss.subject}
                      </span>
                      <ScoreBar score={ss.avg_score} label={ss.subject} width={160} />
                    </div>
                  ))}
                </div>
                {(studentData.best_subject || studentData.weakest_subject) && (
                  <p className="text-[11px] text-muted-foreground mt-2.5">
                    {studentData.best_subject && (
                      <>
                        {t(isHi, 'Best: ', 'सबसे अच्छा: ')}
                        <span className="font-semibold text-success">{studentData.best_subject}</span>
                      </>
                    )}
                    {studentData.best_subject && studentData.weakest_subject && '  ·  '}
                    {studentData.weakest_subject && (
                      <>
                        {t(isHi, 'Weakest: ', 'सबसे कमज़ोर: ')}
                        <span className="font-semibold text-danger">{studentData.weakest_subject}</span>
                      </>
                    )}
                  </p>
                )}
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
    const gapCols: Column<SubjectGapEntry & { status_rank: number } & Record<string, unknown>>[] = [
      {
        key: 'subject',
        label: t(isHi, 'Subject', 'विषय'),
        render: (r) => <span className="font-semibold">{r.subject}</span>,
      },
      {
        key: 'avg_score',
        label: t(isHi, 'Avg Score', 'औसत स्कोर'),
        render: (r) => <StatusBadge label={`${Math.round(r.avg_score)}%`} variant={scoreVariant(r.avg_score)} />,
      },
      {
        key: 'quiz_count',
        label: t(isHi, 'Quizzes', 'क्विज़'),
      },
      {
        // Sorts on the numeric severity rank (critical → needs_attention →
        // good) rather than the alphabetical `status` string; render still
        // shows the bilingual label via a StatusBadge (Task 1.3).
        key: 'status_rank',
        label: t(isHi, 'Status', 'स्थिति'),
        render: (r) => <StatusBadge label={gapStatusLabel(r.status, isHi)} variant={gapStatusVariant(r.status)} />,
      },
    ];

    const gapsRows = (gapsData?.gaps ?? []).map((g) => ({ ...g, status_rank: gapStatusRank(g.status) }));

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
              <p className="text-danger text-sm mb-3">{gapsError}</p>
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
              <>
                {/* Severity-banded bar (Task 2.3) — SAME critical/needs_attention/
                    good → danger/warning/success mapping as the StatusBadge
                    column below (gapStatusVariant), via the shared variantColor
                    helper. One consistent severity vocabulary across chart + table. */}
                <ElevatedCard variant="elevated" className="p-4 mb-3">
                  <BarChart
                    series={[
                      {
                        name: t(isHi, 'Avg score %', 'औसत स्कोर %'),
                        data: gapsData.gaps.map((g) => ({ x: g.subject, y: g.avg_score })),
                      },
                    ]}
                    yLabel={t(isHi, 'Avg score %', 'औसत स्कोर %')}
                    height={220}
                    emptyLabel={t(isHi, 'No subject data available', 'कोई विषय डेटा उपलब्ध नहीं')}
                    pointColor={(point) => {
                      const gap = gapsData.gaps.find((g) => g.subject === point.x);
                      return gap ? variantColor(gapStatusVariant(gap.status)) : undefined;
                    }}
                  />
                </ElevatedCard>
                <DataTable columns={gapCols} data={gapsRows} keyField="subject" />
              </>
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
    <>
      <SchoolAdminPageHeader
        title="Academic Reports"
        titleHi="शैक्षणिक रिपोर्ट"
        isHi={isHi}
      />

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label={t(isHi, 'Report tabs', 'रिपोर्ट टैब')}
        className="flex gap-1 border-b-2 border-surface-3 mb-6 overflow-x-auto"
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.key)}
              className="px-4 py-2.5 text-[13px] whitespace-nowrap transition-colors"
              style={{
                fontWeight: isActive ? 700 : 500,
                color: isActive ? 'var(--color-brand-primary, #7C3AED)' : 'var(--text-3)',
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--color-brand-primary, #7C3AED)' : '2px solid transparent',
                marginBottom: -2,
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
    </>
  );
}
