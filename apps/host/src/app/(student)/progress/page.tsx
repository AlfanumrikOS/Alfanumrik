'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { calculateScorePercent } from '@alfanumrik/lib/scoring';
import {
  supabase,
  getStudentProfiles,
  getSubjects,
  getBloomProgression,
  getLearningVelocity,
  getKnowledgeGaps,
} from '@alfanumrik/lib/supabase';
import { logger } from '@alfanumrik/lib/logger';
// NOTE: `predictMasteryDate` is deliberately NOT imported. It is a sound
// function with a (currentMastery, velocity) contract this page could not
// satisfy — it only has a weekly rate — so the page used to pass that rate as
// both arguments and print the meaningless result as a date. Predictions now
// come from the server (`learning_velocity.predicted_mastery_date`) or not
// at all. The engine function itself is unchanged and still used elsewhere.
import { BLOOM_CONFIG, BLOOM_LEVELS, BLOOM_ORDER, getHighestMasteredBloom } from '@alfanumrik/lib/cognitive-engine';
import { getLevelFromScore } from '@alfanumrik/lib/score-config';
import type { BloomLevel, KnowledgeGap, LearningVelocity, CognitiveSessionMetrics, StudentLearningProfile, Subject } from '@alfanumrik/lib/types';
import { Card, Badge, ProgressBar, SectionHeader, StatCard, MasteryRing, LoadingFoxy, Button, EmptyState, PremiumCard, GlowButton } from '@alfanumrik/ui/ui';
import { LineChart } from '@alfanumrik/ui/admin-ui';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import ScoreHero from '@alfanumrik/ui/score/ScoreHero';
import ScoreCard from '@alfanumrik/ui/score/ScoreCard';
import CoinBalance from '@alfanumrik/ui/coins/CoinBalance';
import { usePermissions } from '@alfanumrik/lib/usePermissions';
import { useMyPulse } from '@alfanumrik/lib/pulse/use-pulse';
import { StudentPulse } from '@alfanumrik/ui/pulse';
import { calculateLevel } from '@alfanumrik/lib/xp-config';
import type { StudentSnapshot } from '@alfanumrik/lib/types';

/* ── Types for new Performance Score data ── */
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

/* ── Per-source load tracking ──────────────────────────────────────────────
 * Every data source on this page is settled INDEPENDENTLY and records whether
 * it failed, so the render can tell "the request failed" apart from "the
 * request succeeded and there is genuinely nothing here". Before this, all
 * four cognitive sources were fetched with `.catch(() => {})` and the
 * Performance-Score block with `.catch(() => setPerfLoading(false))` — a 500
 * rendered IDENTICALLY to a real empty result, so a student whose request had
 * failed was told "No knowledge gaps detected!".
 *
 * The five queries this page used to inline (student_learning_profiles,
 * subjects, get_bloom_progression, learning_velocity, get_knowledge_gaps) are
 * back on the shared `@alfanumrik/lib/supabase` helpers: those helpers now
 * return `ServiceResult` instead of swallowing the PostgREST error into an
 * ambiguous `[]`, so there is exactly one copy of each query shape again.
 * cognitive_session_metrics + the Performance-Score block have no shared
 * helper and still read `error` off the query directly. */
type ProgressSource = 'core' | 'bloom' | 'velocity' | 'gaps' | 'sessions' | 'perf';

const NO_LOAD_ERRORS: Record<ProgressSource, boolean> = {
  core: false, bloom: false, velocity: false, gaps: false, sessions: false, perf: false,
};

