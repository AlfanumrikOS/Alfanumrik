'use client';

/**
 * /reports — monthly report.
 *
 * HONESTY CONTRACT (Phase 6 / Risk R4, acceptance criterion 8: "Never fill
 * missing backend data with fabricated metrics"). This page previously
 * manufactured five numbers it had no source for:
 *
 *  1. A synthetic exam blueprint — `chapterNumber` was an array index,
 *     `chapterTitle` was actually the SUBJECT, every chapter got
 *     `marksWeightage: 10` / `difficultyWeight: 1`, and `totalMarks: 80` was
 *     hardcoded for every subject and every grade — fed into
 *     `predictExamScore()` and rendered as "Predicted Score / 80". A board-mark
 *     forecast computed in the browser from invented inputs. REMOVED: the
 *     Exam Readiness block now renders only when a real blueprint exists, and
 *     its denominator comes from that blueprint, never a literal.
 *  2. `weeklyAccuracies.push(0)` for weeks with no quizzes → a 0% bar for a
 *     week the student didn't study, visually identical to scoring zero. FIXED:
 *     an unstudied week is `null` and renders an explicit "no quizzes" marker.
 *  3. `retentionScore` (avg of the last 5 quiz scores) shown as "7-Day
 *     Retention". RELABELLED to what it actually is.
 *  4. Chips headed "Strong/Weak Chapters" listing SUBJECTS — off a query that
 *     selected `topic`, a column `bloom_progression` does not have, so the
 *     request errored, the error was discarded, and a confident 0% Concept
 *     Mastery dial rendered in its place. FIXED: query `subject`, label them
 *     subjects, and surface the failure instead of swallowing it.
 *  5. English-only insight sentences under bilingual headings (P7 violation).
 *     The engine now returns codes; the words live here, in both languages.
 *
 * Plus: `generate_monthly_report()` writes `report_data = {generated_at,
 * month}` (the metrics live in sibling COLUMNS). Casting that straight to
 * `MonthlyReportData` produced NaN dials and crashed on
 * `strongChapters.length`. The stored payload is now validated before use.
 *
 * States: loading · loaded · empty · insufficient-evidence (per metric,
 * distinct from empty) · error+retry.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import {
  computeMonthlyReportMetrics,
  type MonthlyReportData,
  type ReportInsight,
} from '@alfanumrik/lib/cognitive-engine';
import { REPORT_MONTHS_COUNT } from '@alfanumrik/lib/constants';
import { Card, Button, ProgressBar, SectionHeader, StatCard, LoadingFoxy } from '@alfanumrik/ui/ui';

/* ── DB Row Types ── */
interface QuizRow {
  score_percent?: number;
  completed_at?: string;
  subject?: string;
  total_questions?: number;
  time_taken_seconds?: number;
}

interface ProfileRow {
  total_time_minutes?: number;
  total_questions_asked?: number;
  total_questions_answered_correctly?: number;
}

/** `bloom_progression` columns actually used here. There is NO `topic` column
 *  on this table — selecting one made PostgREST return 42703 and the page then
 *  rendered zeros. Only `subject` + the three mastery columns are real. */
interface MasteryRow {
  subject?: string;
  remember_mastery?: number;
  understand_mastery?: number;
  apply_mastery?: number;
}

/* ── Helpers ── */
function getLastNMonths(n: number): { label: string; value: string; start: string; end: string }[] {
  const months: { label: string; value: string; start: string; end: string }[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth();
    const label = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    const value = `${year}-${String(month + 1).padStart(2, '0')}`;
    const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endDate = new Date(year, month + 1, 0);
    const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    months.push({ label, value, start, end });
  }
  return months;
}

/* ── Insight copy (P7) ──
 * The cognitive engine returns CODES; the sentences live here so the same
 * insight can be spoken in both languages. `areas` are subject codes supplied
 * by the caller and are printed verbatim (they are already the user's own
 * subject labels), never translated. */
