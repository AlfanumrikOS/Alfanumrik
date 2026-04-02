'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { getStudentProfiles, getSubjects, getBloomProgression, getLearningVelocity, getKnowledgeGaps, supabase } from '@/lib/supabase';
import { BLOOM_CONFIG, BLOOM_LEVELS, BLOOM_ORDER, getHighestMasteredBloom, predictMasteryDate } from '@/lib/cognitive-engine';
import type { BloomLevel, KnowledgeGap, LearningVelocity, CognitiveSessionMetrics, StudentLearningProfile, Subject } from '@/lib/types';
import { Card, Badge, ProgressBar, SectionHeader, StatCard, MasteryRing, LoadingFoxy, BottomNav, Button, EmptyState } from '@/components/ui';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';

/* ── Helpers ── */
const SEVERITY_COLORS: Record<string, string> = {
  critical: '#DC2626',
  high: '#F59E0B',
  medium: '#3B82F6',
  low: '#6B7280',
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function formatDate(d: Date | string | null): string {
  if (!d) return '---';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── Bloom Mastery Heatmap for a single subject ── */
function BloomHeatmap({ data, isHi }: { data: Array<{ bloom_level: BloomLevel; mastery: number }>; isHi: boolean }) {
  // Aggregate mastery per bloom level
  const masteryByLevel: Record<BloomLevel, number[]> = {
    remember: [], understand: [], apply: [], analyze: [], evaluate: [], create: [],
  };
  for (const row of data) {
    if (masteryByLevel[row.bloom_level]) {
      masteryByLevel[row.bloom_level].push(row.mastery ?? 0);
    }
  }

  return (
    <div className="flex gap-1 items-center w-full">
      {BLOOM_LEVELS.map((level) => {
        const values = masteryByLevel[level];
        const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        const cfg = BLOOM_CONFIG[level];
        const opacity = Math.max(0.1, avg);
        return (
          <div
            key={level}
            className="flex-1 rounded-sm relative group"
            style={{
              height: 24,
              background: cfg.color,
              opacity,
              minWidth: 0,
            }}
            title={`${isHi ? cfg.labelHi : cfg.label}: ${Math.round(avg * 100)}%`}
          >
            <div className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity">
              {Math.round(avg * 100)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Bloom Legend ── */
function BloomLegend({ isHi }: { isHi: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
      {BLOOM_LEVELS.map((level) => {
        const cfg = BLOOM_CONFIG[level];
        return (
          <div key={level} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: cfg.color }} />
            <span className="text-[10px] text-[var(--text-3)]">{isHi ? cfg.labelHi : cfg.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Learning Velocity Mini-Chart (sparkline-style) ── */
function VelocitySparkline({ datapoints }: { datapoints: Array<{ date: string; mastery: number }> }) {
  if (!datapoints || datapoints.length < 2) return <span className="text-[10px] text-[var(--text-3)]">---</span>;

  const sorted = [...datapoints].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const maxM = Math.max(...sorted.map((d) => d.mastery), 0.01);
  const width = 80;
  const height = 24;
  const step = width / (sorted.length - 1);

  const points = sorted.map((d, i) => `${i * step},${height - (d.mastery / maxM) * height}`).join(' ');

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke="var(--teal)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Cognitive Session Card ── */
function SessionMetricCard({ session, isHi }: { session: CognitiveSessionMetrics; isHi: boolean }) {
  const zpdAcc = session.zpd_accuracy_rate != null ? Math.round(session.zpd_accuracy_rate * 100) : null;
  const dur = session.session_start && session.session_end
    ? Math.round((new Date(session.session_end).getTime() - new Date(session.session_start).getTime()) / 60000)
    : null;

  return (
    <Card className="!p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-[var(--text-2)]">
          {(session.questions_in_zpd ?? 0) + (session.questions_too_easy ?? 0) + (session.questions_too_hard ?? 0)} {isHi ? 'प्रश्न' : 'questions'}
        </span>
        <div className="flex items-center gap-2">
          {session.fatigue_detected && (
            <Badge color="#EF4444" size="sm">{isHi ? 'थकान' : 'Low Energy'}</Badge>
          )}
          {dur != null && (
            <span className="text-[10px] text-[var(--text-3)]">{dur}m</span>
          )}
        </div>
      </div>

      {/* ZPD Accuracy */}
      {zpdAcc != null && (
        <div className="mb-2">
          <div className="flex justify-between text-[10px] text-[var(--text-3)] mb-0.5">
            <span>{isHi ? 'सही स्तर पर सटीकता' : 'Right-Level Accuracy'}</span>
            <span>{zpdAcc}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full" style={{ background: 'var(--surface-2)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${zpdAcc}%`,
                background: zpdAcc >= 70 ? 'var(--green)' : zpdAcc >= 40 ? 'var(--orange)' : '#EF4444',
              }}
            />
          </div>
        </div>
      )}

      {/* ZPD Distribution */}
      {(session.questions_in_zpd ?? 0) + (session.questions_too_easy ?? 0) + (session.questions_too_hard ?? 0) > 0 && (
        <div className="flex gap-0.5">
          {session.questions_in_zpd ? <div className="rounded-sm text-center text-[9px] font-bold text-white px-1" style={{ background: '#16A34A', minWidth: 16 }} title={`In ZPD: ${session.questions_in_zpd}`}>{session.questions_in_zpd}</div> : null}
          {session.questions_too_easy ? <div className="rounded-sm text-center text-[9px] font-bold text-white px-1" style={{ background: '#3B82F6', minWidth: 16 }} title={`Too Easy: ${session.questions_too_easy}`}>{session.questions_too_easy}</div> : null}
          {session.questions_too_hard ? <div className="rounded-sm text-center text-[9px] font-bold text-white px-1" style={{ background: '#EF4444', minWidth: 16 }} title={`Too Hard: ${session.questions_too_hard}`}>{session.questions_too_hard}</div> : null}
        </div>
      )}
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PROGRESS PAGE — Alfanumrik 2.0 with Cognitive Analytics
   ═══════════════════════════════════════════════════════════════ */

export default function ProgressPage() {
  const { student, snapshot, isLoggedIn, isLoading, isHi, refreshSnapshot } = useAuth();
  const router = useRouter();

  const [profiles, setProfiles] = useState<StudentLearningProfile[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [bloomData, setBloomData] = useState<Record<string, unknown>[]>([]);
  const [velocityData, setVelocityData] = useState<LearningVelocity[]>([]);
  const [knowledgeGaps, setKnowledgeGaps] = useState<KnowledgeGap[]>([]);
  const [sessionMetrics, setSessionMetrics] = useState<CognitiveSessionMetrics[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'cognitive'>('overview');

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

  useEffect(() => {
    if (!student) return;
    refreshSnapshot();

    // Core data
    Promise.all([getStudentProfiles(student.id), getSubjects()]).then(([p, s]) => {
      setProfiles(p);
      setSubjects(s);
    });

    // Cognitive 2.0 data
    getBloomProgression(student.id).then(setBloomData).catch(() => {});
    getLearningVelocity(student.id).then(setVelocityData).catch(() => {});
    getKnowledgeGaps(student.id, undefined, 20).then(setKnowledgeGaps).catch(() => {});

    // Cognitive session metrics
    supabase
      .from('cognitive_session_metrics')
      .select('*')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setSessionMetrics((data as CognitiveSessionMetrics[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on student.id to avoid re-running on object reference changes
  }, [student?.id]);

  if (isLoading || !student) return <LoadingFoxy />;

  /* ── Aggregate stats ── */
  const totalXp = snapshot?.total_xp ?? profiles.reduce((a, p) => a + (p.xp ?? 0), 0);
  const totalMinutes = profiles.reduce((a, p) => a + (p.total_time_minutes ?? 0), 0);
  const totalSessions = profiles.reduce((a, p) => a + (p.total_sessions ?? 0), 0);
  const totalCorrect = profiles.reduce((a, p) => a + (p.total_questions_answered_correctly ?? 0), 0);
  const totalAsked = profiles.reduce((a, p) => a + (p.total_questions_asked ?? 0), 0);
  const accuracy = totalAsked > 0 ? Math.round((totalCorrect / totalAsked) * 100) : 0;

  /* ── Bloom aggregate: transform DB rows into per-level mastery data ── */
  const bloomFlattened = bloomData.flatMap((b: Record<string, unknown>) =>
    BLOOM_LEVELS.map((level) => ({
      bloom_level: level as BloomLevel,
      mastery: Number(b[`${level}_mastery`]) || 0,
      subject: (b.subject as string) ?? 'unknown',
    })).filter(item => item.mastery > 0)
  );
  const highestBloom: BloomLevel = bloomFlattened.length > 0
    ? getHighestMasteredBloom(
        bloomFlattened.map((b) => ({
          bloomLevel: b.bloom_level,
          mastery: b.mastery,
          attempts: 1,
          correct: b.mastery > 0.5 ? 1 : 0,
        }))
      )
    : 'remember';

  /* ── Average velocity ── */
  const avgVelocity = velocityData.length > 0
    ? velocityData.reduce((a, v) => a + (v.weekly_mastery_rate ?? 0), 0) / velocityData.length
    : 0;

  /* ── Mastery predictions: top 3 weakest topics ── */
  const weakestTopics = [...velocityData]
    .filter((v) => (v.weekly_mastery_rate ?? 0) > 0)
    .sort((a, b) => (a.weekly_mastery_rate ?? 0) - (b.weekly_mastery_rate ?? 0))
    .slice(0, 3);

  /* ── Knowledge gaps grouped by severity (computed from confidence_score) ── */
  const gapsWithSeverity = knowledgeGaps.map(g => ({
    ...g,
    severity: (g.confidence_score ?? 0) > 0.7 ? 'critical' : (g.confidence_score ?? 0) > 0.4 ? 'high' : 'medium',
    topic_title: g.target_concept_name,
    description: `Missing: ${g.missing_prerequisite_name}`,
    description_hi: `कमी: ${g.missing_prerequisite_name}`,
  }));
  const gapsBySeverity = [...gapsWithSeverity].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
  );

  /* ── Bloom data grouped by subject ── */
  const bloomBySubject = new Map<string, Array<{ bloom_level: BloomLevel; mastery: number; subject: string }>>();
  for (const row of bloomFlattened) {
    const subj = row.subject ?? 'unknown';
    if (!bloomBySubject.has(subj)) bloomBySubject.set(subj, []);
    bloomBySubject.get(subj)!.push(row);
  }

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">&larr;</button>
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'प्रगति 2.0' : 'Progress 2.0'}
          </h1>
        </div>
      </header>

      <main className="app-container py-6 space-y-4">
        <SectionErrorBoundary section="Progress">
        {/* ── Tab Switcher ── */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('overview')}
            className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: activeTab === 'overview' ? 'var(--orange)' : 'var(--surface-2)',
              color: activeTab === 'overview' ? '#fff' : 'var(--text-3)',
            }}
          >
            {isHi ? 'सारांश' : 'Overview'}
          </button>
          <button
            onClick={() => setActiveTab('cognitive')}
            className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: activeTab === 'cognitive' ? 'var(--purple)' : 'var(--surface-2)',
              color: activeTab === 'cognitive' ? '#fff' : 'var(--text-3)',
            }}
          >
            {isHi ? 'गहन विश्लेषण' : 'Deep Analysis'}
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════
           OVERVIEW TAB — Enhanced Stats + Subject Progress
           ══════════════════════════════════════════════════════════ */}
        {activeTab === 'overview' && (
          <>
            {/* ═══ EMPTY STATE — show when student has zero quiz history ═══ */}
            {totalSessions === 0 ? (
              <Card className="!p-6 text-center">
                <div className="text-5xl mb-3">📊</div>
                <h2 className="text-lg font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                  {isHi ? 'तुम्हारी प्रगति यहाँ दिखेगी' : 'Your progress will show up here'}
                </h2>
                <p className="text-sm text-[var(--text-2)] max-w-xs mx-auto leading-relaxed mb-2">
                  {isHi
                    ? 'पहला क्विज़ लो और Foxy तुम्हारी सटीकता, XP, और विषय-वार महारत track करेगा।'
                    : 'Take your first quiz and Foxy will track your accuracy, XP, and subject-wise mastery.'}
                </p>
                <div className="flex flex-col items-center gap-3 mt-4 rounded-xl p-4" style={{ background: 'var(--surface-2)' }}>
                  <div className="flex items-center gap-4 text-xs text-[var(--text-3)]">
                    <span>🎯 {isHi ? 'सटीकता' : 'Accuracy'}</span>
                    <span>🔥 {isHi ? 'स्ट्रीक' : 'Streak'}</span>
                    <span>🧠 {isHi ? 'Bloom विश्लेषण' : "Bloom's Analysis"}</span>
                  </div>
                  <p className="text-xs text-[var(--text-3)]">
                    {isHi ? 'ये सब 1 क्विज़ के बाद unlock होगा' : 'All unlocked after just 1 quiz'}
                  </p>
                </div>
                <div className="flex gap-3 mt-5 justify-center">
                  <Button variant="primary" size="md" onClick={() => router.push('/quiz')}>
                    {isHi ? 'पहला क्विज़ लो' : 'Take First Quiz'}
                  </Button>
                  <Button variant="ghost" size="md" onClick={() => router.push('/foxy')}>
                    {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
                  </Button>
                </div>
              </Card>
            ) : (
              <>
                {/* ═══ MASTERY HERO — overall accuracy ring + key stats ═══ */}
                <Card className="!p-6">
                  <div className="flex items-center gap-5">
                    <MasteryRing value={accuracy} size={80} strokeWidth={6}>
                      <div className="text-center">
                        <div className="text-lg font-bold" style={{ color: accuracy >= 70 ? 'var(--green)' : accuracy >= 40 ? 'var(--orange)' : '#DC2626' }}>{accuracy}%</div>
                      </div>
                    </MasteryRing>
                    <div className="flex-1">
                      <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                        {isHi ? 'कुल सटीकता' : 'Overall Accuracy'}
                      </h2>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
                        <span className="text-[var(--text-3)]">{isHi ? 'कुल XP' : 'Total XP'}</span>
                        <span className="font-semibold text-right" style={{ color: 'var(--orange)' }}>{totalXp.toLocaleString()}</span>
                        <span className="text-[var(--text-3)]">{isHi ? 'पढ़ाई का समय' : 'Study Time'}</span>
                        <span className="font-semibold text-right">{totalMinutes}m</span>
                        <span className="text-[var(--text-3)]">{isHi ? 'सत्र' : 'Sessions'}</span>
                        <span className="font-semibold text-right">{totalSessions}</span>
                      </div>
                    </div>
                  </div>
                </Card>

                {/* ═══ SUBJECT MASTERY — rings per subject ═══ */}
                <div>
                  <SectionHeader icon="📚">{isHi ? 'विषयवार महारत' : 'Subject Mastery'}</SectionHeader>
                  {profiles.length === 0 ? (
                    <Card className="!p-4 text-center">
                      <div className="text-2xl mb-1">📚</div>
                      <div className="text-sm text-[var(--text-3)]">
                        {isHi ? 'और quiz दो ताकि विषयवार प्रगति दिखे' : 'Take more quizzes to see subject-wise progress'}
                      </div>
                    </Card>
                  ) : (
                    <div className="space-y-2">
                      {profiles.map((p) => {
                        const meta = subjects.find((s: { code: string }) => s.code === p.subject);
                        const correctPct = p.total_questions_asked > 0
                          ? Math.round((p.total_questions_answered_correctly / p.total_questions_asked) * 100)
                          : 0;

                        return (
                          <Card key={p.id} className="!p-3 flex items-center gap-3">
                            <MasteryRing value={correctPct} size={48} strokeWidth={4} color={meta?.color}>
                              <span className="text-base">{meta?.icon ?? '📚'}</span>
                            </MasteryRing>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-sm">{meta?.name ?? p.subject}</div>
                              <div className="text-xs text-[var(--text-3)]">
                                Lv{p.level} · {p.xp} XP · {correctPct}% {isHi ? 'सटीकता' : 'accuracy'}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-bold" style={{ color: meta?.color ?? 'var(--orange)' }}>{correctPct}%</div>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Mastery Predictions */}
                {weakestTopics.length > 0 && (
                  <div>
                    <SectionHeader icon="🔮">{isHi ? 'महारत की भविष्यवाणी' : 'Mastery Predictions'}</SectionHeader>
                    <div className="space-y-2">
                      {weakestTopics.map((v) => {
                        const rate = v.weekly_mastery_rate ?? 0;
                        const predicted = v.predicted_mastery_date
                          ? new Date(v.predicted_mastery_date)
                          : predictMasteryDate(rate, rate);

                        return (
                          <Card key={v.id} className="!p-3">
                            <div className="flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold truncate">{v.subject}</div>
                                <div className="text-[11px] text-[var(--text-3)]">
                                  {isHi ? 'गति' : 'Rate'}: {(rate * 100).toFixed(1)}%/wk
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-[10px] text-[var(--text-3)]">
                                  {isHi ? 'अनुमानित तिथि' : 'Predicted by'}
                                </div>
                                <div className="text-xs font-semibold" style={{ color: 'var(--teal)' }}>
                                  {predicted ? formatDate(predicted) : (isHi ? 'अनिश्चित' : 'Uncertain')}
                                </div>
                              </div>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ═══ NEP Holistic Progress Card link ═══ */}
            {totalSessions > 0 && (
              <Link href="/hpc" className="block">
                <Card className="!p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
                  <span className="text-2xl">📋</span>
                  <div className="flex-1">
                    <div className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
                      {isHi ? 'NEP समग्र प्रगति कार्ड' : 'NEP Holistic Progress Card'}
                    </div>
                    <div className="text-xs text-[var(--text-3)]">
                      {isHi ? 'Bloom, दक्षता, और CBSE तैयारी देखें' : 'View Bloom\'s, competencies, and CBSE readiness'}
                    </div>
                  </div>
                  <span className="text-[var(--text-3)]" aria-hidden="true">&rarr;</span>
                </Card>
              </Link>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════
           COGNITIVE TAB — Gaps, Velocity, Sessions
           ══════════════════════════════════════════════════════════ */}
        {activeTab === 'cognitive' && (
          <>
            {/* Learning Velocity */}
            {velocityData.length > 0 && (
              <div>
                <SectionHeader icon="🚀">{isHi ? 'सीखने की गति' : 'Learning Velocity'}</SectionHeader>
                <div className="space-y-2">
                  {velocityData.slice(0, 8).map((v) => {
                    const rate = v.weekly_mastery_rate ?? 0;
                    const predicted = v.predicted_mastery_date
                      ? new Date(v.predicted_mastery_date)
                      : predictMasteryDate(rate, rate);

                    return (
                      <Card key={v.id} className="!p-3">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold truncate">{v.subject}</div>
                            <div className="text-[10px] text-[var(--text-3)]">
                              {isHi ? 'गति' : 'Rate'}: {(rate * 100).toFixed(1)}%/wk
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xs font-bold" style={{ color: 'var(--teal)' }}>
                              {Math.round(rate * 100)}%
                            </div>
                            {predicted && (
                              <div className="text-[9px] text-[var(--text-3)]">
                                {isHi ? 'तक' : 'by'} {formatDate(predicted)}
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Knowledge Gaps */}
            <div>
              <SectionHeader icon="🕳️">{isHi ? 'ज्ञान की कमियाँ' : 'Knowledge Gaps'}</SectionHeader>
              {gapsBySeverity.length === 0 ? (
                <Card className="!p-4 text-center">
                  <div className="text-2xl mb-1">✅</div>
                  <div className="text-sm text-[var(--text-3)]">
                    {isHi ? 'कोई ज्ञान की कमी नहीं मिली!' : 'No knowledge gaps detected!'}
                  </div>
                </Card>
              ) : (
                <div className="space-y-2">
                  {gapsBySeverity.map((gap) => (
                    <Card key={gap.id} className="!p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs font-semibold truncate">{gap.topic_title ?? gap.target_concept_name}</span>
                            <Badge color={SEVERITY_COLORS[gap.severity ?? 'medium'] ?? '#6B7280'} size="sm">
                              {gap.severity ?? 'medium'}
                            </Badge>
                            <span className="text-[10px] text-[var(--text-3)] px-1.5 py-0.5 rounded-md" style={{ background: 'var(--surface-2)' }}>
                              {gap.detection_method?.replace(/_/g, ' ') ?? 'detected'}
                            </span>
                          </div>
                          <div className="text-[11px] text-[var(--text-3)] leading-relaxed">
                            {isHi && gap.description_hi ? gap.description_hi : (gap.description ?? `Missing: ${gap.missing_prerequisite_name}`)}
                          </div>
                        </div>
                        <Button
                          variant="soft"
                          size="sm"
                          color="var(--orange)"
                          onClick={() => router.push(`/foxy?topic=${encodeURIComponent(gap.topic_title ?? gap.target_concept_name)}`)}
                          className="shrink-0"
                        >
                          {isHi ? 'ठीक करो' : 'Fix'}
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Cognitive Session History */}
            {sessionMetrics.length > 0 && (
              <div>
                <SectionHeader icon="🧠">{isHi ? 'स्मार्ट क्विज़ सत्र' : 'Smart Quiz Sessions'}</SectionHeader>
                <div className="space-y-2">
                  {sessionMetrics.map((s) => (
                    <SessionMetricCard key={s.id} session={s} isHi={isHi} />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state for cognitive tab */}
            {velocityData.length === 0 && gapsBySeverity.length === 0 && sessionMetrics.length === 0 && (
              <EmptyState
                icon="📈"
                title={isHi ? 'प्रगति देखने के लिए सीखना शुरू करो' : 'Start learning to see your progress'}
                description={isHi
                  ? 'कुछ quiz दो, फिर यहाँ analytics दिखेगा!'
                  : 'Take a few quizzes and your cognitive analytics will appear here!'}
                action={
                  <Button variant="primary" size="sm" onClick={() => router.push('/quiz')}>
                    {isHi ? 'Quiz शुरू करो' : 'Start a Quiz'}
                  </Button>
                }
              />
            )}
          </>
        )}
        </SectionErrorBoundary>
      </main>
      <BottomNav />
    </div>
  );
}
