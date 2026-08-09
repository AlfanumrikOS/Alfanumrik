'use client';

/**
 * BoardScoreWidget — Predictive Board Exam Score Engine (BoardScore™)
 *
 * Fetches the student's latest board_score_predictions from GET /api/board-score
 * and renders:
 *   - A circular gauge showing the SELECTED subject's predicted % (W3 D1/A:
 *     scoped to one subject so ring, confidence band, and coverage bar share a
 *     single denominator), powered by <StatRing>
 *   - Subject tabs (when multiple subjects exist)
 *   - Coverage progress bar
 *   - A single "View analysis" disclosure (collapsed by default, 2026-08-06
 *     declutter) that reveals:
 *       - Chapter breakdown with status icons + mastery bars (WCAG 1.4.1 —
 *         icon+label, not colour alone)
 *       - Score Recovery Plan (top 5 chapters by recoverable marks)
 *   (An AnswerChecker™ CTA used to close the widget; removed because it linked
 *    to a /answer-checker route that was never built.)
 *
 * Design: matches MasterySnapshot patterns — rounded-3xl p-5 wrapper,
 * rounded-2xl p-3 cards, CSS variable palette, bilingual via isHi.
 */

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { StatRing, Skeleton } from '@alfanumrik/ui/ui';
import { authedFetch } from '@alfanumrik/lib/authed-fetch';
/* Shared dashboard palette. `tint()` and the warm ladder used to be declared
   locally here AND in MasterySnapshot — same helper, two copies, free to drift. */
import {
  WARM,
  WARM_10,
  ACCENT_SURFACE,
  ON_ACCENT,
  MASTERY_STRONG,
  MASTERY_LEARNING,
  MASTERY_REVISE,
  STATUS_CRITICAL,
  tint,
} from '@alfanumrik/ui/dashboard/os/palette';

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

// Semantic status palette (no literal brand hex): strong→green, moderate→warm
// (stable channel), weak→purple (deliberate violet accent), critical→danger.
const STATUS_CFG = {
  strong:   { icon: '✓', en: 'Strong',   hi: 'मजबूत',  color: MASTERY_STRONG },
  moderate: { icon: '≈', en: 'Moderate', hi: 'मध्यम',  color: MASTERY_LEARNING },
  weak:     { icon: '!', en: 'Weak',     hi: 'कमजोर',  color: MASTERY_REVISE },
  critical: { icon: '✕', en: 'Critical', hi: 'गंभीर',  color: STATUS_CRITICAL },
} as const;

// ─── Props ─────────────────────────────────────────────────────────────────────

interface BoardScoreWidgetProps {
  isHi: boolean;
  studentId: string | undefined;
}

// ─── Fetch (RCA W1: SWR-wrapped) ────────────────────────────────────────────────
// Previously this widget fetched raw in a useEffect — no cache, no dedupe, no
// client timeout, refetching on every mount. Now it rides SWR (keyed by
// studentId like every other dashboard hook) with a 20s AbortController so a
// slow Edge Function can never hang the card. Stale-while-revalidate shows the
// cached prediction instantly and refreshes in the background.
const CLIENT_TIMEOUT_MS = 20_000;

/** Discriminated fetch result so SWR carries one `data` payload. */
type BoardScoreResult =
  | { kind: 'disabled' }
  | { kind: 'data'; data: BoardScorePrediction[] };