function insightText(insight: ReportInsight, isHi: boolean): string {
  const areas = (insight.areas ?? []).join(', ');
  switch (insight.code) {
    case 'focus_weak_areas':
      return isHi ? `इन विषयों पर ध्यान दो: ${areas}` : `Focus on these subjects: ${areas}`;
    case 'increase_consistency':
      return isHi ? 'रोज़ थोड़ा-थोड़ा पढ़ने की आदत बनाओ' : 'Study a little more regularly';
    case 'work_on_speed':
      return isHi ? 'गति और सटीकता पर काम करो' : 'Work on speed and accuracy';
    case 'high_overall_mastery':
      return isHi ? 'कुल मिलाकर बढ़िया महारत' : 'High overall mastery';
    case 'consistent_study_habit':
      return isHi ? 'नियमित पढ़ाई की आदत' : 'Consistent study habit';
    case 'multiple_areas_mastered':
      return isHi ? `कई विषयों में महारत: ${areas}` : `Multiple subjects mastered: ${areas}`;
    default:
      return '';
  }
}

/* ── Insufficient evidence ──
 * DISTINCT from "empty" (the student did nothing) and from "error" (the fetch
 * failed). This says: the fetch worked, the student is active, but this
 * particular metric has nothing reliable behind it yet. It asserts no number. */
function NotEnoughData({ isHi, what, whatHi, testId }: {
  isHi: boolean; what: string; whatHi: string; testId?: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="rounded-xl px-3 py-3 text-center"
      style={{ background: 'var(--surface-2)' }}
    >
      <div className="text-xs font-semibold text-[var(--text-2)]">
        {isHi ? 'अभी पर्याप्त डेटा नहीं' : 'Not enough data yet'}
      </div>
      <div className="text-[11px] text-[var(--text-3)] mt-0.5 leading-relaxed">
        {isHi ? whatHi : what}
      </div>
    </div>
  );
}

/* ── Honest failure + retry ──
 * Same voice as SubjectsUnavailable / the /progress DataErrorCard: it rules out
 * the wrong reading ("this doesn't mean you scored zero") and offers a real
 * 44x44 recovery control. role="alert" — something IS wrong (WCAG 4.1.3). */
function ReportLoadError({ isHi, onRetry, testId }: { isHi: boolean; onRetry: () => void; testId: string }) {
  return (
    <Card className="!p-4 text-center">
      <div role="alert" data-testid={testId}>
        <div className="text-2xl mb-1" aria-hidden="true">📡</div>
        <div className="text-sm font-semibold text-[var(--text-2)] mb-1">
          {isHi ? 'यह रिपोर्ट लोड नहीं हो सकी' : "Couldn't load this report"}
        </div>
        <p className="text-xs text-[var(--text-3)] mb-3 max-w-xs mx-auto leading-relaxed">
          {isHi
            ? 'इसका मतलब यह नहीं कि तुम्हारे अंक शून्य हैं — सिर्फ़ connection टूटा है। फिर से कोशिश करो।'
            : "This doesn't mean you scored zero — only the connection failed. Please try again."}
        </p>
        <Button
          variant="soft"
          size="sm"
          color="var(--accent-warm)"
          onClick={onRetry}
          className="inline-flex items-center justify-center gap-1 min-h-[44px] min-w-[44px]"
        >
          🔄 {isHi ? 'फिर से कोशिश करो' : 'Retry'}
        </Button>
      </div>
    </Card>
  );
}

/* ── Stored-report validation ──
 * `monthly_reports.report_data` is NOT guaranteed to hold metrics:
 * `generate_monthly_report()` writes only `{generated_at, month}` there and
 * puts the numbers in sibling columns. The old code cast the blob straight to
 * `MonthlyReportData`, which rendered `NaN%` dials and threw on
 * `strongChapters.length`. Accept a stored payload only when it actually
 * carries this shape; otherwise fall through and compute from raw rows. */
