'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { calculateScorePercent } from '@/lib/scoring';
import { getStudentProfiles, getSubjects, getBloomProgression, getLearningVelocity, getKnowledgeGaps, supabase } from '@/lib/supabase';
import { BLOOM_CONFIG, BLOOM_LEVELS, predictMasteryDate } from '@/lib/cognitive-engine';
import { getLevelFromScore } from '@/lib/score-config';
import {
  bandForValue,
  bandLabelForValue,
  MASTERY_BAND_LABELS,
  type MasteryBand,
} from '@/lib/dashboard/mastery-band-labels';
import type { BloomLevel, KnowledgeGap, LearningVelocity, CognitiveSessionMetrics, StudentLearningProfile, Subject } from '@/lib/types';
import {
  Card,
  Badge,
  Button,
  IconButton,
  MasteryRing,
  ProgressBar,
  Alert,
  EmptyState,
  Skeleton,
  SkeletonCircle,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  type Tone,
} from '@/components/ui/primitives';
import { SectionHeader } from '@/components/ui';
import { LineChart } from '@/components/admin-ui';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import ScoreHero from '@/components/score/ScoreHero';
import ScoreCard from '@/components/score/ScoreCard';
import CoinBalance from '@/components/coins/CoinBalance';
import { usePermissions } from '@/lib/usePermissions';
import { useMyPulse } from '@/lib/pulse/use-pulse';
import { StudentPulse } from '@/components/pulse';
import { calculateLevel } from '@/lib/xp-config';
import type { StudentSnapshot } from '@/lib/types';

/* ── Types for Performance Score data ── */
interface PerformanceScoreRow {
  id: string;
  student_id: string;
  subject: string;
  overall_score: number;
  performance_component: number;
  behavior_component: number;
  level_name: string;
  updated_at: string;
}

interface ScoreHistoryRow {
  id: string;
  student_id: string;
  subject: string;
  score: number;
  recorded_at: string;
}

interface DecayTopic {
  id: string;
  topic_id: string;
  topic: string;
  subject: string;
  mastery_probability: number;
  next_review_at: string | null;
}

/* ── Shared band → primitive tone + non-colour backup ── */
const BAND_TONE: Record<MasteryBand, Tone> = { high: 'success', mid: 'warning', low: 'danger' };
const BAND_GLYPH: Record<MasteryBand, string> = { high: '●', mid: '◐', low: '▲' };
const BAND_VAR: Record<MasteryBand, string> = {
  high: 'var(--mastery-high)',
  mid: 'var(--mastery-mid)',
  low: 'var(--mastery-low)',
};

/* ── Knowledge-gap severity → supportive, bilingual, non-harsh label ── */
const GAP_SEVERITY: Record<string, { tone: Tone; en: string; hi: string }> = {
  critical: { tone: 'danger', en: 'Top priority', hi: 'सर्वोच्च प्राथमिकता' },
  high: { tone: 'warning', en: 'Focus area', hi: 'ध्यान क्षेत्र' },
  medium: { tone: 'info', en: 'Review', hi: 'समीक्षा' },
};
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const masteryBandLabel = (k: MasteryBand, isHi: boolean) => (isHi ? MASTERY_BAND_LABELS[k].hi : MASTERY_BAND_LABELS[k].en);