async function fetchBoardScore(): Promise<BoardScoreResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    // authedFetch forwards `Authorization: Bearer <token>` from the live
    // Supabase session (session lives in localStorage, not a cookie), so the
    // server's authorizeRequest sees the user instead of 401ing.
    const res = await authedFetch('/api/board-score', { signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`fetch_error:${res.status}`) as Error & { status: number };
      err.status = res.status;
      throw err;
    }
    const json = (await res.json()) as { code: string; data?: BoardScorePrediction[] };
    if (json.code === 'disabled') {
      return { kind: 'disabled' };
    }
    return { kind: 'data', data: json.data ?? [] };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function BoardScoreWidget({ isHi, studentId }: BoardScoreWidgetProps) {
  const { data, error, mutate } = useSWR<BoardScoreResult>(
    studentId ? `board-score/${studentId}` : null,
    fetchBoardScore,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 30_000,
      errorRetryCount: 1,
      keepPreviousData: true,
    },
  );

  const disabled = data?.kind === 'disabled';
  const predictions = data?.kind === 'data' ? data.data : [];
  const [selectedIdx, setSelectedIdx] = useState(0);
  // 2026-08-06 declutter: the chapter breakdown + recovery plan (up to 10 rows
  // combined) now live behind ONE disclosure, collapsed by default. The dashboard
  // is a glance surface — the gauge + marks + coverage bar are the first-paint
  // readout; the deep analysis is opt-in.
  const [showDetails, setShowDetails] = useState(false);

  // Reset per-subject UI when data changes
  useEffect(() => {
    setSelectedIdx(0);
    setShowDetails(false);
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
    viewAnalysis:  isHi ? 'विश्लेषण देखें'              : 'View analysis',
    hideAnalysis:  isHi ? 'विश्लेषण छिपाएँ'             : 'Hide analysis',
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
    // `tryAC` was removed with the dead AnswerChecker™ CTA (no /answer-checker
    // route exists). Re-add it when a real AnswerChecker route ships.
  };

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (!studentId || (!data && !error)) {
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
        <h2 className="text-fluid-2xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          {T.title}
        </h2>
        <div
          className="rounded-2xl p-5 text-center"
          style={{ border: '1px dashed var(--border)' }}
        >
          <span className="text-3xl" aria-hidden="true">🚀</span>
          <p className="text-fluid-sm font-bold mt-2" style={{ color: 'var(--text-2)' }}>{T.comingSoon}</p>
          <p className="text-fluid-xs mt-1 leading-relaxed" style={{ color: 'var(--text-3)' }}>{T.comingSoonDesc}</p>
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
        <h2 className="text-fluid-2xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>
          {T.title}
        </h2>
        <div className="rounded-2xl p-4 text-center" style={{ background: 'var(--surface-2)' }}>
          <p className="text-fluid-sm font-semibold" style={{ color: 'var(--text-2)' }}>{T.errorTitle}</p>
          <p className="text-fluid-xs mt-1 mb-3" style={{ color: 'var(--text-3)' }}>{T.errorDesc}</p>
          <button
            type="button"
            onClick={() => void mutate()}
            className="inline-flex items-center min-h-tap-min text-fluid-xs font-bold underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 rounded"
            style={{ color: WARM }}
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
        <h2 className="text-fluid-2xs font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-3)' }}>
          {T.title}
        </h2>
        <p className="text-fluid-xs mb-4" style={{ color: 'var(--text-3)' }}>{T.subtitle}</p>
        <div
          className="rounded-2xl p-5 text-center"
          style={{ border: '1px dashed var(--border)' }}
        >
          <span className="text-3xl" aria-hidden="true">📊</span>
          <p className="text-fluid-sm font-bold mt-2" style={{ color: 'var(--text-2)' }}>{T.noData}</p>
          <p className="text-fluid-xs mt-1 leading-relaxed max-w-xs mx-auto" style={{ color: 'var(--text-3)' }}>
            {T.noDataDesc}
          </p>
        </div>
      </section>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  const sel = predictions[selectedIdx] ?? predictions[0];

  // W3 D1 (assessment sign-off 2026-08-06, Option A): the gauge is SCOPED to
  // the selected subject. The previous ring + marks pair were a cross-subject
  // aggregate (Σpredicted / Σmax across ALL subjects) stacked directly above a
  // per-subject confidence band + coverage bar — a mixed-denominator stack that
  // read as one fact. Now the gauge uses the `sel` row's own engine-emitted
  // predicted_pct and marks, so ring / confidence band / coverage bar all share
  // ONE denominator (the selected subject).
  const gaugeValue = Math.round(sel.predicted_pct);
  const subjectMax = sel.max_score;
  const subjectLabel = sel.subject_label || sel.subject_code;

  // NOTE: the `ctaGain` total (sum of recoverable_marks across subjects) was
  // removed alongside the AnswerChecker™ CTA — see the note at the end of this
  // component. Nothing else consumed it. Per-item `recoverable_marks` are
  // still rendered in the recovery-plan list above.

  // Gauge colour — semantic tokens (mastered green / warm / danger).
  const gaugeColor =
    sel.predicted_pct >= 75 ? MASTERY_STRONG
    : sel.predicted_pct >= 50 ? MASTERY_LEARNING
    : STATUS_CRITICAL;

  // Chapter list — sorted by chapter_number (keys are stringified numbers)
  const chapterEntries = Object.entries(sel.chapter_scores ?? {})
    .sort(([a], [b]) => Number(a) - Number(b));
  const hasDetails = chapterEntries.length > 0 || (sel.recovery_plan?.length ?? 0) > 0;

  return (
    <section
      className="os-reveal-card rounded-3xl p-5"
      style={{
        ['--reveal-i' as string]: '2',
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-md)',
      }}
      aria-label={isHi ? 'बोर्ड स्कोर पूर्वानुमान' : 'Board Score Prediction'}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-fluid-2xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
            {T.title}
          </h2>
          {/* No extra opacity dimmer. --text-3 is ALREADY the muted tier
              (6.13:1 on the card); knocking it to 70% took this subtitle to
              3.16:1, i.e. below AA, for no hierarchy the token was not already
              expressing. */}
          <p className="text-fluid-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
            {T.subtitle}
          </p>
        </div>
        <span
          className="text-fluid-2xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ background: tint(MASTERY_STRONG, 12), color: MASTERY_STRONG }}
        >
          CBSE
        </span>
      </div>

      {/* ── Overall score gauge ─────────────────────────────────────────────── */}
      <div
        className="rounded-2xl p-4 flex items-center gap-4 mb-4"
        style={{
          background: 'var(--surface-2)',
          border: `1px solid ${tint(gaugeColor, 18)}`,
        }}
        role="group"
        aria-label={isHi ? `${subjectLabel} का अनुमानित स्कोर` : `${subjectLabel} predicted score`}
      >
        <StatRing value={gaugeValue} size={84} strokeWidth={7} color={gaugeColor}>
          <div className="text-center leading-none" style={{ fontFamily: 'var(--font-display)' }}>
            <span
              className="block text-fluid-base font-extrabold font-data tabular-nums"
              style={{ color: gaugeColor }}
            >
              {gaugeValue}%
            </span>
          </div>
        </StatRing>

        <div className="flex-1 min-w-0">
          <div
            className="text-fluid-xl font-bold font-data leading-tight"
            style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}
          >
            {Math.round(sel.predicted_score)}
            {subjectMax > 0 && (
              <span className="text-fluid-sm font-normal ml-0.5" style={{ color: 'var(--text-3)' }}>
                /{subjectMax}
              </span>
            )}
          </div>
          <p className="text-fluid-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{T.predicted}</p>
          <p className="text-fluid-xs mt-1.5 font-medium" style={{ color: 'var(--text-3)' }}>
            {T.confidence}:{' '}
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(sel.confidence_band_low)}–{Math.round(sel.confidence_band_high)}%
            </span>
          </p>
          {sel.coverage_pct < 60 && (
            <p className="text-fluid-xs mt-1 font-semibold" style={{ color: WARM }}>
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
                  setShowDetails(false);
                }}
                className="inline-flex items-center min-h-tap-min text-fluid-xs font-semibold px-4 py-1.5 rounded-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{
                  // Selected tab now uses the AA-verified CTA pairing. It was
                  // white on bare --accent-warm (#E8581C) = 3.59:1, a fail.
                  background: active ? ACCENT_SURFACE : 'var(--surface-2)',
                  color: active ? ON_ACCENT : 'var(--text-2)',
                  border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
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
        <div className="flex justify-between gap-2 text-fluid-xs mb-1.5" style={{ color: 'var(--text-3)' }}>
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
              background: sel.coverage_pct >= 60 ? MASTERY_STRONG : MASTERY_LEARNING,
              transition: 'width 1s cubic-bezier(0.4,0,0.2,1)',
            }}
          />
        </div>
      </div>

      {/* ── Detail disclosure — chapter breakdown + recovery plan ──────────────
          Collapsed by default (2026-08-06 declutter). The dashboard's first
          paint carries the gauge + marks + coverage; the chapter-by-chapter
          analysis and the recovery plan (up to 10 rows combined) are opt-in.
          One disclosure, not two nested ones — the old 5-cap "See all" toggle
          is gone because the whole section is now behind the user's own tap. */}
      {hasDetails && (
        <>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
            aria-controls="board-score-details"
            data-testid="board-score-details-toggle"
            className="w-full flex items-center justify-between gap-2 rounded-2xl px-4 py-3 min-h-tap-comfort text-left transition-all active:scale-[0.99] focus:outline-none focus-visible:ring-2"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
            }}
          >
            <span className="text-fluid-sm font-bold" style={{ color: 'var(--text-2)' }}>
              {showDetails ? T.hideAnalysis : T.viewAnalysis}
            </span>
            <span className="flex items-center gap-2">
              {chapterEntries.length > 0 && (
                <span
                  className="text-fluid-2xs font-bold font-data tabular-nums px-2 py-0.5 rounded-full whitespace-nowrap"
                  style={{ background: WARM_10, color: WARM }}
                >
                  {chapterEntries.length} {T.chapters}
                </span>
              )}
              <span
                aria-hidden="true"
                style={{
                  color: 'var(--text-3)',
                  display: 'inline-block',
                  transform: showDetails ? 'rotate(180deg)' : 'none',
                  transition: 'transform 160ms ease',
                }}
              >
                ▾
              </span>
            </span>
          </button>

          {showDetails && (
            <div id="board-score-details" className="mt-2 space-y-4">
              {/* ── Chapter breakdown ── */}
              {chapterEntries.length > 0 && (
                <div>
                  <h3
                    className="text-fluid-2xs font-bold uppercase tracking-widest mb-2"
                    style={{ color: 'var(--text-3)' }}
                  >
                    {T.chapterBd}
                  </h3>
                  <div className="space-y-2" role="list" aria-label={T.chapterBd}>
                    {chapterEntries.map(([chNum, ch]) => {
                      const cfg = STATUS_CFG[ch.status];
                      const pctWidth = Math.round(ch.effective_mastery * 100);
                      return (
                        <div
                          key={chNum}
                          className="rounded-2xl px-3 py-2.5"
                          style={{
                            background: 'var(--surface-2)',
                            borderLeft: `3px solid ${cfg.color}`,
                          }}
                          role="listitem"
                        >
                          {/* Row: icon + name + marks + badge */}
                          <div className="flex items-center gap-2 mb-1.5">
                            <span
                              className="inline-flex items-center justify-center w-5 h-5 rounded-full text-fluid-2xs font-bold flex-shrink-0"
                              style={{ background: tint(cfg.color, 14), color: cfg.color }}
                              aria-hidden="true"
                            >
                              {cfg.icon}
                            </span>
                            <span
                              className="text-fluid-xs font-semibold flex-1 truncate"
                              style={{ color: 'var(--text-1)' }}
                            >
                              {ch.chapter_name}
                            </span>
                            <span
                              className="text-fluid-xs font-bold font-data flex-shrink-0 whitespace-nowrap"
                              style={{ color: cfg.color, fontVariantNumeric: 'tabular-nums' }}
                            >
                              {Math.round(ch.predicted_marks)}/{ch.marks_allocated}m
                            </span>
                            <span
                              className="text-fluid-2xs font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap"
                              style={{ background: tint(cfg.color, 13), color: cfg.color }}
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
                </div>
              )}

              {/* ── Score Recovery Plan ── */}
              {sel.recovery_plan && sel.recovery_plan.length > 0 && (
                <div>
                  <h3
                    className="text-fluid-2xs font-bold uppercase tracking-widest mb-2"
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
                          style={{
                            background: 'var(--surface-2)',
                            border: '1px solid var(--border)',
                            boxShadow: 'var(--shadow-sm)',
                          }}
                          role="listitem"
                        >
                          <span
                            className="flex-shrink-0 w-5 h-5 rounded-full text-fluid-2xs font-bold font-data flex items-center justify-center"
                            style={{ background: ACCENT_SURFACE, color: ON_ACCENT }}
                            aria-hidden="true"
                          >
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-fluid-xs font-semibold leading-snug" style={{ color: 'var(--text-1)' }}>
                              {item.chapter_name}
                            </p>
                            <p className="text-fluid-xs mt-0.5 leading-snug" style={{ color: 'var(--text-3)' }}>
                              {item.action_label}
                            </p>
                          </div>
                          <span
                            className="flex-shrink-0 text-fluid-xs font-bold font-data whitespace-nowrap"
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
            </div>
          )}
        </>
      )}

      {/* The AnswerChecker™ CTA that used to render here was removed: it linked
          to /answer-checker, for which no route, page, or redirect has ever
          existed, so it 404'd for every student whose recovery plan carried
          any recoverable marks. Restore it only once a real AnswerChecker
          route ships. */}
    </section>
  );
}
