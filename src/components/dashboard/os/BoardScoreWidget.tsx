'use client';

/**
 * BoardScoreWidget — Predictive Board Exam Score Engine (BoardScore™)
 *
 * Fetches the student's latest board_score_predictions from GET /api/board-score
 * and renders:
 *   - A circular gauge showing overall predicted %, powered by <MasteryRing>
 *   - Subject tabs (when multiple subjects exist)
 *   - Coverage progress bar
 *   - Chapter breakdown with status icons + mastery bars (WCAG 1.4.1 — icon+label,
 *     not colour alone)
 *   - Score Recovery Plan (top 5 chapters by recoverable marks)
 *   - AnswerChecker™ CTA with dynamic score/gain message
 *
 * Design: matches MasterySnapshot patterns — rounded-3xl p-5 wrapper,
 * rounded-2xl p-3 cards, CSS variable palette, bilingual via isHi.
 */

import { useState, useEffect, useCallback } from 'react';
import { MasteryRing, Skeleton } from '@/components/ui';

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

// ─── Status display config (icon + label ensures WCAG 1.4.1 compliance) ────────

const STATUS_CFG = {
  strong:   { icon: '✓', en: 'Strong',   hi: 'मजबूत',  color: 'var(--green, #16A34A)' },
  moderate: { icon: '≈', en: 'Moderate', hi: 'मध्यम',  color: 'var(--orange, #E8581C)' },
  weak:     { icon: '!', en: 'Weak',     hi: 'कमजोर',  color: '#8B5CF6' },
  critical: { icon: '✕', en: 'Critical', hi: 'गंभीर',  color: '#DC2626' },
} as const;

// ─── Props ─────────────────────────────────────────────────────────────────────

interface BoardScoreWidgetProps {
  isHi: boolean;
  studentId: string | undefined;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function BoardScoreWidget({ isHi, studentId }: BoardScoreWidgetProps) {
  const [predictions, setPredictions] = useState<BoardScorePrediction[]>([]);
  const [isLoading, setIsLoading]     = useState(true);  // true: avoid flash of empty-state before first fetch
  const [error, setError]             = useState<string | null>(null);
  const [disabled, setDisabled]       = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showAllChapters, setShowAllChapters] = useState(false);

  // ── Fetch ───────────────────────────────────────────────────────────────────

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

  useEffect(() => { void fetchScores(); }, [fetchScores]);

  // Reset per-subject UI when data changes
  useEffect(() => {
    setSelectedIdx(0);
    setShowAllChapters(false);
  }, [predictions.length]);

  // ── Labels ──────────────────────────────────────────────────────────────────

  const T = {
    title:         isHi ? 'बोर्ड स्कोर™'              : 'BoardScore™',
    subtitle:      isHi ? 'CBSE बोर्ड परीक्षा पूर्वानुमान' : 'CBSE Board Exam Prediction',
    predicted:     isHi ? 'अनुमानित अंक'               : 'Predicted Marks',
    confidence:    isHi ? 'विश्वास सीमा'                : 'Confidence Band',
    coverage:      isHi ? 'कवरेज'                      : 'Coverage',
    chapters:      isHi ? 'अध्याय'                     : 'chapters',
    chapterBd:     isHi ? 'अध्याय-वार विश्लेषण'        : 'Chapter Breakdown',
    recovery:      isHi ? 'अंक वापसी योजना'             : 'Score Recovery Plan',
    showAll:       isHi ? 'सभी देखें'                   : 'See all',
    showLess:      isHi ? 'कम करें'                     : 'Show less',
    selectSubject: isHi ? 'विषय चुनें'                  : 'Select subject',
    lowCoverage:   isHi ? '⚠ अधिक Quiz खेलें — सटीकता बढ़ेगी' : '⚠ Practice more to improve accuracy',
    noData:        isHi ? 'अभी कोई डेटा नहीं'           : 'No Data Yet',
    noDataDesc:    isHi ? 'Quiz खेलें और Foxy से पढ़ें — आपका स्कोर बनना शुरू हो जाएगा।'
                        : 'Practice quizzes and study with Foxy — your predicted score will appear here.',
    errorTitle:    isHi ? 'स्कोर लोड नहीं हो सका'     : 'Could not load score',
    errorDesc:     isHi ? 'कृपया पुनः प्रयास करें।'    : 'Please try again.',
    retry:         isHi ? 'पुनः प्रयास'                : 'Retry',
    comingSoon:    isHi ? 'जल्द आ रहा है'              : 'Coming Soon',
    comingSoonDesc:isHi ? 'BoardScore™ जल्द उपलब्ध होगा।' : 'BoardScore™ will be available soon.',
    tryAC:         isHi ? 'AnswerChecker™ आज़माएं →'   : 'Try AnswerChecker™ →',
  };

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (!studentId || isLoading) {
    return (
      <section
        className="rounded-3xl p-5"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        aria-label={T.title}
        aria-busy="true"
      >
        <Skeleton width="45%" height={14} className="mb-4" />
        <div className="flex gap-4 mb-4">
          <Skeleton width={80} height={80} variant="circle" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton height={22} width="55%" />
            <Skeleton height={13} width="40%" />
            <Skeleton height={13} width="60%" />
          </div>
        </div>
        <Skeleton height={6} className="mb-4" rounded="rounded-full" />
        <div className="space-y-2">
          <Skeleton height={48} rounded="rounded-2xl" />
          <Skeleton height={48} rounded="rounded-2xl" />
          <Skeleton height={48} rounded="rounded-2xl" />
        </div>
      </section>
    );
  }