function formatDate(d: Date | string | null): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── Score Trend Sparkline — Recharts LineChart via admin-ui ── */
function ScoreTrendSparkline({ datapoints, isHi }: { datapoints: ScoreHistoryRow[]; isHi: boolean }) {
  if (!datapoints || datapoints.length < 2) {
    return (
      <span className="text-fluid-2xs text-muted-foreground">
        {isHi ? 'अभी तक ट्रेंड नहीं' : 'No trend yet'}
      </span>
    );
  }

  const sorted = [...datapoints].sort((a, b) =>
    new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );
  const recent = sorted.slice(-4);
  const first = recent[0].score;
  const last = recent[recent.length - 1].score;
  const delta = Math.round(last - first);
  const isUp = delta > 0;
  const isFlat = delta === 0;
  const deltaColor = isUp ? 'var(--success)' : isFlat ? 'var(--text-3)' : 'var(--danger)';

  const seriesName = isHi ? 'अंक' : 'Score';
  const series = [{
    name: seriesName,
    data: recent.map((d) => ({
      x: new Date(d.recorded_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      y: d.score,
    })),
  }];

  return (
    <div className="flex items-center gap-2">
      <div className="w-[120px]" style={{ minHeight: 80 }}>
        <LineChart
          series={series}
          height={80}
          emptyLabel={isHi ? 'अभी तक कोई क्विज़ नहीं' : 'No quizzes yet'}
        />
      </div>
      <span className="text-fluid-2xs font-semibold tabular-nums" style={{ color: deltaColor }}>
        {isUp ? '+' : ''}{delta}
      </span>
    </div>
  );
}

/* ── Bloom Mastery grid (Phase 0 fix) ──
   Mastery shown as an ALWAYS-VISIBLE number + Bloom label + non-colour band
   glyph + a determinate bar — never opacity-encoded, never hover-only. Fully
   touch-accessible + glanceable (WCAG 1.4.1). Underlying data unchanged. */
function BloomMasteryGrid({ data, isHi }: { data: Array<{ bloom_level: BloomLevel; mastery: number }>; isHi: boolean }) {
  const masteryByLevel: Record<BloomLevel, number[]> = {
    remember: [], understand: [], apply: [], analyze: [], evaluate: [], create: [],
  };
  for (const row of data) {
    if (masteryByLevel[row.bloom_level]) masteryByLevel[row.bloom_level].push(row.mastery ?? 0);
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {BLOOM_LEVELS.map((level) => {
        const values = masteryByLevel[level];
        const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        const pct = Math.round(avg * 100);
        const band = bandForValue(pct);
        const cfg = BLOOM_CONFIG[level];
        const label = isHi ? cfg.labelHi : cfg.label;
        return (
          <div key={level} className="min-w-0 rounded-lg border border-surface-3 bg-surface-1 p-2">
            <div className="truncate text-fluid-2xs font-semibold text-muted-foreground">{label}</div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-fluid-base font-bold tabular-nums text-foreground">{pct}%</span>
              <span aria-hidden="true" className="text-fluid-2xs" style={{ color: BAND_VAR[band] }}>
                {BAND_GLYPH[band]}
              </span>
            </div>
            <ProgressBar
              value={pct}
              tone={BAND_TONE[band]}
              size="sm"
              ariaLabel={`${label}: ${pct}%`}
              className="mt-1.5"
            />
          </div>
        );
      })}
    </div>
  );
}

/* ── Cognitive Session Card ── */
function SessionMetricCard({ session, isHi }: { session: CognitiveSessionMetrics; isHi: boolean }) {
  const zpdAcc = session.zpd_accuracy_rate != null ? Math.round(session.zpd_accuracy_rate * 100) : null;
  const dur = session.session_start && session.session_end
    ? Math.round((new Date(session.session_end).getTime() - new Date(session.session_start).getTime()) / 60000)
    : null;
  const totalQ = (session.questions_in_zpd ?? 0) + (session.questions_too_easy ?? 0) + (session.questions_too_hard ?? 0);
  const zpdTone: Tone = zpdAcc == null ? 'neutral' : zpdAcc >= 70 ? 'success' : zpdAcc >= 40 ? 'warning' : 'danger';

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-fluid-xs font-semibold text-foreground">
          {totalQ} {isHi ? 'प्रश्न' : 'questions'}
        </span>
        <div className="flex items-center gap-2">
          {session.fatigue_detected && (
            <Badge tone="danger">{isHi ? 'थकान' : 'Low energy'}</Badge>
          )}
          {dur != null && <span className="text-fluid-2xs text-muted-foreground">{dur}m</span>}
        </div>
      </div>

      {zpdAcc != null && (
        <ProgressBar
          value={zpdAcc}
          tone={zpdTone}
          size="sm"
          label={isHi ? 'सही स्तर पर सटीकता' : 'Right-level accuracy'}
          showValue
          className="mb-2"
        />
      )}

      {totalQ > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {session.questions_in_zpd ? (
            <Badge tone="success">{isHi ? 'सही स्तर' : 'In zone'}: {session.questions_in_zpd}</Badge>
          ) : null}
          {session.questions_too_easy ? (
            <Badge tone="info">{isHi ? 'आसान' : 'Too easy'}: {session.questions_too_easy}</Badge>
          ) : null}
          {session.questions_too_hard ? (
            <Badge tone="danger">{isHi ? 'कठिन' : 'Too hard'}: {session.questions_too_hard}</Badge>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/* ── My Pulse (student self lens) ── */
function MyPulseSection({ isHi, snapshot }: { isHi: boolean; snapshot: StudentSnapshot | null }) {
  const { data, error, isLoading, mutate } = useMyPulse();
  const level = snapshot?.total_xp != null ? calculateLevel(snapshot.total_xp) : null;
  return (
    <div>
      <SectionHeader icon="🩺">{isHi ? 'मेरा पल्स' : 'My Pulse'}</SectionHeader>
      <StudentPulse
        variant="student"
        isHi={isHi}
        pulse={data}
        isLoading={isLoading}
        error={error}
        onRetry={() => mutate()}
        vitals={{
          xp: snapshot?.total_xp ?? null,
          level,
          streakDays: snapshot?.current_streak ?? null,
        }}
      />
    </div>
  );
}

/* =================================================================
   PROGRESS PAGE
   ================================================================= */

export default function ProgressPage() {
  const { can, loading: permsLoading } = usePermissions();
  const { student, snapshot, isLoggedIn, isLoading, isHi, refreshSnapshot } = useAuth();
  const router = useRouter();

  const [profiles, setProfiles] = useState<StudentLearningProfile[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [bloomData, setBloomData] = useState<Record<string, unknown>[]>([]);
  const [velocityData, setVelocityData] = useState<LearningVelocity[]>([]);
  const [knowledgeGaps, setKnowledgeGaps] = useState<KnowledgeGap[]>([]);
  const [sessionMetrics, setSessionMetrics] = useState<CognitiveSessionMetrics[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'cognitive'>('overview');

  // Performance Score state
  const [perfScores, setPerfScores] = useState<PerformanceScoreRow[]>([]);
  const [scoreHistory, setScoreHistory] = useState<ScoreHistoryRow[]>([]);
  const [coinBalance, setCoinBalance] = useState<number>(0);
  const [decayTopics, setDecayTopics] = useState<DecayTopic[]>([]);
  const [perfLoading, setPerfLoading] = useState(true);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  useEffect(() => {
    if (!student) return;
    refreshSnapshot();

    Promise.all([getStudentProfiles(student.id), getSubjects()]).then(([p, s]) => {
      setProfiles(p);
      setSubjects(s);
    });

    getBloomProgression(student.id).then(setBloomData).catch(() => {});
    getLearningVelocity(student.id).then(setVelocityData).catch(() => {});
    getKnowledgeGaps(student.id, undefined, 20).then(setKnowledgeGaps).catch(() => {});

    supabase
      .from('cognitive_session_metrics')
      .select('*')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setSessionMetrics((data as CognitiveSessionMetrics[]) ?? []));

    setPerfLoading(true);
    Promise.all([
      supabase
        .from('performance_scores')
        .select('id, student_id, subject, overall_score, performance_component, behavior_component, level_name, updated_at')
        .eq('student_id', student.id),
      supabase
        .from('score_history')
        .select('id, student_id, subject, score, recorded_at')
        .eq('student_id', student.id)
        .gte('recorded_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('recorded_at', { ascending: true }),
      supabase
        .from('coin_balances')
        .select('balance')
        .eq('student_id', student.id)
        .single(),
      supabase
        .from('concept_mastery')
        .select('id, topic_id, mastery_probability, next_review_at')
        .eq('student_id', student.id)
        .lt('mastery_probability', 0.5)
        .order('mastery_probability', { ascending: true })
        .limit(8),
    ]).then(([perfRes, histRes, coinRes, decayRes]) => {
      setPerfScores((perfRes.data as PerformanceScoreRow[]) ?? []);
      setScoreHistory((histRes.data as ScoreHistoryRow[]) ?? []);
      setCoinBalance(coinRes.data?.balance ?? 0);
      // concept_mastery carries topic_id but NO human topic name. We keep the id
      // for Foxy routing but display a graceful placeholder rather than a raw
      // UUID (or a fabricated "Topic N"). FLAG(backend): join topic_id → a concept
      // name (add topic_name column or a lookup RPC) so a real label can render.
      const decayRaw = decayRes.data ?? [];
      const decayData = decayRaw.map((d: any) => ({
        id: d.id,
        topic_id: d.topic_id,
        topic: '', // no name available — see placeholder in render
        subject: '',
        mastery_probability: d.mastery_probability ?? 0,
        next_review_at: d.next_review_at,
      }));
      setDecayTopics(decayData);
      setPerfLoading(false);
    }).catch(() => {
      setPerfLoading(false);
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on student.id to avoid re-running on object reference changes
  }, [student?.id]);

  if (isLoading || !student) {
    return (
      <div className="mesh-bg min-h-dvh pb-nav">
        <main className="app-container space-y-4 py-6" aria-busy="true" aria-label={isHi ? 'लोड हो रहा है' : 'Loading'}>
          <Skeleton className="h-10 w-40" radius="lg" />
          <Skeleton className="h-40 w-full" radius="lg" />
          <Skeleton className="h-24 w-full" radius="lg" />
        </main>
      </div>
    );
  }

  /* ── Aggregate stats (server values — no client score recompute) ── */
  const totalXp = snapshot?.total_xp ?? profiles.reduce((a, p) => a + (p.xp ?? 0), 0);
  const totalMinutes = profiles.reduce((a, p) => a + (p.total_time_minutes ?? 0), 0);
  const totalSessions = profiles.reduce((a, p) => a + (p.total_sessions ?? 0), 0);
  const totalCorrect = profiles.reduce((a, p) => a + (p.total_questions_answered_correctly ?? 0), 0);
  const totalAsked = profiles.reduce((a, p) => a + (p.total_questions_asked ?? 0), 0);
  const accuracy = calculateScorePercent(totalCorrect, totalAsked);

  const overallPerfScore = perfScores.length > 0
    ? Math.round(perfScores.reduce((a, p) => a + Number(p.overall_score), 0) / perfScores.length)
    : 0;
  const overallLevelName = getLevelFromScore(overallPerfScore);
  const hasPerfScores = perfScores.length > 0;

  const historyBySubject = new Map<string, ScoreHistoryRow[]>();
  for (const row of scoreHistory) {
    if (!historyBySubject.has(row.subject)) historyBySubject.set(row.subject, []);
    historyBySubject.get(row.subject)!.push(row);
  }

  function getPreviousScore(subjectCode: string): number | undefined {
    const hist = historyBySubject.get(subjectCode);
    if (!hist || hist.length < 2) return undefined;
    return Number(hist[0].score);
  }

  const bloomFlattened = bloomData.flatMap((b: Record<string, unknown>) =>
    BLOOM_LEVELS.map((level) => ({
      bloom_level: level as BloomLevel,
      mastery: Number(b[`${level}_mastery`]) || 0,
      subject: (b.subject as string) ?? 'unknown',
    })).filter((item) => item.mastery > 0)
  );

  const weakestTopics = [...velocityData]
    .filter((v) => (v.weekly_mastery_rate ?? 0) > 0)
    .sort((a, b) => (a.weekly_mastery_rate ?? 0) - (b.weekly_mastery_rate ?? 0))
    .slice(0, 3);

  const gapsWithSeverity = knowledgeGaps.map((g) => ({
    ...g,
    severity: (g.confidence_score ?? 0) > 0.7 ? 'critical' : (g.confidence_score ?? 0) > 0.4 ? 'high' : 'medium',
    topic_title: g.target_concept_name,
    description: `Missing: ${g.missing_prerequisite_name}`,
    description_hi: `कमी: ${g.missing_prerequisite_name}`,
  }));
  const gapsBySeverity = [...gapsWithSeverity].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
  );

  const bloomBySubject = new Map<string, Array<{ bloom_level: BloomLevel; mastery: number; subject: string }>>();
  for (const row of bloomFlattened) {
    const subj = row.subject ?? 'unknown';
    if (!bloomBySubject.has(subj)) bloomBySubject.set(subj, []);
    bloomBySubject.get(subj)!.push(row);
  }

  function getSubjectMeta(code: string) {
    return subjects.find((s) => s.code === code);
  }

  const cognitiveEmpty =
    bloomFlattened.length === 0 && velocityData.length === 0 && gapsBySeverity.length === 0 && sessionMetrics.length === 0;

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <IconButton
            variant="ghost"
            size="sm"
            label={isHi ? 'वापस जाएं' : 'Go back'}
            icon={<span aria-hidden="true">←</span>}
            onClick={() => router.push('/dashboard')}
          />
          <h1 className="text-fluid-lg font-bold text-foreground" style={{ fontFamily: 'var(--font-serif)' }}>
            {isHi ? 'प्रगति' : 'Progress'}
          </h1>
          <div className="ml-auto">
            <Link href="/foxy" aria-label={isHi ? 'फॉक्सी कॉइन' : 'Foxy Coins'}>
              <CoinBalance balance={coinBalance} isHi={isHi} />
            </Link>
          </div>
        </div>
      </header>

      <main className="app-container py-6">
        <SectionErrorBoundary section="Progress">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'overview' | 'cognitive')}>
            <TabList aria-label={isHi ? 'प्रगति दृश्य' : 'Progress views'}>
              <Tab value="overview">{isHi ? 'सारांश' : 'Overview'}</Tab>
              <Tab value="cognitive">{isHi ? 'गहन विश्लेषण' : 'Deep Analysis'}</Tab>
            </TabList>

            {/* ═════════ OVERVIEW ═════════ */}
            <TabPanel value="overview" className="space-y-4">
              {can('progress.view_own') && !permsLoading && totalSessions > 0 && (
                <MyPulseSection isHi={isHi} snapshot={snapshot} />
              )}

              {totalSessions === 0 && !hasPerfScores ? (
                <Card className="p-2">
                  <EmptyState
                    icon="📊"
                    title={isHi ? 'तुम्हारी प्रगति यहाँ दिखेगी' : 'Your progress will show up here'}
                    description={
                      isHi
                        ? 'पहला क्विज़ लो और Foxy तुम्हारी सटीकता, स्कोर, और विषय-वार महारत track करेगा।'
                        : 'Take your first quiz and Foxy will track your accuracy, score, and subject-wise mastery.'
                    }
                    action={
                      <div className="flex flex-wrap justify-center gap-3">
                        <Button size="md" onClick={() => router.push('/quiz')}>
                          {isHi ? 'पहला क्विज़ लो' : 'Take First Quiz'}
                        </Button>
                        <Button variant="ghost" size="md" onClick={() => router.push('/foxy')}>
                          {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
                        </Button>
                      </div>
                    }
                  />
                  <div className="mx-3 mb-3 flex flex-col items-center gap-2 rounded-xl bg-surface-2 p-4">
                    <div className="flex items-center gap-4 text-fluid-xs text-muted-foreground">
                      <span>🎯 {isHi ? 'स्कोर' : 'Score'}</span>
                      <span>🔥 {isHi ? 'स्ट्रीक' : 'Streak'}</span>
                      <span>🧠 {isHi ? 'Bloom विश्लेषण' : "Bloom's Analysis"}</span>
                    </div>
                    <p className="text-fluid-xs text-muted-foreground">
                      {isHi ? 'ये सब 1 क्विज़ के बाद unlock होगा' : 'All unlocked after just 1 quiz'}
                    </p>
                  </div>
                </Card>
              ) : (
                <>
                  {/* Performance Score hero */}
                  <Card variant="elevated" className="p-4">
                    {perfLoading ? (
                      <div className="flex flex-col items-center gap-3 py-6">
                        <SkeletonCircle size="lg" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    ) : hasPerfScores ? (
                      <ScoreHero overallScore={overallPerfScore} levelName={overallLevelName} isHi={isHi} />
                    ) : (
                      <div className="flex flex-col items-center text-center">
                        <MasteryRing
                          value={accuracy}
                          size={80}
                          strokeWidth={6}
                          bandLabel={(k) => masteryBandLabel(k, isHi)}
                        />
                        <p className="mt-2 text-fluid-sm font-semibold text-foreground">
                          {isHi ? 'कुल सटीकता' : 'Overall Accuracy'}
                        </p>
                        <p className="mt-1 text-fluid-xs text-muted-foreground">
                          {isHi ? 'Performance Score जल्द ही calculate होगा' : 'Performance Score will be calculated soon'}
                        </p>
                        <Alert
                          tone="info"
                          className="mt-3 w-full text-start"
                          action={
                            <Button size="sm" onClick={() => router.push('/quiz')}>
                              {isHi ? 'अभी क्विज़ लो' : 'Take a quiz now'}
                            </Button>
                          }
                        >
                          {isHi
                            ? 'आपके विस्तृत आँकड़े प्रतिदिन अपडेट होते हैं। आज की activity कल यहाँ दिखेगी।'
                            : "Your detailed stats update daily. Today's activity will show here tomorrow."}
                        </Alert>
                      </div>
                    )}
                  </Card>

                  {/* Subject Performance Scores */}
                  {hasPerfScores && (
                    <div>
                      <SectionHeader icon="📊">
                        {isHi ? 'विषयवार Performance Score' : 'Subject Performance Scores'}
                      </SectionHeader>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {perfScores.map((ps) => {
                          const meta = getSubjectMeta(ps.subject);
                          const hist = historyBySubject.get(ps.subject);
                          return (
                            <div key={ps.id} className="space-y-1">
                              <ScoreCard
                                subject={meta?.name ?? ps.subject}
                                subjectHi={meta?.name_hi ?? meta?.name ?? ps.subject}
                                score={Number(ps.overall_score)}
                                previousScore={getPreviousScore(ps.subject) != null ? getPreviousScore(ps.subject) : undefined}
                                isHi={isHi}
                              />
                              {hist && hist.length >= 2 && (
                                <div className="flex items-center gap-2 px-2">
                                  <span className="text-fluid-2xs text-muted-foreground">
                                    {isHi ? '30 दिन का ट्रेंड' : '30-day trend'}
                                  </span>
                                  <ScoreTrendSparkline datapoints={hist} isHi={isHi} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Topics that need revision (decay) — supportive framing */}
                  {decayTopics.length > 0 && (
                    <div>
                      <SectionHeader icon="🔄">
                        {isHi ? 'जिन विषयों को revision की ज़रूरत है' : 'Topics that need revision'}
                      </SectionHeader>
                      <div className="space-y-2">
                        {decayTopics.map((dt) => {
                          const retentionPct = Math.round((dt.mastery_probability ?? 0) * 100);
                          const tone: Tone = retentionPct < 30 ? 'danger' : 'warning';
                          // Graceful placeholder — never a raw UUID or fabricated name.
                          const label = dt.topic || (isHi ? 'पुनरावलोकन योग्य विषय' : 'A topic to revise');
                          return (
                            <Card key={dt.id} className="p-3">
                              <div className="flex items-center gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-fluid-sm font-semibold text-foreground">{label}</div>
                                  <ProgressBar
                                    value={retentionPct}
                                    tone={tone}
                                    size="sm"
                                    label={isHi ? 'याद' : 'Retained'}
                                    showValue
                                    className="mt-1.5"
                                  />
                                </div>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="shrink-0"
                                  onClick={() => {
                                    const foxyUrl = dt.topic
                                      ? `/foxy?topic=${encodeURIComponent(dt.topic)}`
                                      : dt.topic_id
                                        ? `/foxy?topic_id=${encodeURIComponent(dt.topic_id)}`
                                        : '/foxy';
                                    router.push(foxyUrl);
                                  }}
                                >
                                  {isHi ? 'अभी revision करो' : 'Revise Now'}
                                </Button>
                              </div>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Subject Mastery — accuracy rings + growth-mindset band */}
                  <div>
                    <SectionHeader icon="📚">{isHi ? 'विषयवार महारत' : 'Subject Mastery'}</SectionHeader>
                    {profiles.length === 0 ? (
                      <Card className="p-2">
                        <EmptyState
                          compact
                          icon="📚"
                          title={isHi ? 'और quiz दो' : 'Take more quizzes'}
                          description={isHi ? 'ताकि विषयवार प्रगति दिखे' : 'to see subject-wise progress'}
                        />
                      </Card>
                    ) : (
                      <div className="space-y-2">
                        {profiles.map((p) => {
                          const meta = subjects.find((s: { code: string }) => s.code === p.subject);
                          const correctPct = calculateScorePercent(p.total_questions_answered_correctly, p.total_questions_asked);
                          const band = bandForValue(correctPct);
                          return (
                            <Card key={p.id} className="flex items-center gap-3 p-3">
                              <MasteryRing
                                value={correctPct}
                                size={48}
                                strokeWidth={4}
                                showLabel={false}
                                bandLabel={(k) => masteryBandLabel(k, isHi)}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span aria-hidden="true">{meta?.icon ?? '📚'}</span>
                                  <span className="truncate text-fluid-sm font-semibold text-foreground">
                                    {isHi ? (meta?.name_hi ?? meta?.name ?? p.subject) : (meta?.name ?? p.subject)}
                                  </span>
                                </div>
                                <div className="text-fluid-xs text-muted-foreground">
                                  {correctPct}% {isHi ? 'सटीकता' : 'accuracy'} · {p.total_sessions} {isHi ? 'सत्र' : 'sessions'}
                                </div>
                              </div>
                              <Badge tone={BAND_TONE[band]} icon={<span>{BAND_GLYPH[band]}</span>}>
                                {bandLabelForValue(correctPct, isHi)}
                              </Badge>
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
                          const predicted = v.predicted_mastery_date ? new Date(v.predicted_mastery_date) : predictMasteryDate(rate, rate);
                          return (
                            <Card key={v.id} className="p-3">
                              <div className="flex items-center gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-fluid-sm font-semibold text-foreground">{v.subject}</div>
                                  <div className="text-fluid-2xs text-muted-foreground">
                                    {isHi ? 'गति' : 'Rate'}: {(rate * 100).toFixed(1)}%/wk
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-fluid-2xs text-muted-foreground">
                                    {isHi ? 'अनुमानित तिथि' : 'Predicted by'}
                                  </div>
                                  <div className="text-fluid-xs font-semibold" style={{ color: 'var(--info)' }}>
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

                  {/* XP Summary */}
                  {totalXp > 0 && (
                    <div>
                      <SectionHeader icon="⭐">{isHi ? 'XP सारांश' : 'XP Summary'}</SectionHeader>
                      <Card className="p-3">
                        <div className="grid grid-cols-3 gap-3 text-center">
                          <div>
                            <div className="text-fluid-lg font-bold tabular-nums" style={{ color: 'var(--xp-color)' }}>
                              {totalXp.toLocaleString()}
                            </div>
                            <div className="text-fluid-2xs text-muted-foreground">{isHi ? 'कुल XP' : 'Total XP'}</div>
                          </div>
                          <div>
                            <div className="text-fluid-lg font-bold tabular-nums text-foreground">{totalMinutes}m</div>
                            <div className="text-fluid-2xs text-muted-foreground">{isHi ? 'पढ़ाई का समय' : 'Study Time'}</div>
                          </div>
                          <div>
                            <div className="text-fluid-lg font-bold tabular-nums text-foreground">{totalSessions}</div>
                            <div className="text-fluid-2xs text-muted-foreground">{isHi ? 'सत्र' : 'Sessions'}</div>
                          </div>
                        </div>
                      </Card>
                    </div>
                  )}
                </>
              )}

              {/* NEP Holistic Progress Card link */}
              {totalSessions > 0 && (
                <Card variant="interactive" onClick={() => router.push('/hpc')} className="flex items-center gap-3 p-4">
                  <span aria-hidden="true" className="text-fluid-2xl">📋</span>
                  <div className="flex-1">
                    <div className="text-fluid-sm font-semibold text-foreground">
                      {isHi ? 'NEP समग्र प्रगति कार्ड' : 'NEP Holistic Progress Card'}
                    </div>
                    <div className="text-fluid-xs text-muted-foreground">
                      {isHi ? 'Bloom, दक्षता, और CBSE तैयारी देखें' : "View Bloom's, competencies, and CBSE readiness"}
                    </div>
                  </div>
                  <span className="text-muted-foreground" aria-hidden="true">→</span>
                </Card>
              )}

              {/* Lab Notebook link */}
              <Card
                variant="interactive"
                onClick={() => router.push(`/lab-notebook/${student.id}`)}
                className="flex items-center gap-3 p-4"
              >
                <span aria-hidden="true" className="text-fluid-2xl">📓</span>
                <div className="flex-1">
                  <div className="text-fluid-sm font-semibold text-foreground">
                    {isHi ? 'मेरी लैब नोटबुक' : 'My Lab Notebook'}
                  </div>
                  <div className="text-fluid-xs text-muted-foreground">
                    {isHi ? 'स्कूल रिकॉर्ड के लिए PDF प्रिंट करें' : 'Print as PDF for school records'}
                  </div>
                </div>
                <span className="text-muted-foreground" aria-hidden="true">→</span>
              </Card>
            </TabPanel>

            {/* ═════════ COGNITIVE ═════════ */}
            <TabPanel value="cognitive" className="space-y-4">
              {/* Bloom Mastery */}
              {bloomFlattened.length > 0 && (
                <div>
                  <SectionHeader icon="🧠">{isHi ? "Bloom's स्तर महारत" : "Bloom's Level Mastery"}</SectionHeader>
                  <Card className="space-y-2 p-3">
                    <div className="text-fluid-xs font-semibold text-foreground">
                      {isHi ? 'सभी विषय (औसत)' : 'All Subjects (avg)'}
                    </div>
                    <BloomMasteryGrid data={bloomFlattened} isHi={isHi} />
                  </Card>
                  {bloomBySubject.size > 1 && (
                    <div className="mt-2 space-y-2">
                      {Array.from(bloomBySubject.entries()).map(([subj, rows]) => {
                        const meta = getSubjectMeta(subj);
                        return (
                          <Card key={subj} className="space-y-2 p-3">
                            <div className="text-fluid-xs font-semibold text-foreground">
                              {isHi ? (meta?.name_hi ?? meta?.name ?? subj) : (meta?.name ?? subj)}
                            </div>
                            <BloomMasteryGrid data={rows} isHi={isHi} />
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Learning Velocity */}
              {velocityData.length > 0 && (
                <div>
                  <SectionHeader icon="🚀">{isHi ? 'सीखने की गति' : 'Learning Velocity'}</SectionHeader>
                  <div className="space-y-2">
                    {velocityData.slice(0, 8).map((v) => {
                      const rate = v.weekly_mastery_rate ?? 0;
                      const predicted = v.predicted_mastery_date ? new Date(v.predicted_mastery_date) : predictMasteryDate(rate, rate);
                      return (
                        <Card key={v.id} className="p-3">
                          <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-fluid-xs font-semibold text-foreground">{v.subject}</div>
                              <div className="text-fluid-2xs text-muted-foreground">
                                {isHi ? 'गति' : 'Rate'}: {(rate * 100).toFixed(1)}%/wk
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-fluid-xs font-bold tabular-nums" style={{ color: 'var(--info)' }}>
                                {Math.round(rate * 100)}%
                              </div>
                              {predicted && (
                                <div className="text-fluid-2xs text-muted-foreground">
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

              {/* Knowledge Gaps — supportive framing */}
              <div>
                <SectionHeader icon="🕳️">{isHi ? 'ज्ञान की कमियाँ' : 'Knowledge Gaps'}</SectionHeader>
                {gapsBySeverity.length === 0 ? (
                  <Card className="p-2">
                    <EmptyState
                      compact
                      icon="✅"
                      title={isHi ? 'कोई ज्ञान की कमी नहीं मिली!' : 'No knowledge gaps detected!'}
                    />
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {gapsBySeverity.map((gap) => {
                      const sev = GAP_SEVERITY[gap.severity ?? 'medium'] ?? GAP_SEVERITY.medium;
                      return (
                        <Card key={gap.id} className="p-3">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex flex-wrap items-center gap-2">
                                <span className="truncate text-fluid-xs font-semibold text-foreground">
                                  {gap.topic_title ?? gap.target_concept_name}
                                </span>
                                <Badge tone={sev.tone}>{isHi ? sev.hi : sev.en}</Badge>
                              </div>
                              <div className="text-fluid-2xs text-muted-foreground">
                                {isHi && gap.description_hi ? gap.description_hi : (gap.description ?? `Missing: ${gap.missing_prerequisite_name}`)}
                              </div>
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="shrink-0"
                              onClick={() => router.push(`/foxy?topic=${encodeURIComponent(gap.topic_title ?? gap.target_concept_name)}`)}
                            >
                              {isHi ? 'अभ्यास करो' : 'Practise'}
                            </Button>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Smart Quiz Sessions */}
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

              {cognitiveEmpty && (
                <Card className="p-2">
                  <EmptyState
                    icon="📈"
                    title={isHi ? 'प्रगति देखने के लिए सीखना शुरू करो' : 'Start learning to see your progress'}
                    description={
                      isHi
                        ? 'कुछ quiz दो, फिर यहाँ analytics दिखेगा!'
                        : 'Take a few quizzes and your cognitive analytics will appear here!'
                    }
                    action={
                      <Button size="sm" onClick={() => router.push('/quiz')}>
                        {isHi ? 'Quiz शुरू करो' : 'Start a Quiz'}
                      </Button>
                    }
                  />
                </Card>
              )}
            </TabPanel>
          </Tabs>
        </SectionErrorBoundary>
      </main>
    </div>
  );
}