function parseStoredReport(raw: unknown): MonthlyReportData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const numOrNull = (v: unknown) => v === null || typeof v === 'number';
  const ok =
    'recentQuizAveragePct' in r && numOrNull(r.recentQuizAveragePct) &&
    'conceptMasteryPct' in r && numOrNull(r.conceptMasteryPct) &&
    Array.isArray(r.accuracyTrend) &&
    Array.isArray(r.weakAreas) && Array.isArray(r.strongAreas) &&
    Array.isArray(r.improvements) && Array.isArray(r.achievements);
  return ok ? (raw as MonthlyReportData) : null;
}

/* ── Circular Progress ── */
function CircularProgress({ value, size = 80, color = 'var(--orange)', label }: {
  value: number; size?: number; color?: string; label?: string;
}) {
  const pct = Math.min(100, Math.max(0, value));
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-2)" strokeWidth={6} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
        <text
          x={size / 2} y={size / 2}
          textAnchor="middle" dominantBaseline="central"
          fill="var(--text-1)" fontSize={size * 0.22} fontWeight={700}
          transform={`rotate(90, ${size / 2}, ${size / 2})`}
        >
          {Math.round(pct)}%
        </text>
      </svg>
      {label && <span className="text-[10px] text-[var(--text-3)] font-medium">{label}</span>}
    </div>
  );
}

/* ── Horizontal Bar ── */
function HBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-[11px] text-[var(--text-3)] w-24 truncate shrink-0">{label}</span>
      <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: 'width 0.4s ease' }} />
      </div>
      <span className="text-[11px] font-semibold w-10 text-right" style={{ color }}>{Math.round(value)}%</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MONTHLY REPORTS PAGE
   ═══════════════════════════════════════════════════════════════ */

