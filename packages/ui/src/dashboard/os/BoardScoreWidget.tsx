'use client';

/**
 * BoardScoreWidget — Predictive Board Exam Score Engine (BoardScore™)
 *
 * Phase 3b rebuild: composed from canonical primitives (Card / Tabs /
 * ProgressRing / ProgressBar / Badge / Alert / EmptyState / Button / Skeleton),
 * token-only. Structure:
 *   - ProgressRing gauge for overall predicted % (across subjects)
 *   - Tabs to switch subject (replaces the bespoke role="tab" buttons)
 *   - ProgressBar for per-subject coverage
 *   - Card rows for the chapter breakdown (icon+label Badge, WCAG 1.4.1)
 *   - Score Recovery Plan + AnswerChecker™ CTA — DEMOTED to non-primary (quiet
 *     list + a secondary Button), so the hero keeps the single primary action.
 *
 * The GET /api/board-score fetch is UNCHANGED (backend contract confirmation is
 * deferred — no SWR migration). ff_board_score_v1 gating + Coming-soon / No-data
 * states are preserved as EmptyState. Bilingual via isHi (P7). Presentation only.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  ProgressRing,
  ProgressBar,
  Badge,
  Alert,
  EmptyState,
  Button,
  Skeleton,
  type Tone,
} from '@alfanumrik/ui/ui/primitives';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ChapterScore {
  chapter_name: string;
  unit_name: string;
  marks_allocated: number;
  max_marks: number;
  mastery_mean: number;
  retention_factor: number;
  effective_mastery: number;
  predicted_marks: number;
  status: 'strong' | 'moderate' | 'weak' | 'critical';
}

interface RecoveryItem {
  chapter_number: number;
  chapter_name: string;
  marks_allocated: number;
  current_predicted_marks: number;
  recoverable_marks: number;
  status: 'strong' | 'moderate' | 'weak' | 'critical';
  action_label: string;
}

interface BoardScorePrediction {
  id: string;
  subject_code: string;
  subject_label: string;
  grade: string;
  score_date: string;
  predicted_score: number;
  max_score: number;
  predicted_pct: number;
  confidence_band_low: number;
  confidence_band_high: number;
  chapter_scores: Record<string, ChapterScore>;
  recovery_plan: RecoveryItem[];
  chapters_with_data: number;
  total_chapters: number;
  coverage_pct: number;
  computed_at: string;
}

// ─── Status display config (icon + label → WCAG 1.4.1; AA-safe tones) ──────────

const STATUS_CFG: Record<
  ChapterScore['status'],
  { icon: string; tone: Tone; en: string; hi: string }
> = {
  strong: { icon: '✓', tone: 'success', en: 'Strong', hi: 'मजबूत' },
  moderate: { icon: '≈', tone: 'warning', en: 'Moderate', hi: 'मध्यम' },
  weak: { icon: '!', tone: 'info', en: 'Weak', hi: 'कमजोर' },
  critical: { icon: '✕', tone: 'danger', en: 'Critical', hi: 'गंभीर' },
};

// ─── Props ─────────────────────────────────────────────────────────────────────

interface BoardScoreWidgetProps {
  isHi: boolean;
  studentId: string | undefined;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function BoardScoreWidget({ isHi, studentId }: BoardScoreWidgetProps) {
  const router = useRouter();
  const [predictions, setPredictions] = useState<BoardScorePrediction[]>([]);
  const [isLoading, setIsLoading] = useState(true); // avoid flash of empty before first fetch
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showAllChapters, setShowAllChapters] = useState(false);

  // ── Fetch (UNCHANGED data contract) ──────────────────────────────────────────

  const fetchScores = useCallback(async () => {
    if (!studentId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/board-score', { credentials: 'include' });
      if (!res.ok) {
        setError(`fetch_error:${res.status}`);
        return;
      }
      const json = (await res.json()) as { code: string; data?: BoardScorePrediction[] };
      if (json.code === 'disabled') {
        setDisabled(true);
        return;
      }
      setPredictions(json.data ?? []);
    } catch {
      setError('network_error');
    } finally {
      setIsLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void fetchScores();
  }, [fetchScores]);

  // Reset per-subject UI when data changes
  useEffect(() => {
    setSelectedIdx(0);
    setShowAllChapters(false);
  }, [predictions.length]);

  // ── Labels ──────────────────────────────────────────────────────────────────

  const T = {
    title: isHi ? 'बोर्ड स्कोर™' : 'BoardScore™',
    subtitle: isHi ? 'CBSE बोर्ड परीक्षा पूर्वानुमान' : 'CBSE Board Exam Prediction',
    predicted: isHi ? 'अनुमानित अंक' : 'Predicted Marks',
    confidence: isHi ? 'विश्वास सीमा' : 'Confidence Band',
    coverage: isHi ? 'कवरेज' : 'Coverage',
    chapters: isHi ? 'अध्याय' : 'chapters',
    chapterBd: isHi ? 'अध्याय-वार विश्लेषण' : 'Chapter Breakdown',
    recovery: isHi ? 'अंक वापसी योजना' : 'Score Recovery Plan',
    showAll: isHi ? 'सभी देखें' : 'See all',
    showLess: isHi ? 'कम करें' : 'Show less',
    selectSubject: isHi ? 'विषय चुनें' : 'Select subject',
    lowCoverage: isHi ? 'अधिक Quiz खेलें — सटीकता बढ़ेगी' : 'Practice more to improve accuracy',
    noData: isHi ? 'अभी कोई डेटा नहीं' : 'No Data Yet',
    noDataDesc: isHi
      ? 'Quiz खेलें और Foxy से पढ़ें — आपका स्कोर बनना शुरू हो जाएगा।'
      : 'Practice quizzes and study with Foxy — your predicted score will appear here.',
    errorTitle: isHi ? 'स्कोर लोड नहीं हो सका' : 'Could not load score',
    errorDesc: isHi ? 'कृपया पुनः प्रयास करें।' : 'Please try again.',
    retry: isHi ? 'पुनः प्रयास' : 'Retry',
    comingSoon: isHi ? 'जल्द आ रहा है' : 'Coming Soon',
    comingSoonDesc: isHi ? 'BoardScore™ जल्द उपलब्ध होगा।' : 'BoardScore™ will be available soon.',
    tryAC: isHi ? 'AnswerChecker™ आज़माएं' : 'Try AnswerChecker™',
  };

  const cardCommon = {
    variant: 'elevated' as const,
    className: 'os-reveal-card px-5 py-4',
    style: { ['--reveal-i' as string]: '2' },
  };

  const heading = (
    <div className="mb-4 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-fluid-xs font-bold uppercase tracking-wide text-muted-foreground">
          {T.title}
        </h2>
        <p className="mt-0.5 text-fluid-xs text-muted-foreground">{T.subtitle}</p>
      </div>
      <Badge tone="success" variant="soft" className="shrink-0">
        CBSE
      </Badge>
    </div>
  );

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (!studentId || isLoading) {
    return (
      <Card {...cardCommon} aria-label={T.title} aria-busy="true">
        <Skeleton className="mb-4 h-4 w-1/2" />
        <div className="mb-4 flex items-center gap-4">
          <Skeleton radius="full" className="h-20 w-20 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton radius="lg" className="h-12 w-full" />
          <Skeleton radius="lg" className="h-12 w-full" />
        </div>
      </Card>
    );
  }

  // ── Feature flag disabled → Coming soon ─────────────────────────────────────

  if (disabled) {
    return (
      <Card {...cardCommon} aria-label={T.title}>
        {heading}
        <EmptyState
          compact
          icon={<span>🚀</span>}
          title={T.comingSoon}
          description={T.comingSoonDesc}
        />
      </Card>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <Card {...cardCommon} aria-label={T.title}>
        {heading}
        <Alert
          tone="danger"
          title={T.errorTitle}
          action={
            <Button variant="secondary" size="sm" onClick={() => void fetchScores()}>
              {T.retry}
            </Button>
          }
        >
          {T.errorDesc}
        </Alert>
      </Card>
    );
  }

  // ── Empty (nightly cron hasn't run yet) ─────────────────────────────────────

  if (predictions.length === 0) {
    return (
      <Card {...cardCommon} aria-label={T.title}>
        {heading}
        <EmptyState compact icon={<span>📊</span>} title={T.noData} description={T.noDataDesc} />
      </Card>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  const sel = predictions[selectedIdx] ?? predictions[0];

  // Overall score across all subjects (for gauge + CTA)
  const totalPredicted = predictions.reduce((s, p) => s + p.predicted_score, 0);
  const totalMax = predictions.reduce((s, p) => s + p.max_score, 0);
  const overallPct =
    totalMax > 0 ? Math.round((totalPredicted / totalMax) * 100) : Math.round(sel.predicted_pct);

  // Total recoverable marks across all subjects (CTA gain figure)
  const ctaGain = Math.round(
    predictions.reduce(
      (acc, p) => acc + (p.recovery_plan ?? []).reduce((s, r) => s + r.recoverable_marks, 0),
      0,
    ),
  );

  const gaugeTone: Tone = overallPct >= 75 ? 'success' : overallPct >= 50 ? 'warning' : 'danger';

  /** Render one subject's panel body (coverage + chapters + recovery). */
  const renderSubject = (p: BoardScorePrediction) => {
    const chapterEntries = Object.entries(p.chapter_scores ?? {}).sort(
      ([a], [b]) => Number(a) - Number(b),
    );
    const visibleChapters = showAllChapters ? chapterEntries : chapterEntries.slice(0, 5);
    const coverageTone: Tone = p.coverage_pct >= 60 ? 'success' : 'warning';

    return (
      <div className="flex flex-col gap-4 pt-4">
        {/* Coverage */}
        <ProgressBar
          value={p.coverage_pct}
          tone={coverageTone}
          size="sm"
          showValue
          label={`${T.coverage} · ${p.chapters_with_data}/${p.total_chapters} ${T.chapters}`}
        />

        {p.coverage_pct < 60 && <Alert tone="warning">{T.lowCoverage}</Alert>}

        {/* Chapter breakdown */}
        {chapterEntries.length > 0 && (
          <div>
            <h3 className="mb-2 text-fluid-xs font-bold uppercase tracking-wide text-muted-foreground">
              {T.chapterBd}
            </h3>
            <Card variant="flat" className="divide-y divide-surface-3">
              {visibleChapters.map(([chNum, ch]) => {
                const cfg = STATUS_CFG[ch.status];
                const pct = Math.round(ch.effective_mastery * 100);
                return (
                  <div key={chNum} className="px-4 py-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-fluid-sm font-semibold text-foreground">
                        {ch.chapter_name}
                      </span>
                      <span className="shrink-0 text-fluid-sm font-bold tabular-nums text-foreground">
                        {Math.round(ch.predicted_marks)}/{ch.marks_allocated}m
                      </span>
                      <Badge tone={cfg.tone} variant="soft" icon={<span>{cfg.icon}</span>} className="shrink-0">
                        {isHi ? cfg.hi : cfg.en}
                      </Badge>
                    </div>
                    <ProgressBar
                      value={pct}
                      tone={cfg.tone}
                      size="sm"
                      ariaLabel={`${ch.chapter_name}: ${pct}%`}
                    />
                  </div>
                );
              })}
            </Card>

            {chapterEntries.length > 5 && (
              <Button
                variant="ghost"
                size="sm"
                fullWidth
                className="mt-2"
                onClick={() => setShowAllChapters((v) => !v)}
              >
                {showAllChapters ? T.showLess : `${T.showAll} (${chapterEntries.length})`}
              </Button>
            )}
          </div>
        )}

        {/* Score Recovery Plan — DEMOTED to a quiet, non-primary list. */}
        {p.recovery_plan && p.recovery_plan.length > 0 && (
          <div>
            <h3 className="mb-2 text-fluid-xs font-bold uppercase tracking-wide text-muted-foreground">
              {T.recovery}
            </h3>
            <ol className="flex flex-col gap-2">
              {p.recovery_plan.slice(0, 5).map((item, i) => (
                <li
                  key={item.chapter_number}
                  className="flex items-start gap-3 rounded-lg border border-surface-3 bg-surface-1 px-4 py-3"
                >
                  <Badge tone="neutral" variant="soft" className="shrink-0 tabular-nums">
                    {i + 1}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-fluid-sm font-semibold text-foreground">{item.chapter_name}</p>
                    <p className="mt-0.5 text-fluid-sm text-muted-foreground">{item.action_label}</p>
                  </div>
                  <Badge
                    tone="success"
                    variant="soft"
                    className="shrink-0 tabular-nums"
                    aria-label={
                      isHi
                        ? `${Math.round(item.recoverable_marks)} अंक वापस पाने योग्य`
                        : `${Math.round(item.recoverable_marks)} recoverable marks`
                    }
                  >
                    +{Math.round(item.recoverable_marks)}m
                  </Badge>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card {...cardCommon} aria-label={isHi ? 'बोर्ड स्कोर पूर्वानुमान' : 'Board Score Prediction'}>
      {heading}

      {/* Overall predicted-score gauge (across all subjects) */}
      <div
        className="mb-4 flex items-center gap-4 rounded-xl border border-surface-3 bg-surface-2 px-4 py-4"
        role="group"
        aria-label={isHi ? 'कुल अनुमानित स्कोर' : 'Overall predicted score'}
      >
        <ProgressRing value={overallPct} size={84} strokeWidth={7} tone={gaugeTone}>
          <span className="text-fluid-base font-extrabold tabular-nums text-foreground">
            {overallPct}%
          </span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <p className="text-fluid-xl font-bold tabular-nums text-foreground">
            {Math.round(totalPredicted)}
            <span className="ms-0.5 text-fluid-sm font-normal text-muted-foreground">/{totalMax}</span>
          </p>
          <p className="text-fluid-xs text-muted-foreground">{T.predicted}</p>
          <p className="mt-1.5 text-fluid-xs font-semibold text-muted-foreground">
            {T.confidence}:{' '}
            <span className="tabular-nums">
              {Math.round(sel.confidence_band_low)}–{Math.round(sel.confidence_band_high)}%
            </span>
          </p>
        </div>
      </div>

      {/* Subject switcher + per-subject panel */}
      {predictions.length > 1 ? (
        <Tabs
          value={sel.subject_code}
          onValueChange={(code) => {
            const idx = predictions.findIndex((p) => p.subject_code === code);
            if (idx >= 0) setSelectedIdx(idx);
            setShowAllChapters(false);
          }}
        >
          <TabList aria-label={T.selectSubject}>
            {predictions.map((p) => (
              <Tab key={p.subject_code} value={p.subject_code}>
                {p.subject_label || p.subject_code}
              </Tab>
            ))}
          </TabList>
          {predictions.map((p) => (
            <TabPanel key={p.subject_code} value={p.subject_code}>
              {renderSubject(p)}
            </TabPanel>
          ))}
        </Tabs>
      ) : (
        renderSubject(sel)
      )}

      {/* AnswerChecker™ — DEMOTED to a non-primary secondary action. */}
      {ctaGain > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-fluid-sm text-muted-foreground">
            {isHi ? (
              <>
                लिखित उत्तरों को बेहतर बनाकर <strong className="text-foreground">+{ctaGain} अंक</strong> पाएं।
              </>
            ) : (
              <>
                Gain <strong className="text-foreground">+{ctaGain} more marks</strong> by improving your
                written answers.
              </>
            )}
          </p>
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            leadingIcon={<span>🦊</span>}
            trailingIcon={<span>→</span>}
            onClick={() => router.push('/answer-checker')}
          >
            {T.tryAC}
          </Button>
        </div>
      )}
    </Card>
  );
}