  // ── Feature flag disabled ───────────────────────────────────────────────────

  if (disabled) {
    return (
      <section
        className="rounded-3xl p-5"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        aria-label={T.title}
      >
        <h2 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
          {T.title}
        </h2>
        <div
          className="rounded-2xl p-5 text-center"
          style={{ border: '1px dashed var(--border)' }}
        >
          <span className="text-3xl" aria-hidden="true">🚀</span>
          <p className="text-sm font-bold mt-2" style={{ color: 'var(--text-2)' }}>{T.comingSoon}</p>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-3)' }}>{T.comingSoonDesc}</p>
        </div>
      </section>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <section
        className="rounded-3xl p-5"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        aria-label={T.title}
      >
        <h2 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>
          {T.title}
        </h2>
        <div className="rounded-2xl p-4 text-center" style={{ background: 'var(--surface-2)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-2)' }}>{T.errorTitle}</p>
          <p className="text-xs mt-1 mb-3" style={{ color: 'var(--text-3)' }}>{T.errorDesc}</p>
          <button
            type="button"
            onClick={() => void fetchScores()}
            className="text-xs font-bold underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2 rounded"
            style={{ color: 'var(--orange)' }}
          >
            {T.retry}
          </button>
        </div>
      </section>
    );
  }

  // ── Empty (nightly cron hasn't run yet) ─────────────────────────────────────

  if (predictions.length === 0) {
    return (
      <section
        className="rounded-3xl p-5"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        aria-label={T.title}
      >
        <h2 className="text-sm font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>
          {T.title}
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--text-3)', opacity: 0.7 }}>{T.subtitle}</p>
        <div
          className="rounded-2xl p-5 text-center"
          style={{ border: '1px dashed var(--border)' }}
        >
          <span className="text-3xl" aria-hidden="true">📊</span>
          <p className="text-sm font-bold mt-2" style={{ color: 'var(--text-2)' }}>{T.noData}</p>
          <p className="text-xs mt-1 leading-relaxed max-w-xs mx-auto" style={{ color: 'var(--text-3)' }}>
            {T.noDataDesc}
          </p>
        </div>
      </section>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  const sel = predictions[selectedIdx] ?? predictions[0];

  // Overall score across all subjects (for gauge + CTA)
  const totalPredicted = predictions.reduce((s, p) => s + p.predicted_score, 0);
  const totalMax       = predictions.reduce((s, p) => s + p.max_score, 0);
  const overallPct     = totalMax > 0 ? Math.round(totalPredicted / totalMax * 100) : Math.round(sel.predicted_pct);

  // Total recoverable marks across all subjects (CTA gain figure)
  const ctaGain = Math.round(
    predictions.reduce(
      (acc, p) => acc + (p.recovery_plan ?? []).reduce((s, r) => s + r.recoverable_marks, 0),
      0,
    ),
  );

  // Gauge colour
  const gaugeColor =
    overallPct >= 75 ? 'var(--green, #16A34A)'
    : overallPct >= 50 ? 'var(--orange, #E8581C)'
    : '#DC2626';

  // Chapter list — sorted by chapter_number (keys are stringified numbers)
  const chapterEntries = Object.entries(sel.chapter_scores ?? {})
    .sort(([a], [b]) => Number(a) - Number(b));
  const visibleChapters = showAllChapters ? chapterEntries : chapterEntries.slice(0, 5);

  return (
    <section
      className="rounded-3xl p-5"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      aria-label={isHi ? 'बोर्ड स्कोर पूर्वानुमान' : 'Board Score Prediction'}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
            {T.title}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)', opacity: 0.7 }}>
            {T.subtitle}
          </p>
        </div>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ background: 'rgba(22,163,74,0.12)', color: 'var(--green, #16A34A)' }}
        >
          CBSE
        </span>
      </div>

      {/* ── Overall score gauge ─────────────────────────────────────────────── */}
      <div
        className="rounded-2xl p-4 flex items-center gap-4 mb-4"
        style={{ background: 'var(--surface-2)' }}
        role="group"
        aria-label={isHi ? 'कुल अनुमानित स्कोर' : 'Overall predicted score'}
      >
        <MasteryRing value={overallPct} size={80} strokeWidth={7} color={gaugeColor}>
          <div className="text-center leading-tight">
            <div
              className="text-sm font-bold"
              style={{ color: gaugeColor, fontVariantNumeric: 'tabular-nums' }}
            >
              {overallPct}%
            </div>
          </div>
        </MasteryRing>

        <div className="flex-1 min-w-0">
          <div
            className="text-xl font-bold leading-tight"
            style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}
          >
            {Math.round(totalPredicted)}
            <span className="text-sm font-normal ml-0.5" style={{ color: 'var(--text-3)' }}>
              /{totalMax}
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{T.predicted}</p>
          <p className="text-xs mt-1.5 font-medium" style={{ color: 'var(--text-3)' }}>
            {T.confidence}:{' '}
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(sel.confidence_band_low)}–{Math.round(sel.confidence_band_high)}%
            </span>
          </p>
          {sel.coverage_pct < 60 && (
            <p className="text-xs mt-1 font-semibold" style={{ color: 'var(--orange, #E8581C)' }}>
              {T.lowCoverage}
            </p>
          )}
        </div>
      </div>

      {/* ── Subject tabs ────────────────────────────────────────────────────── */}
      {predictions.length > 1 && (
        <div
          className="flex gap-2 flex-wrap mb-4"
          role="tablist"
          aria-label={T.selectSubject}
        >
          {predictions.map((p, i) => {
            const active = i === selectedIdx;
            return (
              <button
                key={p.subject_code}
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setSelectedIdx(i);
                  setShowAllChapters(false);
                }}
                className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
                style={{
                  background: active ? 'var(--orange)' : 'var(--surface-2)',
                  color: active ? '#fff' : 'var(--text-2)',
                  border: `1px solid ${active ? 'var(--orange)' : 'var(--border)'}`,
                }}
              >
                {p.subject_label || p.subject_code}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Coverage bar ────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--text-3)' }}>
          <span>{T.coverage}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(sel.coverage_pct)}%
            {' '}({sel.chapters_with_data}/{sel.total_chapters} {T.chapters})
          </span>
        </div>
        <div
          className="w-full rounded-full overflow-hidden"
          style={{ height: 6, background: 'var(--surface-2)' }}
          role="progressbar"
          aria-valuenow={Math.round(sel.coverage_pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={isHi ? `कवरेज ${Math.round(sel.coverage_pct)}%` : `Coverage ${Math.round(sel.coverage_pct)}%`}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${sel.coverage_pct}%`,
              background: sel.coverage_pct >= 60 ? 'var(--green, #16A34A)' : 'var(--orange, #E8581C)',
              transition: 'width 1s cubic-bezier(0.4,0,0.2,1)',
            }}
          />
        </div>
      </div>

      {/* ── Chapter breakdown ────────────────────────────────────────────────── */}
      {chapterEntries.length > 0 && (
        <div className="mb-4">
          <h3
            className="text-xs font-bold uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-3)' }}
          >
            {T.chapterBd}
          </h3>
          <div className="space-y-2" role="list" aria-label={T.chapterBd}>
            {visibleChapters.map(([chNum, ch]) => {
              const cfg = STATUS_CFG[ch.status];
              const pctWidth = Math.round(ch.effective_mastery * 100);
              return (
                <div
                  key={chNum}
                  className="rounded-2xl px-3 py-2.5"
                  style={{ background: 'var(--surface-2)' }}
                  role="listitem"
                >
                  {/* Row: icon + name + marks + badge */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold flex-shrink-0"
                      style={{ background: `${cfg.color}18`, color: cfg.color }}
                      aria-hidden="true"
                    >
                      {cfg.icon}
                    </span>
                    <span
                      className="text-xs font-semibold flex-1 truncate"
                      style={{ color: 'var(--text-1)' }}
                    >
                      {ch.chapter_name}
                    </span>
                    <span
                      className="text-xs font-bold flex-shrink-0"
                      style={{ color: cfg.color, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {Math.round(ch.predicted_marks)}/{ch.marks_allocated}m
                    </span>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: `${cfg.color}15`, color: cfg.color }}
                    >
                      {isHi ? cfg.hi : cfg.en}
                    </span>
                  </div>
                  {/* Mastery bar */}
                  <div
                    className="w-full rounded-full overflow-hidden"
                    style={{ height: 4, background: 'var(--surface-1)' }}
                    role="progressbar"
                    aria-valuenow={pctWidth}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${ch.chapter_name}: ${pctWidth}%`}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pctWidth}%`, background: cfg.color, transition: 'width 0.8s ease' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {chapterEntries.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAllChapters((v) => !v)}
              className="mt-2 text-xs font-bold w-full text-center py-1.5 rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
              style={{ color: 'var(--orange)', background: 'rgba(232,88,28,0.06)' }}
            >
              {showAllChapters
                ? T.showLess
                : `${T.showAll} (${chapterEntries.length})`}
            </button>
          )}
        </div>
      )}

      {/* ── Score Recovery Plan ─────────────────────────────────────────────── */}
      {sel.recovery_plan && sel.recovery_plan.length > 0 && (
        <div className="mb-4">
          <h3
            className="text-xs font-bold uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-3)' }}
          >
            {T.recovery}
          </h3>
          <div className="space-y-2" role="list" aria-label={T.recovery}>
            {sel.recovery_plan.slice(0, 5).map((item, i) => {
              const cfg = STATUS_CFG[item.status];
              return (
                <div
                  key={item.chapter_number}
                  className="rounded-2xl px-3 py-2.5 flex items-start gap-2.5"
                  style={{ background: 'var(--surface-2)' }}
                  role="listitem"
                >
                  <span
                    className="flex-shrink-0 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                    style={{ background: 'var(--orange)', color: '#fff' }}
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
                      {item.chapter_name}
                    </p>
                    <p className="text-xs mt-0.5 leading-snug" style={{ color: 'var(--text-3)' }}>
                      {item.action_label}
                    </p>
                  </div>
                  <span
                    className="flex-shrink-0 text-xs font-bold"
                    style={{ color: cfg.color, fontVariantNumeric: 'tabular-nums' }}
                    aria-label={`${Math.round(item.recoverable_marks)} recoverable marks`}
                  >
                    +{Math.round(item.recoverable_marks)}m
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── AnswerChecker™ CTA ──────────────────────────────────────────────── */}
      {ctaGain > 0 && (
        <a
          href="/answer-checker"
          className="flex items-start gap-3 rounded-2xl p-4 transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
          style={{
            background: 'linear-gradient(135deg, #FFF7ED, #FEF3E2)',
            border: '1.5px solid rgba(232,88,28,0.2)',
            textDecoration: 'none',
            display: 'flex',
          }}
          aria-label={
            isHi
              ? `आपका अनुमानित स्कोर ${overallPct}% है। AnswerChecker™ से ${ctaGain} और अंक पाएं।`
              : `Your predicted score is ${overallPct}%. Gain ${ctaGain} more marks with AnswerChecker™.`
          }
        >
          <span className="text-2xl flex-shrink-0 mt-0.5" aria-hidden="true">🦊</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
              {isHi
                ? <>आपका अनुमानित स्कोर है <strong>{overallPct}%</strong>। लिखित उत्तरों को बेहतर बनाकर <strong>+{ctaGain} अंक</strong> पाएं — AnswerChecker™ आज़माएं।</>
                : <>Your predicted score is <strong>{overallPct}%</strong>. Gain <strong>{ctaGain} more marks</strong> by improving your written answers — try AnswerChecker™.</>
              }
            </p>
            <p className="text-xs font-bold mt-1.5" style={{ color: 'var(--orange)' }}>
              {T.tryAC}
            </p>
          </div>
        </a>
      )}
    </section>
  );
}