export default function MonthlyReportsPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();

  const months = useMemo(() => getLastNMonths(REPORT_MONTHS_COUNT), []);
  const [selectedMonth, setSelectedMonth] = useState(months[0]?.value ?? '');
  const [reportData, setReportData] = useState<MonthlyReportData | null>(null);
  const [quizScores, setQuizScores] = useState<Array<{ label: string; score: number }>>([]);
  const [daysActive, setDaysActive] = useState(0);
  const [daysTotal, setDaysTotal] = useState(30);
  const [loading, setLoading] = useState(false);
  /* Two INDEPENDENT failure lanes, so one broken source can never be reported
   * as another source's zero. `loadError` kills the whole report; `masteryError`
   * only removes the mastery-derived block and says so. */
  const [loadError, setLoadError] = useState(false);
  const [masteryError, setMasteryError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  /* ── Fetch report data ── */
  useEffect(() => {
    if (!student?.id || !selectedMonth) return;

    const monthInfo = months.find((m) => m.value === selectedMonth);
    if (!monthInfo) return;

    const fetchReport = async () => {
      setLoading(true);
      setLoadError(false);
      setMasteryError(false);
      try {
        // Try monthly_reports table first. PGRST116 ("no rows") is the normal
        // "not generated yet" case, not a failure — either way we fall through
        // to computing from raw rows below.
        const { data: report } = await supabase
          .from('monthly_reports')
          .select('*')
          .eq('student_id', student.id)
          .eq('report_month', selectedMonth)
          .single();

        const stored = parseStoredReport(report?.report_data);
        if (stored) {
          setReportData(stored);
          setQuizScores([]);
          setDaysActive(Math.round((stored.studyConsistencyPct / 100) * daysTotal));
          setLoading(false);
          return;
        }

        // Compute from raw data — parallel fetch (was sequential)
        const [quizRes, profileRes, masteryRes] = await Promise.all([
          supabase
            .from('quiz_sessions')
            .select('score_percent, completed_at, subject, total_questions, time_taken_seconds')
            .eq('student_id', student.id)
            .gte('completed_at', monthInfo.start)
            .lte('completed_at', monthInfo.end + 'T23:59:59')
            .order('completed_at', { ascending: true })
            .limit(200),
          supabase
            .from('student_learning_profiles')
            .select('total_time_minutes, total_questions_asked, total_questions_answered_correctly')
            .eq('student_id', student.id)
            .limit(20),
          // `subject`, NOT `topic` — bloom_progression has no `topic` column, so
          // the old select returned 42703 and every mastery number silently
          // became a zero.
          supabase
            .from('bloom_progression')
            .select('subject, remember_mastery, understand_mastery, apply_mastery')
            .eq('student_id', student.id)
            .limit(50),
        ]);

        // The quiz + profile lanes carry every headline number: if either
        // failed we know nothing, so we say nothing.
        if (quizRes.error || profileRes.error) {
          setReportData(null);
          setLoadError(true);
          setLoading(false);
          return;
        }
        const quizzes = quizRes.data;
        const profiles = profileRes.data;
        // A failed mastery read is survivable — it only costs the mastery block.
        const masteryFailed = Boolean(masteryRes.error);
        setMasteryError(masteryFailed);
        const masteryRows = masteryFailed ? [] : masteryRes.data;

        const quizList = (quizzes ?? []) as QuizRow[];
        const scores = quizList.map((q: QuizRow) => q.score_percent ?? 0);
        const quizLabels = quizList.map((q: QuizRow, i: number) => ({
          label: q.subject ?? `Quiz ${i + 1}`,
          score: q.score_percent ?? 0,
        }));
        setQuizScores(quizLabels);

        // Weekly accuracies (split into ~4 weeks). A week with NO quizzes is
        // `null` — "the student didn't study" is not "the student scored 0".
        const weeklyAccuracies: Array<number | null> = [];
        for (let w = 0; w < 4; w++) {
          const weekStart = new Date(monthInfo.start);
          weekStart.setDate(weekStart.getDate() + w * 7);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 7);
          const weekQuizzes = quizList.filter((q: QuizRow) => {
            const d = new Date(q.completed_at ?? '');
            return d >= weekStart && d < weekEnd;
          });
          weeklyAccuracies.push(
            weekQuizzes.length > 0
              ? weekQuizzes.reduce((a: number, q: QuizRow) => a + (q.score_percent ?? 0), 0) / weekQuizzes.length
              : null,
          );
        }

        // Active days
        const activeDaysSet = new Set(quizList.map((q: QuizRow) => q.completed_at?.substring(0, 10)));
        const activeDaysCount = activeDaysSet.size;
        const endDate = new Date(monthInfo.end);
        const startDate = new Date(monthInfo.start);
        const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
        setDaysActive(activeDaysCount);
        setDaysTotal(totalDays);

        const totalMinutes = ((profiles ?? []) as ProfileRow[])
          .reduce((a: number, p: ProfileRow) => a + (p.total_time_minutes ?? 0), 0);
        const totalQuestions = quizList.reduce((a: number, q: QuizRow) => a + (q.total_questions ?? 0), 0);

        // Only rows that actually name a subject. An unlabelled row used to be
        // rendered as a chip reading "Unknown".
        const masteries = ((masteryRows ?? []) as MasteryRow[])
          .filter((m) => Boolean(m.subject))
          .map((m: MasteryRow) => ({
            mastery: Math.max(m.remember_mastery ?? 0, m.understand_mastery ?? 0, m.apply_mastery ?? 0),
            label: m.subject as string,
          }));

        // NOTE: no `chapters` / `totalMarks` are passed. There is no exam
        // blueprint on this page, so predictedScore and syllabusCompletionPct
        // come back null and the Exam Readiness block does not render. The
        // previous code fabricated a blueprint here; see the file header.
        const computed = computeMonthlyReportMetrics({
          masteries,
          quizScores: scores,
          weeklyAccuracies,
          totalMinutes,
          totalQuestions,
          daysActive: activeDaysCount,
          daysInMonth: totalDays,
        });

        // Nothing happened this month at all → the genuine empty state, which
        // is DISTINCT from the failure above.
        setReportData(quizList.length === 0 && masteries.length === 0 ? null : computed);
      } catch (err) {
        console.error('Failed to load report:', err);
        setReportData(null);
        setLoadError(true);
      }
      setLoading(false);
    };

    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, selectedMonth, months, reloadKey]);

  /* ── Print handler ── */
  const handlePrint = () => {
    window.print();
  };

  if (isLoading || !student) return <LoadingFoxy />;

  const maxBarScore = 100;

  return (
    <>
      {/* Print-specific styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { background: #fff !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
        .print-only { display: none; }
      `}</style>

      <div className="mesh-bg min-h-dvh pb-nav">
        <header className="page-header">
          <div className="page-header-inner flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)] no-print">&larr;</button>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'मासिक रिपोर्ट' : 'Monthly Reports'}
            </h1>
          </div>
        </header>

        <main className="app-container py-6 space-y-4">
          {/* ── Month Selector ── */}
          <div className="flex gap-2 overflow-x-auto pb-1 no-print">
            {months.map((m) => (
              <button
                key={m.value}
                onClick={() => setSelectedMonth(m.value)}
                className="shrink-0 px-4 py-2 rounded-full text-xs font-semibold transition-all"
                style={{
                  background: selectedMonth === m.value ? 'var(--orange)' : 'var(--surface-2)',
                  color: selectedMonth === m.value ? '#fff' : 'var(--text-3)',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Print header */}
          <div className="print-only" style={{ textAlign: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>Monthly Report - {months.find(m => m.value === selectedMonth)?.label}</h2>
            <p style={{ color: '#64748B', fontSize: 13 }}>{student.name} | Alfanumrik</p>
          </div>

          {loading && (
            <Card className="!p-8 text-center">
              <div className="text-4xl mb-2 animate-float">&#x1F4CA;</div>
              <div className="text-sm text-[var(--text-3)]">
                {isHi ? 'रिपोर्ट लोड हो रही है...' : 'Loading report...'}
              </div>
            </Card>
          )}

          {/* FAILURE — must be told apart from the reassuring empty below. A
              student whose request 500'd used to be shown "No data for this
              month", i.e. their own inactivity. */}
          {!loading && loadError && (
            <ReportLoadError isHi={isHi} onRetry={retry} testId="report-load-error" />
          )}

          {!loading && !loadError && !reportData && (
            <Card className="!p-8 text-center">
              <div className="text-4xl mb-2">&#x1F4AD;</div>
              <div className="text-sm font-semibold mb-1">
                {isHi ? 'इस महीने का कोई डेटा नहीं' : 'No data for this month'}
              </div>
              <div className="text-xs text-[var(--text-3)]">
                {isHi ? 'Quiz दो और डेटा यहाँ दिखेगा!' : 'Take some quizzes and data will appear here!'}
              </div>
            </Card>
          )}

          {!loading && !loadError && reportData && (
            <>
              {/* ══════════════════════════════════════════════════
                 LEARNING METRICS
                 ══════════════════════════════════════════════════ */}
              <div>
                <SectionHeader icon="&#x1F4D6;">{isHi ? 'सीखने के मापदंड' : 'Learning Metrics'}</SectionHeader>
                <Card className="!p-4">
                  <div className="flex items-center justify-around mb-4">
                    {/* Concept mastery — only when mastery rows actually exist.
                        A 0% dial for "no rows" reads as "you know nothing". */}
                    {reportData.conceptMasteryPct !== null && (
                      <div data-testid="concept-mastery-dial">
                        <CircularProgress
                          value={reportData.conceptMasteryPct}
                          color="var(--orange)"
                          label={isHi ? 'अवधारणा महारत' : 'Concept Mastery'}
                        />
                      </div>
                    )}
                    {/* Named for exactly what it computes: the mean of the last
                        N quiz score_percent values. It is NOT a retention
                        measurement, and the window is stated, not assumed. */}
                    {reportData.recentQuizAveragePct !== null && (
                      <div data-testid="recent-quiz-average">
                        <CircularProgress
                          value={reportData.recentQuizAveragePct}
                          color="var(--teal)"
                          label={
                            reportData.recentQuizCount === 1
                              ? (isHi ? 'पिछले quiz का स्कोर' : 'Last quiz score')
                              : (isHi
                                ? `पिछले ${reportData.recentQuizCount} quiz का औसत`
                                : `Avg of last ${reportData.recentQuizCount} quizzes`)
                          }
                        />
                      </div>
                    )}
                  </div>

                  {/* The mastery read failed → say so; do not draw zeros. */}
                  {masteryError && (
                    <div className="mb-3">
                      <NotEnoughData
                        isHi={isHi}
                        testId="mastery-load-error"
                        what="Your subject mastery couldn't be loaded this time — this is not a score of zero."
                        whatHi="तुम्हारी विषय-महारत इस बार लोड नहीं हो सकी — इसका मतलब शून्य अंक नहीं है।"
                      />
                    </div>
                  )}

                  {/* Strong subjects — these are SUBJECTS (bloom_progression is
                      keyed by subject), not chapters. The heading used to lie. */}
                  {reportData.strongAreas.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[11px] font-semibold mb-1" style={{ color: '#16A34A' }}>
                        {isHi ? 'मजबूत विषय' : 'Strong subjects'}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {reportData.strongAreas.map((s) => (
                          <span
                            key={s}
                            className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                            style={{ background: '#16A34A18', color: '#16A34A', border: '1px solid #16A34A30' }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Weak subjects */}
                  {reportData.weakAreas.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold mb-1" style={{ color: '#EF4444' }}>
                        {isHi ? 'कमज़ोर विषय' : 'Weak subjects'}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {reportData.weakAreas.map((s) => (
                          <span
                            key={s}
                            className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                            style={{ background: '#EF444418', color: '#EF4444', border: '1px solid #EF444430' }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Nothing mastery-shaped to show, and nothing failed. */}
                  {!masteryError
                    && reportData.conceptMasteryPct === null
                    && reportData.strongAreas.length === 0
                    && reportData.weakAreas.length === 0 && (
                    <NotEnoughData
                      isHi={isHi}
                      testId="mastery-insufficient"
                      what="Subject mastery appears once you've practised a few topics."
                      whatHi="कुछ topics का अभ्यास करते ही विषय-महारत यहाँ दिखेगी।"
                    />
                  )}
                </Card>
              </div>

              {/* ══════════════════════════════════════════════════
                 PERFORMANCE METRICS
                 ══════════════════════════════════════════════════ */}
              <div>
                <SectionHeader icon="&#x1F3AF;">{isHi ? 'प्रदर्शन मापदंड' : 'Performance Metrics'}</SectionHeader>
                <Card className="!p-4">
                  {/* Quiz scores - horizontal bars */}
                  {quizScores.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-[var(--text-2)] mb-2">
                        {isHi ? 'क्विज़ अंक' : 'Quiz Scores'}
                      </div>
                      {quizScores.slice(-6).map((q, i) => (
                        <HBar
                          key={i}
                          label={q.label}
                          value={q.score}
                          max={maxBarScore}
                          color={q.score >= 80 ? '#16A34A' : q.score >= 50 ? '#F59E0B' : '#EF4444'}
                        />
                      ))}
                    </div>
                  )}

                  {/* Accuracy trend - 4 week bar chart.
                      A week with no quizzes is `null`, NOT 0. It renders as an
                      explicit "no quizzes" stub so an unstudied week can never
                      be misread as a week of zero scores. If no week has data,
                      the whole chart is omitted rather than drawn flat. */}
                  {reportData.accuracyTrend.some((v) => v !== null) && (
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-[var(--text-2)] mb-2">
                        {isHi ? 'साप्ताहिक सटीकता' : 'Weekly Accuracy Trend'}
                      </div>
                      <div className="flex items-end gap-2 h-20" data-testid="weekly-accuracy-trend">
                        {reportData.accuracyTrend.map((val, i) => {
                          if (val === null) {
                            return (
                              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                <span
                                  className="text-[9px] font-semibold text-[var(--text-3)]"
                                  data-testid="weekly-accuracy-nodata"
                                  title={isHi ? 'इस हफ़्ते कोई quiz नहीं' : 'No quizzes this week'}
                                >
                                  {isHi ? 'quiz नहीं' : 'no quiz'}
                                </span>
                                <div
                                  className="w-full rounded-t-md"
                                  style={{
                                    height: '4%',
                                    background: 'var(--surface-2)',
                                    border: '1px dashed var(--border)',
                                  }}
                                  aria-hidden="true"
                                />
                                <span className="text-[9px] text-[var(--text-3)]">W{i + 1}</span>
                              </div>
                            );
                          }
                          const h = Math.max(4, (val / 100) * 100);
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center gap-1">
                              <span
                                className="text-[9px] font-semibold text-[var(--text-3)]"
                                data-testid="weekly-accuracy-value"
                              >
                                {Math.round(val)}%
                              </span>
                              <div
                                className="w-full rounded-t-md"
                                style={{
                                  height: `${h}%`,
                                  background: val >= 70 ? 'var(--green)' : val >= 40 ? 'var(--orange)' : '#EF4444',
                                  transition: 'height 0.4s ease',
                                }}
                              />
                              <span className="text-[9px] text-[var(--text-3)]">W{i + 1}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Time efficiency — needs logged study minutes. Without them
                      the old code printed a confident "0.00 questions/min". */}
                  {reportData.timeEfficiency !== null ? (
                    <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                      <span className="text-lg">&#x23F1;</span>
                      <div>
                        <div className="text-xs text-[var(--text-3)]">
                          {isHi ? 'समय दक्षता' : 'Time Efficiency'}
                        </div>
                        <div className="text-sm font-bold">
                          {reportData.timeEfficiency.toFixed(2)} {isHi ? 'प्रश्न/मिनट' : 'questions/min'}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <NotEnoughData
                      isHi={isHi}
                      testId="time-efficiency-insufficient"
                      what="Time efficiency needs some logged study time first."
                      whatHi="समय दक्षता के लिए पहले कुछ पढ़ाई का समय दर्ज होना चाहिए।"
                    />
                  )}
                </Card>
              </div>

              {/* ══════════════════════════════════════════════════
                 EXAM READINESS
                 Renders ONLY from a real exam blueprint (per-chapter marks
                 weightage). This page has none, so today it never renders —
                 that is the point. It used to draw "Predicted Score / 80" from
                 a blueprint invented in the browser, with a literal 80 marks
                 for every subject and every grade. The denominator now comes
                 from the blueprint itself.
                 ══════════════════════════════════════════════════ */}
              {reportData.predictedScore !== null && reportData.syllabusCompletionPct !== null && (
                <div>
                  <SectionHeader icon="&#x1F393;">{isHi ? 'परीक्षा तत्परता' : 'Exam Readiness'}</SectionHeader>
                  <Card className="!p-4">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="text-center p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                        <div className="text-[10px] text-[var(--text-3)] mb-1">
                          {isHi ? 'अनुमानित अंक' : 'Predicted Score'}
                        </div>
                        <div className="text-xl font-bold" style={{ color: 'var(--orange)' }}>
                          {reportData.predictedScore}
                        </div>
                        <div className="text-[9px] text-[var(--text-3)]">/{reportData.predictedScoreMaxMarks}</div>
                      </div>
                      <div className="text-center p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                        <div className="text-[10px] text-[var(--text-3)] mb-1">
                          {isHi ? 'सिलेबस पूरा' : 'Syllabus Complete'}
                        </div>
                        <div className="text-xl font-bold" style={{ color: 'var(--teal)' }}>
                          {reportData.syllabusCompletionPct}%
                        </div>
                      </div>
                    </div>
                    <ProgressBar
                      value={reportData.syllabusCompletionPct}
                      color="var(--teal)"
                      label={isHi ? 'सिलेबस प्रगति' : 'Syllabus Progress'}
                      showPercent
                      height={6}
                    />
                  </Card>
                </div>
              )}

              {/* ══════════════════════════════════════════════════
                 STUDY CONSISTENCY
                 ══════════════════════════════════════════════════ */}
              <div>
                <SectionHeader icon="&#x1F525;">{isHi ? 'अध्ययन नियमितता' : 'Study Consistency'}</SectionHeader>
                <Card className="!p-4">
                  <div className="grid-stats">
                    <StatCard
                      icon="&#x1F4C5;"
                      value={`${daysActive}/${daysTotal}`}
                      label={isHi ? 'सक्रिय दिन' : 'Days Active'}
                      color="var(--green)"
                    />
                    <StatCard
                      icon="&#x23F1;"
                      value={`${reportData.totalStudyMinutes}m`}
                      label={isHi ? 'कुल समय' : 'Study Minutes'}
                      color="var(--teal)"
                    />
                    <StatCard
                      icon="&#x2753;"
                      value={reportData.totalQuestionsAttempted}
                      label={isHi ? 'प्रश्न' : 'Questions'}
                      color="var(--purple)"
                    />
                  </div>
                  <div className="mt-3">
                    <ProgressBar
                      value={reportData.studyConsistencyPct}
                      color="var(--orange)"
                      label={isHi ? 'नियमितता' : 'Consistency'}
                      showPercent
                      height={6}
                    />
                  </div>
                </Card>
              </div>

              {/* ══════════════════════════════════════════════════
                 IMPROVEMENTS & ACHIEVEMENTS
                 ══════════════════════════════════════════════════ */}
              {/* The engine returns CODES; the sentences are rendered here in
                  the reader's own language (P7). They used to be assembled in
                  English inside cognitive-engine.ts and shown under Hindi
                  headings. */}
              {(reportData.improvements.length > 0 || reportData.achievements.length > 0) && (
                <div>
                  <SectionHeader icon="&#x1F31F;">{isHi ? 'सुधार और उपलब्धियाँ' : 'Improvements & Achievements'}</SectionHeader>
                  <Card className="!p-4">
                    <div data-testid="report-insights">
                      {reportData.achievements.length > 0 && (
                        <div className="mb-3">
                          <div className="text-xs font-semibold mb-2" style={{ color: '#16A34A' }}>
                            {isHi ? 'उपलब्धियाँ' : 'Achievements'}
                          </div>
                          {reportData.achievements.map((a, i) => (
                            <div key={`${a.code}-${i}`} className="flex items-center gap-2 mb-1.5">
                              <span className="text-sm" aria-hidden="true">&#x2705;</span>
                              <span className="text-xs text-[var(--text-2)]">{insightText(a, isHi)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {reportData.improvements.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold mb-2" style={{ color: '#F59E0B' }}>
                            {isHi ? 'सुधार के क्षेत्र' : 'Areas to Improve'}
                          </div>
                          {reportData.improvements.map((a, i) => (
                            <div key={`${a.code}-${i}`} className="flex items-center gap-2 mb-1.5">
                              <span className="text-sm" aria-hidden="true">&#x1F4A1;</span>
                              <span className="text-xs text-[var(--text-2)]">{insightText(a, isHi)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
              )}

              {/* ── Download PDF Button ── */}
              <div className="no-print">
                <Button variant="primary" fullWidth onClick={handlePrint}>
                  {isHi ? 'PDF डाउनलोड करो' : 'Download PDF'}
                </Button>
              </div>
            </>
          )}
        </main>
        <div className="no-print">

        </div>
      </div>
    </>
  );
}
