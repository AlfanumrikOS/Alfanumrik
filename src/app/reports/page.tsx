'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { computeMonthlyReportMetrics, type MonthlyReportData, type ExamChapter } from '@/lib/cognitive-engine';
import { REPORT_MONTHS_COUNT } from '@/lib/constants';
import { SectionHeader, StatCard } from '@/components/ui';
import {
  Card,
  Button,
  Badge,
  Chip,
  Alert,
  ProgressBar,
  ProgressRing,
  EmptyState,
  Skeleton,
  type Tone,
} from '@/components/ui/primitives';

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

interface MasteryRow {
  topic?: string;
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

/** Quiz-score % → primitive tone (presentation only; the number is server-read). */
function scoreTone(score: number): Tone {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'danger';
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

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  /* ── Fetch report data ── */
  useEffect(() => {
    if (!student?.id || !selectedMonth) return;

    const monthInfo = months.find((m) => m.value === selectedMonth);
    if (!monthInfo) return;

    const fetchReport = async () => {
      setLoading(true);
      try {
        const { data: report } = await supabase
          .from('monthly_reports')
          .select('*')
          .eq('student_id', student.id)
          .eq('report_month', selectedMonth)
          .single();

        if (report?.report_data) {
          setReportData(report.report_data as MonthlyReportData);
          setQuizScores(report.report_data.quizScoresList ?? []);
          setDaysActive(report.report_data.studyConsistencyPct
            ? Math.round((report.report_data.studyConsistencyPct / 100) * daysTotal)
            : 0);
          setLoading(false);
          return;
        }

        const [{ data: quizzes }, { data: profiles }, { data: masteryRows }] = await Promise.all([
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
          supabase
            .from('bloom_progression')
            .select('topic, remember_mastery, understand_mastery, apply_mastery')
            .eq('student_id', student.id)
            .limit(50),
        ]);

        const quizList = quizzes ?? [];
        const scores = quizList.map((q: QuizRow) => q.score_percent ?? 0);
        const quizLabels = quizList.map((q: QuizRow, i: number) => ({
          label: q.subject ?? `Quiz ${i + 1}`,
          score: q.score_percent ?? 0,
        }));
        setQuizScores(quizLabels);

        const weeklyAccuracies: number[] = [];
        for (let w = 0; w < 4; w++) {
          const weekStart = new Date(monthInfo.start);
          weekStart.setDate(weekStart.getDate() + w * 7);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 7);
          const weekQuizzes = quizList.filter((q: QuizRow) => {
            const d = new Date(q.completed_at ?? '');
            return d >= weekStart && d < weekEnd;
          });
          if (weekQuizzes.length > 0) {
            weeklyAccuracies.push(
              weekQuizzes.reduce((a: number, q: QuizRow) => a + (q.score_percent ?? 0), 0) / weekQuizzes.length
            );
          } else {
            weeklyAccuracies.push(0);
          }
        }

        const activeDaysSet = new Set(quizList.map((q: QuizRow) => q.completed_at?.substring(0, 10)));
        const activeDaysCount = activeDaysSet.size;
        const endDate = new Date(monthInfo.end);
        const startDate = new Date(monthInfo.start);
        const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
        setDaysActive(activeDaysCount);
        setDaysTotal(totalDays);

        const totalMinutes = (profiles ?? []).reduce((a: number, p: ProfileRow) => a + (p.total_time_minutes ?? 0), 0);
        const totalQuestions = quizList.reduce((a: number, q: QuizRow) => a + (q.total_questions ?? 0), 0);

        const masteries = (masteryRows ?? []).map((m: MasteryRow) => ({
          mastery: Math.max(m.remember_mastery ?? 0, m.understand_mastery ?? 0, m.apply_mastery ?? 0),
          topic: m.subject ?? 'Unknown',
        }));

        const chapters: ExamChapter[] = masteries.map((m, i) => ({
          chapterNumber: i + 1,
          chapterTitle: m.topic,
          marksWeightage: 10,
          difficultyWeight: 1,
          studentMastery: m.mastery,
          isCovered: m.mastery > 0,
        }));

        const computed = computeMonthlyReportMetrics({
          masteries,
          quizScores: scores,
          weeklyAccuracies,
          totalMinutes,
          totalQuestions,
          daysActive: activeDaysCount,
          daysInMonth: totalDays,
          chapters,
          totalMarks: 80,
        });

        setReportData(computed);
      } catch (err) {
        console.error('Failed to load report:', err);
        setReportData(null);
      }
      setLoading(false);
    };

    fetchReport();
  }, [student?.id, selectedMonth, months, daysTotal]);