/* ── Helpers ── */
const SEVERITY_COLORS: Record<string, string> = {
  critical: 'var(--red)',
  high: 'var(--gold)',
  medium: 'var(--teal)',
  low: 'var(--text-3)',
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function formatDate(d: Date | string | null): string {
  if (!d) return '---';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── Score Trend Sparkline — Recharts LineChart via admin-ui (Plan 4 Task 6) ── */
function ScoreTrendSparkline({ datapoints, isHi }: { datapoints: ScoreHistoryRow[]; isHi: boolean }) {
  if (!datapoints || datapoints.length < 2) {
    return (
      <span className="text-[10px] text-[var(--text-3)]">
        {isHi ? 'अभी तक ट्रेंड नहीं' : 'No trend yet'}
      </span>
    );
  }

  const sorted = [...datapoints].sort((a, b) =>
    new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );
  // Take last 4 data points for a compact visualization
  const recent = sorted.slice(-4);
  const first = recent[0].score;
  const last = recent[recent.length - 1].score;
  const delta = Math.round(last - first);
  const isUp = delta > 0;
  const isFlat = delta === 0;
  const deltaColor = isUp ? 'var(--green)' : isFlat ? 'var(--text-3)' : 'var(--red)';

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
      <span className="text-[10px] font-semibold" style={{ color: deltaColor }}>
        {isUp ? '+' : ''}{delta}
      </span>
    </div>
  );
}

/* ── Bloom Mastery Heatmap for a single subject ──
 * Assessment-owned honesty floor (spec §5.4): a percentage over fewer than
 * N=5 observations is suppressed — the cell shows the observation count and
 * the tooltip marks it "provisional" instead of fabricating a confidence. */
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

  const MIN_OBSERVATIONS = 5;

  return (
    <div className="flex gap-1 items-center w-full">
      {BLOOM_LEVELS.map((level) => {
        const values = masteryByLevel[level];
        const count = values.length;
        const avg = count > 0 ? values.reduce((a, b) => a + b, 0) / count : 0;
        const hasEvidence = count >= MIN_OBSERVATIONS;
        const cfg = BLOOM_CONFIG[level];
        const opacity = count > 0 ? Math.max(0.1, avg) : 0.08;
        const title =
          `${isHi ? cfg.labelHi : cfg.label}: ` +
          (count === 0
            ? isHi ? 'कोई डेटा नहीं' : 'no data'
            : hasEvidence
              ? `${Math.round(avg * 100)}% · ${count} ${isHi ? 'प्रश्न' : 'questions'}`
              : isHi ? `${count} प्रश्न (प्रारंभिक)` : `${count} questions (provisional)`);
        const cell = hasEvidence
          ? `${Math.round(avg * 100)}%`
          : count > 0
            ? `${count}`
            : '—';
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
            title={title}
          >
            <div className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity">
              {cell}
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
    <PremiumCard className="!p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-[var(--text-2)]">
          {(session.questions_in_zpd ?? 0) + (session.questions_too_easy ?? 0) + (session.questions_too_hard ?? 0)} {isHi ? 'प्रश्न' : 'questions'}
        </span>
        <div className="flex items-center gap-2">
          {session.fatigue_detected && (
            <Badge color="var(--red)" size="sm">{isHi ? 'थकान' : 'Low Energy'}</Badge>
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
                background: zpdAcc >= 70 ? 'var(--green)' : zpdAcc >= 40 ? 'var(--accent-warm)' : 'var(--red)',
              }}
            />
          </div>
        </div>
      )}

      {/* ZPD Distribution */}
      {(session.questions_in_zpd ?? 0) + (session.questions_too_easy ?? 0) + (session.questions_too_hard ?? 0) > 0 && (
        <div className="flex gap-0.5">
          {session.questions_in_zpd ? <div className="rounded-sm text-center text-[9px] font-bold text-foreground px-1" style={{ background: 'var(--green)', minWidth: 16 }} title={`In ZPD: ${session.questions_in_zpd}`}>{session.questions_in_zpd}</div> : null}
          {session.questions_too_easy ? <div className="rounded-sm text-center text-[9px] font-bold text-foreground px-1" style={{ background: 'var(--teal)', minWidth: 16 }} title={`Too Easy: ${session.questions_too_easy}`}>{session.questions_too_easy}</div> : null}
          {session.questions_too_hard ? <div className="rounded-sm text-center text-[9px] font-bold text-white px-1" style={{ background: 'var(--red)', minWidth: 16 }} title={`Too Hard: ${session.questions_too_hard}`}>{session.questions_too_hard}</div> : null}
        </div>
      )}
    </PremiumCard>
  );
}

/* ── My Pulse (student self lens) ──
 * Self-contained section: always calls useMyPulse() (hook order safe) but the
 * PARENT only mounts it when can('progress.view_own') is true. usePermissions is
 * UX-only; the /api/pulse/me route enforces P9 server-side. */
function MyPulseSection({
  isHi,
  snapshot,
}: {
  isHi: boolean;
  snapshot: StudentSnapshot | null;
}) {
  const { data, error, isLoading, mutate } = useMyPulse();
  const level =
    snapshot?.total_xp != null ? calculateLevel(snapshot.total_xp) : null;
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

/* ── Honest data-failure state ─────────────────────────────────────────────
 * Rendered INSTEAD of (never alongside) the reassuring empty state whenever a
 * source failed to load. It deliberately asserts no number: it says the
 * request failed, reassures the student their progress is not lost, and gives
 * a retry. Bilingual per P7. Kept visually distinct from every empty state on
 * this page (📡 + "Retry" vs ✅/📊 + a learning CTA). */
function DataErrorBody({
  isHi,
  titleEn,
  titleHi,
  onRetry,
}: {
  isHi: boolean;
  titleEn: string;
  titleHi: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert">
      <div className="text-2xl mb-1" aria-hidden="true">📡</div>
      <p className="text-sm font-semibold text-[var(--text-2)] mb-1">
        {isHi ? titleHi : titleEn}
      </p>
      <p className="text-xs text-[var(--text-3)] mb-3 max-w-xs mx-auto leading-relaxed">
        {isHi
          ? 'तुम्हारी प्रगति सुरक्षित है — सिर्फ़ connection टूटा है। फिर से कोशिश करो।'
          : 'Your progress is safe — only the connection failed. Please try again.'}
      </p>
      {/* min-h/min-w pinned locally (not via `size`): the shared Button's
          `sm` size is px-3 py-2.5, which lays out at 42px — under the 44px
          touch target this repo requires (WCAG 2.5.8), as measured at all
          nine viewports by e2e/ui-error-states.spec.ts. Fixing it here rather
          than widening Button's `sm` keeps the change contained to this
          recovery control instead of reflowing every `size="sm"` button in
          the app. Mirrors the sibling DataStaleNotice below, which already
          pins the same two classes. inline-flex centres the label inside the
          enlarged box so the extra height is padding, not dead space. */}
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
  );
}

function DataErrorCard(props: { isHi: boolean; titleEn: string; titleHi: string; onRetry: () => void }) {
  return (
    <Card className="!p-4 text-center">
      <DataErrorBody {...props} />
    </Card>
  );
}

/* ── Not-yet-known placeholder ──
 * Shown while a source is still in flight, so the page never shows a
 * reassuring empty (or a zero) for data it hasn't received yet.
 *
 * a11y (WCAG 2.2 AA, 4.1.3 Status Messages): the shimmer alone is invisible to
 * a screen reader, so the wrapper carries role="status" (implicit
 * aria-live="polite" + aria-atomic="true") and aria-busy so the pending state
 * is ANNOUNCED rather than silent. Mirrors the sibling DataErrorCard's
 * role="alert". The announced content is the static bilingual label — it is
 * fixed for the lifetime of the mount, so this announces exactly once and
 * cannot re-fire on re-render. The shimmer bar stays aria-hidden so it never
 * contributes an empty second announcement. */
function DataPendingCard({ isHi, label, labelHi }: { isHi: boolean; label: string; labelHi: string }) {
  return (
    <Card className="!p-4 text-center">
      <div role="status" aria-busy="true">
        <div
          className="h-3 w-40 rounded animate-pulse mx-auto"
          style={{ background: 'var(--surface-2)' }}
          aria-hidden="true"
        />
        <div className="text-xs text-[var(--text-3)] mt-2">{isHi ? labelHi : label}</div>
      </div>
    </Card>
  );
}

/* ── Stale-but-valid notice (failed REFRESH, not failed initial load) ──
 * Deliberately NOT a DataErrorCard. The error card REPLACES a surface that has
 * no good data behind it; this one sits ALONGSIDE last-known-good data whose
 * refresh failed, so a student keeps reading numbers that were valid when they
 * were fetched instead of losing them to an error card. It asserts no number of
 * its own and never claims the data is current. Bilingual per P7; role="status"
 * (not "alert") because nothing on screen became wrong — it just stopped being
 * fresh. Retry control meets the 44px touch target. */
function DataStaleNotice({ isHi, onRetry }: { isHi: boolean; onRetry: () => void }) {
  return (
    <div
      role="status"
      className="mt-3 flex items-center gap-2 rounded-xl px-3 py-1 text-left"
      style={{ background: 'var(--surface-2)' }}
    >
      <span aria-hidden="true">⚠️</span>
      <span className="flex-1 text-[11px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
        {isHi
          ? 'ताज़ा नहीं हो सका — पिछली बार का सुरक्षित डेटा दिख रहा है।'
          : "Couldn't refresh — showing your last saved data."}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 min-h-[44px] min-w-[44px] px-3 rounded-lg text-xs font-semibold"
        style={{ color: 'var(--accent-warm)' }}
      >
        🔄 {isHi ? 'फिर से ताज़ा करो' : 'Refresh'}
      </button>
    </div>
  );
}

/* =================================================================
   PROGRESS PAGE -- Performance Score System + Cognitive Analytics
   ================================================================= */

function LegacyProgressPage() {
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
  // null = not known yet (loading or failed). A failed coin fetch must not
  // render a confident "0 coins" — P-invariant of this page: never show a
  // number we can't stand behind.
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [decayTopics, setDecayTopics] = useState<DecayTopic[]>([]);
  const [perfLoading, setPerfLoading] = useState(true);
  // Has the Performance-Score block EVER settled successfully? This is what
  // separates "the first load failed — there is nothing good to show, so show
  // the honest error card" from "a refresh failed after an earlier success —
  // the data already on screen is stale but still valid, so keep it and add a
  // non-destructive notice". Latches true; a later failure never un-sets it.
  const [perfLoadedOnce, setPerfLoadedOnce] = useState(false);

  // Load state per source (see NO_LOAD_ERRORS above for why this exists).
  const [loadErrors, setLoadErrors] = useState<Record<ProgressSource, boolean>>(NO_LOAD_ERRORS);
  const [coreLoading, setCoreLoading] = useState(true);
  const [cognitiveLoading, setCognitiveLoading] = useState(true);

  /** Record the outcome of one source. Pass a failure to mark it failed. */
  const settleSource = useCallback((source: ProgressSource, failure?: unknown) => {
    const failed = failure != null;
    if (failed) {
      // Structured + PII-redacted (P13). Message only — never the student id,
      // and never the row payload.
      logger.warn('progress: data source failed to load', {
        source,
        reason:
          failure instanceof Error
            ? failure.message
            : String((failure as { message?: string })?.message ?? 'unknown error'),
      });
    }
    setLoadErrors((prev) => (prev[source] === failed ? prev : { ...prev, [source]: failed }));
  }, []);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  // The learner-loop resolver's month-end action emits `?view=synthesis` on
  // this route (a legacy deep-link shape) to point students at the Monthly
  // Synthesis ritual. That surface now lives at its own route, so redirect
  // rather than silently no-op on an unhandled query param.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('view') === 'synthesis') {
      router.replace('/synthesis');
    }
  }, [router]);

  /* ── Loaders (one per source, each independently retryable) ───────────── */

  // Core: subject profiles + subject metadata. Drives XP, accuracy, session
  // counts and the first-run empty state — so a failure here MUST NOT fall
  // through to "Your progress will show up here".
  const loadCore = useCallback(async (studentId: string) => {
    setCoreLoading(true);
    try {
      const [profileRes, subjectRes] = await Promise.all([
        getStudentProfiles(studentId),
        getSubjects(),
      ]);
      if (!profileRes.ok) { settleSource('core', new Error(profileRes.error)); return; }
      if (!subjectRes.ok) { settleSource('core', new Error(subjectRes.error)); return; }
      setProfiles(profileRes.data as StudentLearningProfile[]);
      setSubjects(subjectRes.data as Subject[]);
      settleSource('core');
    } catch (e) {
      settleSource('core', e ?? new Error('core load failed'));
    } finally {
      setCoreLoading(false);
    }
  }, [settleSource]);

  const loadBloom = useCallback(async (studentId: string) => {
    try {
      const res = await getBloomProgression(studentId);
      if (!res.ok) { settleSource('bloom', new Error(res.error)); return; }
      setBloomData(res.data as Record<string, unknown>[]);
      settleSource('bloom');
    } catch (e) {
      settleSource('bloom', e ?? new Error('bloom load failed'));
    }
  }, [settleSource]);

  const loadVelocity = useCallback(async (studentId: string) => {
    try {
      const res = await getLearningVelocity(studentId);
      if (!res.ok) { settleSource('velocity', new Error(res.error)); return; }
      setVelocityData(res.data as LearningVelocity[]);
      settleSource('velocity');
    } catch (e) {
      settleSource('velocity', e ?? new Error('velocity load failed'));
    }
  }, [settleSource]);

  // Gaps: the highest-stakes source on this page. Its empty state is the
  // reassuring "No knowledge gaps detected!" — telling a student that after a
  // FAILED request is the exact defect this page is being repaired for.
  // `limit` stays 20 — it is the page's existing page-size, not a new number.
  const loadGaps = useCallback(async (studentId: string) => {
    try {
      const res = await getKnowledgeGaps(studentId, undefined, 20);
      if (!res.ok) { settleSource('gaps', new Error(res.error)); return; }
      setKnowledgeGaps(res.data as KnowledgeGap[]);
      settleSource('gaps');
    } catch (e) {
      settleSource('gaps', e ?? new Error('gaps load failed'));
    }
  }, [settleSource]);

  const loadSessions = useCallback(async (studentId: string) => {
    try {
      const { data, error } = await supabase
        .from('cognitive_session_metrics')
        .select('*')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) { settleSource('sessions', error); return; }
      setSessionMetrics((data as CognitiveSessionMetrics[]) ?? []);
      settleSource('sessions');
    } catch (e) {
      settleSource('sessions', e ?? new Error('sessions load failed'));
    }
  }, [settleSource]);

  const loadCognitive = useCallback(async (studentId: string) => {
    setCognitiveLoading(true);
    await Promise.all([
      loadBloom(studentId),
      loadVelocity(studentId),
      loadGaps(studentId),
      loadSessions(studentId),
    ]);
    setCognitiveLoading(false);
  }, [loadBloom, loadVelocity, loadGaps, loadSessions]);

  const loadPerf = useCallback(async (studentId: string) => {
    setPerfLoading(true);
    try {
      const [perfRes, histRes, coinRes, decayRes] = await Promise.all([
        // Fetch performance_scores for this student
        supabase
          .from('performance_scores')
          .select('id, student_id, subject, overall_score, performance_component, behavior_component, level_name, updated_at')
          .eq('student_id', studentId),
        // Fetch score_history for the last 30 days
        supabase
          .from('score_history')
          .select('id, student_id, subject, score, recorded_at')
          .eq('student_id', studentId)
          .gte('recorded_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
          .order('recorded_at', { ascending: true }),
        // Fetch coin balance
        supabase
          .from('coin_balances')
          .select('balance')
          .eq('student_id', studentId)
          .single(),
        // Fetch decaying topics (concept_mastery with low mastery_probability and overdue review)
        supabase
          .from('concept_mastery')
          .select('id, topic_id, mastery_probability, next_review_at')
          .eq('student_id', studentId)
          .lt('mastery_probability', 0.5)
          .order('mastery_probability', { ascending: true })
          .limit(8),
      ]);

      // PGRST116 = ".single() matched no rows". For coin_balances that is the
      // legitimate "no balance row yet" case (= 0 coins), NOT a failure.
      const coinMissingRow = coinRes.error?.code === 'PGRST116';
      const failure =
        perfRes.error ?? histRes.error ?? (coinMissingRow ? null : coinRes.error) ?? decayRes.error;
      // On failure every setter below is skipped, so the last-known-good
      // perfScores / scoreHistory / coinBalance / decayTopics survive in state.
      // Whether the render KEEPS them or falls back to the error card is
      // decided by `perfLoadedOnce` (see the render gates further down).
      if (failure) { settleSource('perf', failure); return; }

      setPerfScores((perfRes.data as PerformanceScoreRow[]) ?? []);
      setScoreHistory((histRes.data as ScoreHistoryRow[]) ?? []);
      setCoinBalance(coinRes.data?.balance ?? 0);
      // Map decay data — concept_mastery rows have topic_id but no topic name.
      // The display label is a human-readable "Topic N" fallback; the actual Foxy
      // route always uses topic_id when available so it carries a real identifier.
      // TODO(data-gap): add topic_name to concept_mastery or join via a lookup RPC
      // so the displayed label can show the real concept name.
      const decayRaw = decayRes.data ?? [];
      const decayData = decayRaw.map((d: any) => {
        // topic_id is a UUID — show first 8 chars as a readable chip.
        const shortId = d.topic_id ? `${String(d.topic_id).substring(0, 8)}…` : '—';
        return {
          id: d.id,
          topic_id: d.topic_id,
          topic: shortId,
          subject: '',
          mastery_probability: d.mastery_probability ?? 0,
          next_review_at: d.next_review_at,
        };
      });
      setDecayTopics(decayData);
      settleSource('perf');
      setPerfLoadedOnce(true);
    } catch (e) {
      settleSource('perf', e ?? new Error('performance load failed'));
    } finally {
      setPerfLoading(false);
    }
  }, [settleSource]);

  useEffect(() => {
    if (!student) return;
    refreshSnapshot();
    loadCore(student.id);
    loadCognitive(student.id);
    loadPerf(student.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on student.id to avoid re-running on object reference changes
  }, [student?.id]);

  if (isLoading || !student) return <LoadingFoxy />;

  /* ── Aggregate stats ── */
  const totalXp = snapshot?.total_xp ?? profiles.reduce((a, p) => a + (p.xp ?? 0), 0);
  const totalMinutes = profiles.reduce((a, p) => a + (p.total_time_minutes ?? 0), 0);
  const totalSessions = profiles.reduce((a, p) => a + (p.total_sessions ?? 0), 0);
  const totalCorrect = profiles.reduce((a, p) => a + (p.total_questions_answered_correctly ?? 0), 0);
  const totalAsked = profiles.reduce((a, p) => a + (p.total_questions_asked ?? 0), 0);
  const accuracy = calculateScorePercent(totalCorrect, totalAsked);

  /* ── Performance Score aggregates ── */
  const overallPerfScore = perfScores.length > 0
    ? Math.round(perfScores.reduce((a, p) => a + Number(p.overall_score), 0) / perfScores.length)
    : 0;
  const overallLevelName = getLevelFromScore(overallPerfScore);
  const hasPerfScores = perfScores.length > 0;

  /* ── Empty-vs-error gates ──
   * A reassuring empty may only render once the source THAT SUMMARISES IT has
   * settled successfully. Otherwise the student gets the honest error card (or
   * the pending placeholder) instead.
   *
   * First-run status is derived from CORE alone. `total_sessions` comes from
   * `student_learning_profiles`, so core is the only source that actually knows
   * whether this student has any quiz history — and by the time this branch
   * renders, core has already settled successfully (the JSX below tries
   * `loadErrors.core` then `coreLoading` first). Gating it on the unrelated
   * `perf` source instead meant (a) a genuinely-new student whose perf fetch
   * FAILED never saw the welcoming first-run card and got the full dashboard
   * rendered at 0%, and (b) a pending→dashboard→first-run flash while perf was
   * still in flight. `hasPerfScores` stays in the condition only as a
   * one-directional safety valve: if perf scores DO exist we must not claim
   * there is no history, and since perfScores can only go []→populated within a
   * mount, the card can never disappear and then reappear. */
  const showFirstRunEmpty = totalSessions === 0 && !hasPerfScores;
  const cognitiveFailed =
    loadErrors.bloom || loadErrors.velocity || loadErrors.gaps || loadErrors.sessions;

  /* ── Performance-Score load state model ──
   * initial-loading  → skeleton (nothing good to show yet)
   * initial-failure  → error card (nothing good to show, ever)
   * refreshing       → keep last-known-good on screen (no destructive skeleton)
   * refresh-failure  → keep last-known-good + non-destructive stale notice
   * settled          → normal render */
  const perfInitialLoading = perfLoading && !perfLoadedOnce;
  const perfInitialFailed = loadErrors.perf && !perfLoadedOnce;
  const perfRefreshFailed = loadErrors.perf && perfLoadedOnce;

  /* ── Score history grouped by subject ── */
  const historyBySubject = new Map<string, ScoreHistoryRow[]>();
  for (const row of scoreHistory) {
    if (!historyBySubject.has(row.subject)) historyBySubject.set(row.subject, []);
    historyBySubject.get(row.subject)!.push(row);
  }

  /* ── Previous score for trend arrows (use oldest point in 30-day history) ── */
  function getPreviousScore(subjectCode: string): number | undefined {
    const hist = historyBySubject.get(subjectCode);
    if (!hist || hist.length < 2) return undefined;
    return Number(hist[0].score);
  }

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

  /* ── Helper to find subject metadata ── */
  function getSubjectMeta(code: string) {
    return subjects.find((s) => s.code === code);
  }

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)] p-2 rounded-lg" aria-label={isHi ? 'वापस जाएं' : 'Go back'}>&larr;</button>
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'प्रगति' : 'Progress'}
          </h1>
          {/* Foxy Coins in header — hidden until the balance is actually known.
              A failed (or in-flight) fetch must not render a confident "0". */}
          {coinBalance != null && (
            <div className="ml-auto">
              <Link href="/foxy">
                <CoinBalance balance={coinBalance} isHi={isHi} />
              </Link>
            </div>
          )}
        </div>
      </header>

      <main className="app-container py-6 space-y-4">
        <SectionErrorBoundary section="Progress">
        {/* ── Tab Switcher (premium pills) ── */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('overview')}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98]"
            style={
              activeTab === 'overview'
                ? {
                    background: 'var(--surface-accent)',
                    color: 'var(--on-surface-accent)',
                    boxShadow: '0 4px 14px rgb(var(--accent-warm-rgb) / 0.30)',
                  }
                : {
                    background: 'var(--surface-2)',
                    color: 'var(--text-3)',
                    border: '1px solid var(--border)',
                  }
            }
          >
            {isHi ? 'सारांश' : 'Overview'}
          </button>
          <button
            onClick={() => setActiveTab('cognitive')}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98]"
            style={
              activeTab === 'cognitive'
                ? {
                    background: 'linear-gradient(135deg, var(--purple), var(--purple-light))',
                    color: '#fff',
                    boxShadow: '0 4px 14px rgb(var(--purple-rgb) / 0.30)',
                  }
                : {
                    background: 'var(--surface-2)',
                    color: 'var(--text-3)',
                    border: '1px solid var(--border)',
                  }
            }
          >
            {isHi ? 'गहन विश्लेषण' : 'Deep Analysis'}
          </button>
        </div>

        {/* ==============================================================
           OVERVIEW TAB -- Performance Scores + Subject Progress
           ============================================================== */}
        {activeTab === 'overview' && (
          <>
            {/* === MY PULSE (student self lens) — gated by progress.view_own (UX only;
                   /api/pulse/me enforces server-side). Shown once the student has
                   any quiz history so the empty-state hero stays the first thing
                   a brand-new learner sees. === */}
            {can('progress.view_own') && !permsLoading && totalSessions > 0 && (
              <MyPulseSection isHi={isHi} snapshot={snapshot} />
            )}

            {/* === CORE LOAD FAILURE ===
                XP, accuracy, session counts and subject mastery are all derived
                from `profiles`. When that fetch fails `profiles` is [] — which
                is indistinguishable from a brand-new student. Rendering the
                first-run empty state (or a 0% accuracy ring) here would be
                telling the student something we do not know, so the error card
                replaces the whole derived block until a retry succeeds. */}
            {loadErrors.core ? (
              <DataErrorCard
                isHi={isHi}
                titleEn="Couldn't load your progress"
                titleHi="तुम्हारी प्रगति लोड नहीं हो सकी"
                onRetry={() => loadCore(student.id)}
              />
            ) : coreLoading ? (
              <DataPendingCard
                isHi={isHi}
                label="Loading your progress…"
                labelHi="तुम्हारी प्रगति लोड हो रही है…"
              />

            /* === EMPTY STATE -- show when student has zero quiz history ===
               Derived from CORE, which has settled successfully by this branch
               and is the only source that knows the session count. It is NOT
               gated on the independent Performance-Score fetch — see the
               `showFirstRunEmpty` comment above. */
            ) : showFirstRunEmpty ? (
              <Card className="!p-6 text-center">
                <div className="text-5xl mb-3">📊</div>
                <h2 className="text-lg font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                  {isHi ? 'तुम्हारी प्रगति यहाँ दिखेगी' : 'Your progress will show up here'}
                </h2>
                <p className="text-sm text-[var(--text-2)] max-w-xs mx-auto leading-relaxed mb-2">
                  {isHi
                    ? 'पहला क्विज़ लो और Foxy तुम्हारी सटीकता, स्कोर, और विषय-वार महारत track करेगा।'
                    : 'Take your first quiz and Foxy will track your accuracy, score, and subject-wise mastery.'}
                </p>
                <div className="flex flex-col items-center gap-3 mt-4 rounded-xl p-4" style={{ background: 'var(--surface-2)' }}>
                  <div className="flex items-center gap-4 text-xs text-[var(--text-3)]">
                    <span>🎯 {isHi ? 'स्कोर' : 'Score'}</span>
                    <span>🔥 {isHi ? 'स्ट्रीक' : 'Streak'}</span>
                    <span>🧠 {isHi ? 'Bloom विश्लेषण' : "Bloom's Analysis"}</span>
                  </div>
                  <p className="text-xs text-[var(--text-3)]">
                    {isHi ? 'ये सब 1 क्विज़ के बाद unlock होगा' : 'All unlocked after just 1 quiz'}
                  </p>
                </div>
                <div className="flex gap-3 mt-5 justify-center">
                  <GlowButton size="md" className="warm-cta" onClick={() => router.push('/quiz')}>
                    {isHi ? 'पहला क्विज़ लो' : 'Take First Quiz'}
                  </GlowButton>
                  <Button variant="ghost" size="md" onClick={() => router.push('/foxy')}>
                    {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
                  </Button>
                </div>
              </Card>
            ) : (
              <>
                {/* ===========================================================
                    PERFORMANCE SCORE HERO -- Overall Score (0-100)
                    =========================================================== */}
                <PremiumCard gradient glow className="warm-cta !p-4">
                  {perfInitialLoading ? (
                    /* INITIAL load only. A refresh must not blank out data the
                       student is already reading, so the skeleton is gated on
                       "we have never had this data" rather than "a request is
                       in flight". */
                    <div className="flex flex-col items-center py-6">
                      <div className="w-20 h-20 rounded-full animate-pulse" style={{ background: 'var(--surface-2)' }} />
                      <div className="w-32 h-4 mt-3 rounded animate-pulse" style={{ background: 'var(--surface-2)' }} />
                    </div>
                  ) : perfInitialFailed ? (
                    /* INITIAL failure — nothing good has ever loaded, so the
                       honest error card is all we can show. Deliberately NOT
                       "your score will be calculated soon": that copy is a
                       promise we can only make once we know the fetch succeeded
                       and there is genuinely no score row.
                       A REFRESH failure takes the branch below instead, keeping
                       the last-known-good numbers on screen. */
                    <div className="text-center py-4">
                      <DataErrorBody
                        isHi={isHi}
                        titleEn="Couldn't load your Performance Score"
                        titleHi="तुम्हारा Performance Score लोड नहीं हो सका"
                        onRetry={() => loadPerf(student.id)}
                      />
                    </div>
                  ) : hasPerfScores ? (
                    <>
                      <ScoreHero
                        overallScore={overallPerfScore}
                        levelName={overallLevelName}
                        isHi={isHi}
                      />
                      {perfRefreshFailed && (
                        <DataStaleNotice isHi={isHi} onRetry={() => loadPerf(student.id)} />
                      )}
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <MasteryRing value={accuracy} size={80} strokeWidth={6}>
                        <div className="text-center">
                          <div className="text-lg font-bold" style={{ color: accuracy >= 70 ? 'var(--green)' : accuracy >= 40 ? 'var(--accent-warm)' : 'var(--red)' }}>{accuracy}%</div>
                        </div>
                      </MasteryRing>
                      <p className="text-sm font-semibold mt-2" style={{ fontFamily: 'var(--font-display)' }}>
                        {isHi ? 'कुल सटीकता' : 'Overall Accuracy'}
                      </p>
                      <p className="text-[10px] text-[var(--text-3)] mt-0.5">
                        {totalCorrect}/{totalAsked} {isHi ? 'सही' : 'correct'}
                      </p>
                      <p className="text-xs text-[var(--text-3)] mt-1">
                        {isHi
                          ? 'Performance Score जल्द ही calculate होगा'
                          : 'Performance Score will be calculated soon'}
                      </p>
                      {/* Honest daily-update notice so students who already quizzed aren't confused */}
                      <div
                        className="mt-3 rounded-xl px-4 py-3 text-xs text-left space-y-1"
                        style={{ background: 'var(--surface-2)' }}
                      >
                        <p style={{ color: 'var(--text-2)' }}>
                          {isHi
                            ? 'आपके विस्तृत आँकड़े प्रतिदिन अपडेट होते हैं। आज की activity कल यहाँ दिखेगी।'
                            : "Your detailed stats update daily. Today's activity will show here tomorrow."}
                        </p>
                        <a
                          href="/quiz"
                          className="inline-block mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-on-accent transition-colors"
                          style={{
                            background: 'var(--accent-warm-strong)',
                            boxShadow: '0 2px 8px rgb(var(--accent-warm-rgb) / 0.28)',
                          }}
                        >
                          {isHi ? 'अभी क्विज़ लो →' : 'Take a quiz now →'}
                        </a>
                      </div>
                      {/* Reached only when an EARLIER perf load succeeded and
                          genuinely returned no score row — that empty result is
                          the last-known-good truth, so it stays; the notice just
                          says the refresh on top of it failed. */}
                      {perfRefreshFailed && (
                        <DataStaleNotice isHi={isHi} onRetry={() => loadPerf(student.id)} />
                      )}
                    </div>
                  )}
                </PremiumCard>

                {/* ===========================================================
                    SUBJECT SCORE CARDS -- ScoreCard per subject
                    =========================================================== */}
                {hasPerfScores && (
                  <div>
                    <SectionHeader icon="📊">
                      {isHi ? 'विषयवार Performance Score' : 'Subject Performance Scores'}
                    </SectionHeader>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                            {/* Score trend sparkline below each card */}
                            {hist && hist.length >= 2 && (
                              <div className="flex items-center gap-2 px-2">
                                <span className="text-[10px] text-[var(--text-3)]">
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

                {/* ===========================================================
                    DECAY ALERTS -- Topics needing revision
                    =========================================================== */}
                {decayTopics.length > 0 && (
                  <div>
                    <SectionHeader icon="🔄">
                      {isHi ? 'जिन विषयों को revision की ज़रूरत है' : 'Topics that need revision'}
                    </SectionHeader>
                    <div className="space-y-2">
                      {decayTopics.map((dt) => {
                        /* `concept_mastery.mastery_probability` is a BKT mastery
                         * POSTERIOR. It was rendered as "<n>% retained", which
                         * relabels a mastery estimate as a memory-retention
                         * measurement the app never took. Same number, honest
                         * name. (Phase 6 / Risk R4.) */
                        const masteryPct = Math.round((dt.mastery_probability ?? 0) * 100);
                        const isLow = masteryPct < 30;
                        return (
                          <PremiumCard key={dt.id} className="!p-3">
                            <div className="flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold truncate">{dt.topic}</div>
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--surface-2)' }}>
                                    <div
                                      className="h-full rounded-full transition-all"
                                      style={{
                                        width: `${masteryPct}%`,
                                        background: isLow ? 'var(--red)' : 'var(--gold)',
                                      }}
                                    />
                                  </div>
                                  <span
                                    className="text-[10px] font-semibold shrink-0"
                                    data-testid="decay-mastery-value"
                                    style={{ color: isLow ? 'var(--red)' : 'var(--gold)' }}
                                  >
                                    {masteryPct}% {isHi ? 'महारत' : 'mastered'}
                                  </span>
                                </div>
                              </div>
                              <Button
                                variant="soft"
                                size="sm"
                                color="var(--accent-warm)"
                                onClick={() => {
                                  // Prefer named topic; fall back to topic_id so Foxy gets a real identifier.
                                  const isFallbackLabel = /^Topic \d+$/.test(dt.topic);
                                  const foxyUrl = (!isFallbackLabel)
                                    ? `/foxy?topic=${encodeURIComponent(dt.topic)}`
                                    : dt.topic_id
                                      ? `/foxy?topic_id=${encodeURIComponent(dt.topic_id)}`
                                      : `/foxy`;
                                  router.push(foxyUrl);
                                }}
                                className="shrink-0"
                              >
                                {isHi ? 'अभी revision करो' : 'Revise Now'}
                              </Button>
                            </div>
                          </PremiumCard>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ===========================================================
                    SUBJECT MASTERY -- rings per subject (existing)
                    =========================================================== */}
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
                        const correctPct = calculateScorePercent(p.total_questions_answered_correctly, p.total_questions_asked);

                        return (
                          <Card key={p.id} className="!p-3 flex items-center gap-3">
                            <MasteryRing value={correctPct} size={48} strokeWidth={4} color={meta?.color}>
                              <span className="text-base">{meta?.icon ?? '📚'}</span>
                            </MasteryRing>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-sm">
                                {isHi ? (meta?.name_hi ?? meta?.name ?? p.subject) : (meta?.name ?? p.subject)}
                              </div>
                              <div className="text-xs text-[var(--text-3)]">
                                {p.total_questions_answered_correctly}/{p.total_questions_asked} ({correctPct}%) · {p.total_sessions} {isHi ? 'सत्र' : 'sessions'}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-bold" style={{ color: meta?.color ?? 'var(--accent-warm)' }}>{correctPct}%</div>
                              <div className="text-[10px] text-[var(--text-3)]">
                                {p.total_questions_answered_correctly}/{p.total_questions_asked}
                              </div>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Mastery Predictions
                    The client no longer manufactures a date. It used to call
                    `predictMasteryDate(rate, rate)` — whose signature is
                    (currentMastery, velocity) — passing the WEEKLY mastery rate
                    as BOTH the current mastery AND the DAILY velocity, so the
                    arithmetic was (0.95 - weeklyRate) / weeklyRate days. The
                    resulting date had no defensible meaning and was printed
                    under "Predicted by". Only `learning_velocity.
                    predicted_mastery_date`, computed server-side, is shown; when
                    the server has none, we say so. (Phase 6 / Risk R4.) */}
                {weakestTopics.length > 0 && (
                  <div>
                    <SectionHeader icon="🔮">{isHi ? 'महारत की भविष्यवाणी' : 'Mastery Predictions'}</SectionHeader>
                    <div className="space-y-2">
                      {weakestTopics.map((v) => {
                        const rate = v.weekly_mastery_rate ?? 0;
                        const predicted = v.predicted_mastery_date
                          ? new Date(v.predicted_mastery_date)
                          : null;

                        return (
                          <PremiumCard key={v.id} className="!p-3">
                            <div className="flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold truncate">{v.subject}</div>
                                <div className="text-[11px] text-[var(--text-3)]">
                                  {isHi ? 'गति' : 'Rate'}: {(rate * 100).toFixed(1)}%/wk
                                </div>
                              </div>
                              <div className="text-right max-w-[45%]">
                                {predicted ? (
                                  <>
                                    <div className="text-[10px] text-[var(--text-3)]">
                                      {isHi ? 'अनुमानित तिथि' : 'Predicted by'}
                                    </div>
                                    <div
                                      className="text-xs font-semibold"
                                      data-testid="mastery-prediction-date"
                                      style={{ color: 'var(--teal)' }}
                                    >
                                      {formatDate(predicted)}
                                    </div>
                                  </>
                                ) : (
                                  <div
                                    className="text-[10px] text-[var(--text-3)] leading-relaxed"
                                    data-testid="mastery-prediction-none"
                                  >
                                    {isHi
                                      ? 'भविष्यवाणी के लिए अभी पर्याप्त डेटा नहीं'
                                      : 'Not enough data to predict yet'}
                                  </div>
                                )}
                              </div>
                            </div>
                          </PremiumCard>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* === LEGACY XP (smaller section at bottom) === */}
                {totalXp > 0 && (
                  <div>
                    <SectionHeader icon="⭐">{isHi ? 'XP सारांश' : 'XP Summary'}</SectionHeader>
                    <PremiumCard className="!p-3">
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                          <div className="text-lg font-bold" style={{ color: 'var(--accent-warm)' }}>{totalXp.toLocaleString()}</div>
                          <div className="text-[10px] text-[var(--text-3)]">{isHi ? 'कुल XP' : 'Total XP'}</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold">{totalMinutes}m</div>
                          <div className="text-[10px] text-[var(--text-3)]">{isHi ? 'पढ़ाई का समय' : 'Study Time'}</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold">{totalSessions}</div>
                          <div className="text-[10px] text-[var(--text-3)]">{isHi ? 'सत्र' : 'Sessions'}</div>
                        </div>
                      </div>
                    </PremiumCard>
                  </div>
                )}
              </>
            )}

            {/* === NEP Holistic Progress Card link === */}
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

            {/* === Lab Notebook link (Tier 3 R13 — print as PDF for school records) === */}
            <Link href={`/lab-notebook/${student.id}`} className="block min-h-[44px]">
              <Card className="!p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
                <span className="text-2xl">📓</span>
                <div className="flex-1">
                  <div className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
                    {isHi ? 'मेरी लैब नोटबुक' : 'My Lab Notebook'}
                  </div>
                  <div className="text-xs text-[var(--text-3)]">
                    {isHi ? 'स्कूल रिकॉर्ड के लिए PDF प्रिंट करें' : 'Print as PDF for school records'}
                  </div>
                </div>
                <span className="text-[var(--text-3)]" aria-hidden="true">&rarr;</span>
              </Card>
            </Link>
          </>
        )}

        {/* ==============================================================
           COGNITIVE TAB -- Bloom Heatmap, Gaps, Velocity, Sessions
           ============================================================== */}
        {activeTab === 'cognitive' && (
          <>
            {/* Bloom Mastery Heatmap — per-subject or aggregated all-subjects */}
            {loadErrors.bloom ? (
              <DataErrorCard
                isHi={isHi}
                titleEn="Couldn't load your Bloom's mastery"
                titleHi="तुम्हारी Bloom's महारत लोड नहीं हो सकी"
                onRetry={() => loadBloom(student.id)}
              />
            ) : bloomFlattened.length > 0 ? (
              <div>
                <SectionHeader icon="🧠">
                  {isHi ? "Bloom's स्तर महारत" : "Bloom's Level Mastery"}
                </SectionHeader>
                {/* All-subjects aggregate row */}
                <Card className="!p-3 space-y-2">
                  <div className="text-xs font-semibold text-[var(--text-2)] mb-1">
                    {isHi ? 'सभी विषय (औसत)' : 'All Subjects (avg)'}
                  </div>
                  <BloomHeatmap data={bloomFlattened} isHi={isHi} />
                  <BloomLegend isHi={isHi} />
                </Card>
                {/* Per-subject breakdown (when more than one subject) */}
                {bloomBySubject.size > 1 && (
                  <div className="space-y-2 mt-2">
                    {Array.from(bloomBySubject.entries()).map(([subj, rows]) => {
                      const meta = getSubjectMeta(subj);
                      return (
                        <Card key={subj} className="!p-3">
                          <div className="text-xs font-semibold text-[var(--text-2)] mb-1">
                            {isHi ? (meta?.name_hi ?? meta?.name ?? subj) : (meta?.name ?? subj)}
                          </div>
                          <BloomHeatmap data={rows} isHi={isHi} />
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            {/* Learning Velocity */}
            {loadErrors.velocity ? (
              <DataErrorCard
                isHi={isHi}
                titleEn="Couldn't load your learning velocity"
                titleHi="तुम्हारी सीखने की गति लोड नहीं हो सकी"
                onRetry={() => loadVelocity(student.id)}
              />
            ) : velocityData.length > 0 ? (
              <div>
                <SectionHeader icon="🚀">{isHi ? 'सीखने की गति' : 'Learning Velocity'}</SectionHeader>
                <div className="space-y-2">
                  {velocityData.slice(0, 8).map((v) => {
                    const rate = v.weekly_mastery_rate ?? 0;
                    /* Server-supplied date only — see the Mastery Predictions
                       note above for why the client-side fallback was removed. */
                    const predicted = v.predicted_mastery_date
                      ? new Date(v.predicted_mastery_date)
                      : null;

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
                              <div className="text-[9px] text-[var(--text-3)]" data-testid="velocity-predicted-date">
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
            ) : null}

            {/* Knowledge Gaps
                THE reassuring empty on this page: "No knowledge gaps detected!"
                is a clean bill of academic health. It may ONLY render when the
                fetch actually succeeded and returned nothing. While in flight →
                pending placeholder; on failure → error card. */}
            <div>
              <SectionHeader icon="🕳️">{isHi ? 'ज्ञान की कमियाँ' : 'Knowledge Gaps'}</SectionHeader>
              {loadErrors.gaps ? (
                <DataErrorCard
                  isHi={isHi}
                  titleEn="Couldn't check your knowledge gaps"
                  titleHi="ज्ञान की कमियाँ जाँची नहीं जा सकीं"
                  onRetry={() => loadGaps(student.id)}
                />
              ) : cognitiveLoading ? (
                <DataPendingCard
                  isHi={isHi}
                  label="Checking your knowledge gaps…"
                  labelHi="ज्ञान की कमियाँ जाँच रहे हैं…"
                />
              ) : gapsBySeverity.length === 0 ? (
                <Card className="!p-4 text-center">
                  <div className="text-2xl mb-1">✅</div>
                  <div className="text-sm text-[var(--text-3)]">
                    {isHi ? 'कोई ज्ञान की कमी नहीं मिली!' : 'No knowledge gaps detected!'}
                  </div>
                </Card>
              ) : (
                <div className="space-y-2">
                  {gapsBySeverity.map((gap) => (
                    <PremiumCard key={gap.id} className="!p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs font-semibold truncate">{gap.topic_title ?? gap.target_concept_name}</span>
                            <Badge color={SEVERITY_COLORS[gap.severity ?? 'medium'] ?? 'var(--text-3)'} size="sm">
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
                          color="var(--accent-warm)"
                          onClick={() => router.push(`/foxy?topic=${encodeURIComponent(gap.topic_title ?? gap.target_concept_name)}`)}
                          className="shrink-0"
                        >
                          {isHi ? 'ठीक करो' : 'Fix'}
                        </Button>
                      </div>
                    </PremiumCard>
                  ))}
                </div>
              )}
            </div>

            {/* Cognitive Session History */}
            {loadErrors.sessions ? (
              <DataErrorCard
                isHi={isHi}
                titleEn="Couldn't load your quiz sessions"
                titleHi="तुम्हारे क्विज़ सत्र लोड नहीं हो सके"
                onRetry={() => loadSessions(student.id)}
              />
            ) : sessionMetrics.length > 0 ? (
              <div>
                <SectionHeader icon="🧠">{isHi ? 'स्मार्ट क्विज़ सत्र' : 'Smart Quiz Sessions'}</SectionHeader>
                <div className="space-y-2">
                  {sessionMetrics.map((s) => (
                    <SessionMetricCard key={s.id} session={s} isHi={isHi} />
                  ))}
                </div>
              </div>
            ) : null}

            {/* Empty state for cognitive tab — only once every cognitive source
                has settled successfully. "Start learning to see your progress"
                told to a student with months of history because four fetches
                failed is the defect this gate exists to prevent. */}
            {!cognitiveLoading && !cognitiveFailed && bloomFlattened.length === 0 && velocityData.length === 0 && gapsBySeverity.length === 0 && sessionMetrics.length === 0 && (
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

    </div>
  );
}

export default function ProgressPage() {
  return <LegacyProgressPage />;
}
