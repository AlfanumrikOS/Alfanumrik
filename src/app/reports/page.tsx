'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { computeMonthlyReportMetrics, type MonthlyReportData, type ExamChapter } from '@/lib/cognitive-engine';
import { REPORT_MONTHS_COUNT } from '@/lib/constants';
import { Card, Button, ProgressBar, SectionHeader, StatCard, LoadingFoxy, BottomNav } from '@/components/ui';

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

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

  /* ── Fetch report data ── */
  useEffect(() => {
    if (!student?.id || !selectedMonth) return;

    const monthInfo = months.find((m) => m.value === selectedMonth);
    if (!monthInfo) return;

    const fetchReport = async () => {
      setLoading(true);
      try {
        // Try monthly_reports table first
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

        // Compute from raw data
        const { data: quizzes } = await supabase
          .from('quiz_sessions')
          .select('score_percent, completed_at, subject, total_questions, time_taken_seconds')
          .eq('student_id', student.id)
          .gte('completed_at', monthInfo.start)
          .lte('completed_at', monthInfo.end + 'T23:59:59')
          .order('completed_at', { ascending: true });

        const { data: profiles } = await supabase
          .from('student_learning_profiles')
          .select('total_time_minutes, total_questions_asked, total_questions_answered_correctly')
          .eq('student_id', student.id);

        const { data: masteryRows } = await supabase
          .from('bloom_progression')
          .select('topic, remember_mastery, understand_mastery, apply_mastery')
          .eq('student_id', student.id);

        const quizList = quizzes ?? [];
        const scores = quizList.map((q: any) => q.score_percent ?? 0);
        const quizLabels = quizList.map((q: any, i: number) => ({
          label: q.subject ?? `Quiz ${i + 1}`,
          score: q.score_percent ?? 0,
        }));
        setQuizScores(quizLabels);

        // Weekly accuracies (split into ~4 weeks)
        const weeklyAccuracies: number[] = [];
        for (let w = 0; w < 4; w++) {
          const weekStart = new Date(monthInfo.start);
          weekStart.setDate(weekStart.getDate() + w * 7);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 7);
          const weekQuizzes = quizList.filter((q: any) => {
            const d = new Date(q.completed_at);
            return d >= weekStart && d < weekEnd;
          });
          if (weekQuizzes.length > 0) {
            weeklyAccuracies.push(
              weekQuizzes.reduce((a: number, q: any) => a + (q.score_percent ?? 0), 0) / weekQuizzes.length
            );
          } else {
            weeklyAccuracies.push(0);
          }
        }

        // Active days
        const activeDaysSet = new Set(quizList.map((q: any) => q.completed_at?.substring(0, 10)));
        const activeDaysCount = activeDaysSet.size;
        const endDate = new Date(monthInfo.end);
        const startDate = new Date(monthInfo.start);
        const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
        setDaysActive(activeDaysCount);
        setDaysTotal(totalDays);

        const totalMinutes = (profiles ?? []).reduce((a: number, p: any) => a + (p.total_time_minutes ?? 0), 0);
        const totalQuestions = quizList.reduce((a: number, q: any) => a + (q.total_questions ?? 0), 0);

        const masteries = (masteryRows ?? []).map((m: any) => ({
          mastery: Math.max(m.remember_mastery ?? 0, m.understand_mastery ?? 0, m.apply_mastery ?? 0),
          topic: m.subject ?? 'Unknown',
        }));

        const chapters: ExamChapter[] = masteries.map((m, i) => ({
          chapterNumber: i + 1,
          chapterTitle: m.topic,  // topic is mapped from subject above
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

          {!loading && !reportData && (
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

          {!loading && reportData && (
            <>
              {/* ══════════════════════════════════════════════════
                 LEARNING METRICS
                 ══════════════════════════════════════════════════ */}
              <div>
                <SectionHeader icon="&#x1F4D6;">{isHi ? 'सीखने के मापदंड' : 'Learning Metrics'}</SectionHeader>
                <Card className="!p-4">
                  <div className="flex items-center justify-around mb-4">
                    <CircularProgress
                      value={reportData.conceptMasteryPct}
                      color="var(--orange)"
                      label={isHi ? 'अवधारणा महारत' : 'Concept Mastery'}
                    />
                    <CircularProgress
                      value={reportData.retentionScore}
                      color="var(--teal)"
                      label={isHi ? '7-दिन स्मृति' : '7-Day Retention'}
                    />
                  </div>

                  {/* Strong chapters */}
                  {reportData.strongChapters.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[11px] font-semibold mb-1" style={{ color: '#16A34A' }}>
                        {isHi ? 'मजबूत अध्याय' : 'Strong Chapters'}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {reportData.strongChapters.map((ch) => (
                          <span
                            key={ch}
                            className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                            style={{ background: '#16A34A18', color: '#16A34A', border: '1px solid #16A34A30' }}
                          >
                            {ch}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Weak chapters */}
                  {reportData.weakChapters.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold mb-1" style={{ color: '#EF4444' }}>
                        {isHi ? 'कमज़ोर अध्याय' : 'Weak Chapters'}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {reportData.weakChapters.map((ch) => (
                          <span
                            key={ch}
                            className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                            style={{ background: '#EF444418', color: '#EF4444', border: '1px solid #EF444430' }}
                          >
                            {ch}
                          </span>
                        ))}
                      </div>
                    </div>
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

                  {/* Accuracy trend - 4 week bar chart */}
                  {reportData.accuracyTrend.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-[var(--text-2)] mb-2">
                        {isHi ? 'साप्ताहिक सटीकता' : 'Weekly Accuracy Trend'}
                      </div>
                      <div className="flex items-end gap-2 h-20">
                        {reportData.accuracyTrend.map((val, i) => {
                          const h = Math.max(4, (val / 100) * 100);
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center gap-1">
                              <span className="text-[9px] font-semibold text-[var(--text-3)]">
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

                  {/* Time efficiency */}
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
                </Card>
              </div>

              {/* ══════════════════════════════════════════════════
                 EXAM READINESS
                 ══════════════════════════════════════════════════ */}
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
                      <div className="text-[9px] text-[var(--text-3)]">/80</div>
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
              {(reportData.improvementAreas.length > 0 || reportData.achievements.length > 0) && (
                <div>
                  <SectionHeader icon="&#x1F31F;">{isHi ? 'सुधार और उपलब्धियाँ' : 'Improvements & Achievements'}</SectionHeader>
                  <Card className="!p-4">
                    {reportData.achievements.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs font-semibold mb-2" style={{ color: '#16A34A' }}>
                          {isHi ? 'उपलब्धियाँ' : 'Achievements'}
                        </div>
                        {reportData.achievements.map((a, i) => (
                          <div key={i} className="flex items-center gap-2 mb-1.5">
                            <span className="text-sm">&#x2705;</span>
                            <span className="text-xs text-[var(--text-2)]">{a}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {reportData.improvementAreas.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold mb-2" style={{ color: '#F59E0B' }}>
                          {isHi ? 'सुधार के क्षेत्र' : 'Areas to Improve'}
                        </div>
                        {reportData.improvementAreas.map((a, i) => (
                          <div key={i} className="flex items-center gap-2 mb-1.5">
                            <span className="text-sm">&#x1F4A1;</span>
                            <span className="text-xs text-[var(--text-2)]">{a}</span>
                          </div>
                        ))}
                      </div>
                    )}
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
          <BottomNav />
        </div>
      </div>
    </>
  );
}