  const handlePrint = () => window.print();

  if (isLoading || !student) {
    return (
      <div className="mesh-bg min-h-dvh pb-nav">
        <main className="app-container space-y-4 py-6" aria-busy="true" aria-label={isHi ? 'लोड हो रहा है' : 'Loading'}>
          <Skeleton className="h-10 w-40" radius="lg" />
          <Skeleton className="h-40 w-full" radius="lg" />
        </main>
      </div>
    );
  }

  return (
    <>
      {/* Print-specific styles — surface token, not a raw literal. */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { background: var(--surface-1) !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
        .print-only { display: none; }
      `}</style>

      <div className="mesh-bg min-h-dvh pb-nav">
        <header className="page-header">
          <div className="page-header-inner flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="no-print inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={isHi ? 'वापस जाएं' : 'Go back'}
            >
              <span aria-hidden="true">←</span>
            </button>
            <h1 className="text-fluid-lg font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'मासिक रिपोर्ट' : 'Monthly Reports'}
            </h1>
          </div>
        </header>

        <main className="app-container py-6 space-y-4">
          {/* Month Selector — selectable Chips */}
          <div className="no-print flex gap-2 overflow-x-auto pb-1">
            {months.map((m) => (
              <Chip
                key={m.value}
                selected={selectedMonth === m.value}
                onClick={() => setSelectedMonth(m.value)}
                className="shrink-0"
              >
                {m.label}
              </Chip>
            ))}
          </div>

          {/* Print header */}
          <div className="print-only" style={{ textAlign: 'center', marginBottom: 16 }}>
            <h2 className="text-fluid-xl font-bold text-foreground">
              Monthly Report — {months.find((m) => m.value === selectedMonth)?.label}
            </h2>
            <p className="text-fluid-sm text-muted-foreground">{student.name} | Alfanumrik</p>
          </div>

          {loading && (
            <Card className="p-4">
              <div className="space-y-3" aria-busy="true" aria-label={isHi ? 'रिपोर्ट लोड हो रही है' : 'Loading report'}>
                <Skeleton className="h-24 w-full" radius="lg" />
                <Skeleton className="h-16 w-full" radius="lg" />
              </div>
            </Card>
          )}

          {!loading && !reportData && (
            <Card className="p-2">
              <EmptyState
                icon="💭"
                title={isHi ? 'इस महीने का कोई डेटा नहीं' : 'No data for this month'}
                description={isHi ? 'Quiz दो और डेटा यहाँ दिखेगा!' : 'Take some quizzes and data will appear here!'}
              />
            </Card>
          )}

          {!loading && reportData && (
            <>
              {/* ── LEARNING METRICS ── */}
              <div>
                <SectionHeader icon="📖">{isHi ? 'सीखने के मापदंड' : 'Learning Metrics'}</SectionHeader>
                <Card className="p-4">
                  <div className="mb-4 flex items-center justify-around">
                    <div className="flex flex-col items-center gap-1">
                      <ProgressRing
                        value={reportData.conceptMasteryPct}
                        size={80}
                        strokeWidth={6}
                        tone="brand"
                        ariaLabel={`${isHi ? 'अवधारणा महारत' : 'Concept Mastery'}: ${reportData.conceptMasteryPct}%`}
                      />
                      <span className="text-fluid-2xs font-medium text-muted-foreground">
                        {isHi ? 'अवधारणा महारत' : 'Concept Mastery'}
                      </span>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <ProgressRing
                        value={reportData.retentionScore}
                        size={80}
                        strokeWidth={6}
                        tone="info"
                        ariaLabel={`${isHi ? '7-दिन स्मृति' : '7-Day Retention'}: ${reportData.retentionScore}%`}
                      />
                      <span className="text-fluid-2xs font-medium text-muted-foreground">
                        {isHi ? '7-दिन स्मृति' : '7-Day Retention'}
                      </span>
                    </div>
                  </div>

                  {reportData.strongChapters.length > 0 && (
                    <div className="mb-3">
                      <div className="mb-1 text-fluid-xs font-semibold text-foreground">
                        {isHi ? 'मजबूत अध्याय' : 'Strong Chapters'}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {reportData.strongChapters.map((ch) => (
                          <Badge key={ch} tone="success">{ch}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {reportData.weakChapters.length > 0 && (
                    <div>
                      <div className="mb-1 text-fluid-xs font-semibold text-foreground">
                        {isHi ? 'मज़बूत करने वाले अध्याय' : 'Chapters to strengthen'}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {reportData.weakChapters.map((ch) => (
                          <Badge key={ch} tone="warning">{ch}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              </div>

              {/* ── PERFORMANCE METRICS ── */}
              <div>
                <SectionHeader icon="🎯">{isHi ? 'प्रदर्शन मापदंड' : 'Performance Metrics'}</SectionHeader>
                <Card className="p-4">
                  {quizScores.length > 0 && (
                    <div className="mb-4">
                      <div className="mb-2 text-fluid-xs font-semibold text-foreground">
                        {isHi ? 'क्विज़ अंक' : 'Quiz Scores'}
                      </div>
                      <div className="space-y-2">
                        {quizScores.slice(-6).map((q, i) => (
                          <ProgressBar
                            key={i}
                            value={q.score}
                            tone={scoreTone(q.score)}
                            size="sm"
                            label={q.label}
                            showValue
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {reportData.accuracyTrend.length > 0 && (
                    <div className="mb-4">
                      <div className="mb-2 text-fluid-xs font-semibold text-foreground">
                        {isHi ? 'साप्ताहिक सटीकता' : 'Weekly Accuracy Trend'}
                      </div>
                      <div className="flex h-20 items-end gap-2">
                        {reportData.accuracyTrend.map((val, i) => {
                          const h = Math.max(4, (val / 100) * 100);
                          const tone = val >= 70 ? 'var(--success)' : val >= 40 ? 'var(--warning)' : 'var(--danger)';
                          return (
                            <div key={i} className="flex flex-1 flex-col items-center gap-1">
                              <span className="text-fluid-2xs font-semibold tabular-nums text-muted-foreground">
                                {Math.round(val)}%
                              </span>
                              <div
                                className="w-full rounded-t-md transition-all duration-500 ease-out motion-reduce:transition-none"
                                style={{ height: `${h}%`, backgroundColor: tone }}
                                role="img"
                                aria-label={`W${i + 1}: ${Math.round(val)}%`}
                              />
                              <span className="text-fluid-2xs text-muted-foreground">W{i + 1}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
                    <span aria-hidden="true" className="text-fluid-lg">⏱</span>
                    <div>
                      <div className="text-fluid-xs text-muted-foreground">
                        {isHi ? 'समय दक्षता' : 'Time Efficiency'}
                      </div>
                      <div className="text-fluid-sm font-bold tabular-nums text-foreground">
                        {reportData.timeEfficiency.toFixed(2)} {isHi ? 'प्रश्न/मिनट' : 'questions/min'}
                      </div>
                    </div>
                  </div>
                </Card>
              </div>

              {/* ── EXAM READINESS ── */}
              <div>
                <SectionHeader icon="🎓">{isHi ? 'परीक्षा तत्परता' : 'Exam Readiness'}</SectionHeader>
                <Card className="p-4">
                  <div className="mb-3 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-surface-2 p-3 text-center">
                      <div className="mb-1 text-fluid-2xs text-muted-foreground">
                        {isHi ? 'अनुमानित अंक' : 'Predicted Score'}
                      </div>
                      <div className="text-fluid-xl font-bold tabular-nums" style={{ color: 'var(--primary)' }}>
                        {reportData.predictedScore}
                      </div>
                      <div className="text-fluid-2xs text-muted-foreground">/80</div>
                    </div>
                    <div className="rounded-xl bg-surface-2 p-3 text-center">
                      <div className="mb-1 text-fluid-2xs text-muted-foreground">
                        {isHi ? 'सिलेबस पूरा' : 'Syllabus Complete'}
                      </div>
                      <div className="text-fluid-xl font-bold tabular-nums" style={{ color: 'var(--info)' }}>
                        {reportData.syllabusCompletionPct}%
                      </div>
                    </div>
                  </div>
                  <ProgressBar
                    value={reportData.syllabusCompletionPct}
                    tone="info"
                    size="sm"
                    label={isHi ? 'सिलेबस प्रगति' : 'Syllabus Progress'}
                    showValue
                  />
                </Card>
              </div>

              {/* ── STUDY CONSISTENCY ── */}
              <div>
                <SectionHeader icon="🔥">{isHi ? 'अध्ययन नियमितता' : 'Study Consistency'}</SectionHeader>
                <Card className="p-4">
                  <div className="grid-stats">
                    <StatCard
                      icon="📅"
                      value={`${daysActive}/${daysTotal}`}
                      label={isHi ? 'सक्रिय दिन' : 'Days Active'}
                      color="var(--success)"
                    />
                    <StatCard
                      icon="⏱"
                      value={`${reportData.totalStudyMinutes}m`}
                      label={isHi ? 'कुल समय' : 'Study Minutes'}
                      color="var(--info)"
                    />
                    <StatCard
                      icon="❓"
                      value={reportData.totalQuestionsAttempted}
                      label={isHi ? 'प्रश्न' : 'Questions'}
                      color="var(--secondary)"
                    />
                  </div>
                  <div className="mt-3">
                    <ProgressBar
                      value={reportData.studyConsistencyPct}
                      tone="brand"
                      size="sm"
                      label={isHi ? 'नियमितता' : 'Consistency'}
                      showValue
                    />
                  </div>
                </Card>
              </div>

              {/* ── IMPROVEMENTS & ACHIEVEMENTS ── */}
              {(reportData.improvementAreas.length > 0 || reportData.achievements.length > 0) && (
                <div>
                  <SectionHeader icon="🌟">{isHi ? 'सुधार और उपलब्धियाँ' : 'Improvements & Achievements'}</SectionHeader>
                  <div className="space-y-3">
                    {reportData.achievements.length > 0 && (
                      <Alert tone="success" title={isHi ? 'उपलब्धियाँ' : 'Achievements'}>
                        <ul className="space-y-1.5">
                          {reportData.achievements.map((a, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span aria-hidden="true">✓</span>
                              <span>{a}</span>
                            </li>
                          ))}
                        </ul>
                      </Alert>
                    )}
                    {reportData.improvementAreas.length > 0 && (
                      <Alert tone="info" title={isHi ? 'सुधार के क्षेत्र' : 'Areas to Improve'}>
                        <ul className="space-y-1.5">
                          {reportData.improvementAreas.map((a, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span aria-hidden="true">💡</span>
                              <span>{a}</span>
                            </li>
                          ))}
                        </ul>
                      </Alert>
                    )}
                  </div>
                </div>
              )}

              {/* Download PDF */}
              <div className="no-print">
                <Button variant="primary" fullWidth onClick={handlePrint}>
                  {isHi ? 'PDF डाउनलोड करो' : 'Download PDF'}
                </Button>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}
