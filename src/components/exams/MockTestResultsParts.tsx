'use client';

/**
 * MockTestResultsParts — view components for the mock-test results page.
 *
 * Pulled out of `app/exams/mock/[paperId]/results/page.tsx` so the page stays
 * under the per-file LOC budget while the components remain unit-testable.
 *
 * P1 — these components display values from the submission response only.
 *      Never recalculate score_percent or xp_earned here.
 * P7 — bilingual via the `isHi` prop. Technical terms (XP, JEE, NEET, etc.)
 *      stay in English in both locales.
 * P13 — no console.log; no Sentry breadcrumbs; data is render-only.
 */

import { useState } from 'react';
import type { ReviewItem, SubmitResult } from './mock-test-types';

const CARD_STYLE = {
  background: 'var(--surface-1)',
  border: '1px solid var(--border)',
  boxShadow: 'var(--shadow-md)',
};
const SUBSTYLE = { background: 'var(--surface-2)', border: '1px solid var(--border)' };

export function formatTimeMmSs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

export function formatDateLocal(iso: string, isHi: boolean): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(isHi ? 'hi-IN' : 'en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function scoreCopy(score: number, isHi: boolean): { headline: string; tone: string } {
  if (score >= 90) return { headline: isHi ? 'बहुत बढ़िया' : 'Excellent', tone: '#16A34A' };
  if (score >= 75) return { headline: isHi ? 'अच्छा प्रदर्शन' : 'Strong work', tone: '#16A34A' };
  if (score >= 50) return { headline: isHi ? 'सही दिशा' : 'On the right track', tone: '#B45309' };
  return { headline: isHi ? 'और अभ्यास करें' : 'Keep practising', tone: '#DC2626' };
}

export interface ChapterRollup {
  chapter: string;
  total: number;
  correct: number;
  attempted: number;
  percent: number;
  weak: boolean;
}

export function rollupByChapter(review: ReviewItem[], isHi: boolean): ChapterRollup[] {
  const map = new Map<string, { correct: number; total: number; attempted: number }>();
  for (const item of review) {
    const key = item.chapter_title || (isHi ? 'अन्य' : 'Other');
    const slot = map.get(key) ?? { correct: 0, total: 0, attempted: 0 };
    slot.total += 1;
    if (item.response_index !== null && item.response_index !== undefined) slot.attempted += 1;
    if (item.is_correct === true) slot.correct += 1;
    map.set(key, slot);
  }
  return Array.from(map.entries())
    .map(([chapter, s]) => {
      const percent = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
      return { chapter, total: s.total, correct: s.correct, attempted: s.attempted, percent, weak: percent < 50 };
    })
    .sort((a, b) => a.percent - b.percent);
}

export function ResultsHeader({ result, isHi }: { result: SubmitResult; isHi: boolean }) {
  const shortId = result.paper_id ? result.paper_id.slice(0, 8) : '';
  return (
    <div className="rounded-2xl p-5 space-y-2" style={CARD_STYLE} data-testid="mock-results-header">
      <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wider font-bold">
        {isHi ? 'मॉक परीक्षा परिणाम' : 'Mock test result'}
      </p>
      <h1 className="text-lg font-bold leading-snug" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
        {shortId ? (isHi ? 'पेपर ' : 'Paper ') + shortId : (isHi ? 'पेपर' : 'Paper')}
      </h1>
      <div className="flex items-center gap-3 flex-wrap text-xs text-[var(--text-3)]">
        <span>{formatDateLocal(result.summary.submitted_at, isHi)}</span>
        <span>⏱ {formatTimeMmSs(result.summary.time_taken_seconds)}</span>
      </div>
    </div>
  );
}

export function ScoreCard({ summary, isHi }: { summary: SubmitResult['summary']; isHi: boolean }) {
  const copy = scoreCopy(summary.score_percent, isHi);
  return (
    <div className="rounded-2xl p-6 text-center space-y-2" style={CARD_STYLE} data-testid="mock-results-score">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: copy.tone }}>
        {copy.headline}
      </p>
      <p className="text-5xl font-bold tabular-nums" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
        {summary.score_percent}%
      </p>
      <p className="text-sm text-[var(--text-3)]">
        {summary.correct_count} / {summary.total_questions} {isHi ? 'सही' : 'correct'}
      </p>
      {summary.xp_earned > 0 && (
        <div
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
          style={{ background: 'rgba(232,88,28,0.12)', color: 'var(--orange)' }}
          data-testid="mock-results-xp"
        >
          <span aria-hidden="true">✨</span>
          {summary.xp_earned} XP
        </div>
      )}
    </div>
  );
}

export function BreakdownBar({ summary, isHi }: { summary: SubmitResult['summary']; isHi: boolean }) {
  const total = Math.max(1, summary.total_questions);
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  return (
    <div className="rounded-2xl p-4 space-y-3" style={CARD_STYLE} data-testid="mock-results-breakdown">
      <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)]">
        {isHi ? 'विभाजन' : 'Breakdown'}
      </p>
      <div className="flex h-3 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
        <div style={{ width: pct(summary.correct_count), background: '#16A34A' }} aria-label="correct" />
        <div style={{ width: pct(summary.wrong_count), background: '#DC2626' }} aria-label="wrong" />
        <div style={{ width: pct(summary.skipped_count), background: 'var(--text-3)' }} aria-label="skipped" />
      </div>
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="font-semibold" style={{ color: '#16A34A' }}>
          {summary.correct_count} {isHi ? 'सही' : 'correct'}
        </span>
        <span className="font-semibold" style={{ color: '#DC2626' }}>
          {summary.wrong_count} {isHi ? 'गलत' : 'wrong'}
        </span>
        <span className="font-semibold text-[var(--text-3)]">
          {summary.skipped_count} {isHi ? 'छोड़े' : 'skipped'}
        </span>
      </div>
    </div>
  );
}

export function ChapterBreakdown({ rollups, isHi }: { rollups: ChapterRollup[]; isHi: boolean }) {
  if (rollups.length === 0) return null;
  return (
    <div className="rounded-2xl p-4 space-y-3" style={CARD_STYLE} data-testid="mock-results-chapters">
      <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)]">
        {isHi ? 'अध्यायवार' : 'By chapter'}
      </p>
      <div className="space-y-2">
        {rollups.map(r => (
          <div
            key={r.chapter}
            data-testid={`mock-results-chapter-${r.weak ? 'weak' : 'ok'}`}
            className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
            style={{
              background: r.weak ? 'rgba(220,38,38,0.06)' : 'var(--surface-2)',
              border: r.weak ? '1px solid rgba(220,38,38,0.25)' : '1px solid var(--border)',
            }}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{r.chapter}</p>
              <p className="text-[10px] text-[var(--text-3)]">
                {r.correct}/{r.total} {isHi ? 'सही' : 'correct'}
                {r.weak && <span className="ml-2 font-bold" style={{ color: '#DC2626' }}>· {isHi ? 'कमज़ोर' : 'weak'}</span>}
              </p>
            </div>
            <span className="text-sm font-bold tabular-nums" style={{ color: r.weak ? '#DC2626' : 'var(--text-1)' }}>
              {r.percent}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReviewCard({ item, isHi }: { item: ReviewItem; isHi: boolean }) {
  const [open, setOpen] = useState(false);
  const isCorrect = item.is_correct === true;
  const isSkipped = item.response_index === null || item.response_index === undefined;
  const marksColor = item.marks_awarded > 0 ? '#16A34A' : item.marks_awarded < 0 ? '#DC2626' : 'var(--text-3)';

  return (
    <div data-testid="mock-results-review-card" className="rounded-xl overflow-hidden" style={SUBSTYLE}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-xs font-bold text-[var(--text-3)] tabular-nums">
            Q{item.question_number ?? '?'}
          </span>
          <span aria-hidden="true">
            {isSkipped ? '⏭' : isCorrect ? '✓' : '✗'}
          </span>
          <span
            className="text-xs font-bold rounded-md px-1.5 py-0.5"
            style={{ background: 'var(--surface-1)', color: marksColor }}
          >
            {item.marks_awarded > 0 ? `+${item.marks_awarded}` : item.marks_awarded}
          </span>
        </div>
        <span className="text-xs text-[var(--text-3)]">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-[var(--border)]">
          <p className="text-sm leading-relaxed pt-3" style={{ color: 'var(--text-1)' }}>
            {item.question_text}
          </p>
          <div className="space-y-1">
            {item.options.map((opt, i) => {
              const chosen = item.response_index === i;
              const correct = item.correct_answer_index === i;
              const bg = correct
                ? 'rgba(22,163,74,0.10)'
                : chosen
                  ? 'rgba(220,38,38,0.08)'
                  : 'var(--surface-1)';
              const border = correct
                ? '1.5px solid rgba(22,163,74,0.4)'
                : chosen
                  ? '1.5px solid rgba(220,38,38,0.4)'
                  : '1px solid var(--border)';
              return (
                <div
                  key={i}
                  className="rounded-lg px-3 py-2 text-xs flex items-start gap-2"
                  style={{ background: bg, border }}
                >
                  <span className="font-bold text-[var(--text-3)]">{String.fromCharCode(65 + i)}.</span>
                  <span className="flex-1" style={{ color: 'var(--text-1)' }}>{opt}</span>
                  {correct && <span style={{ color: '#16A34A' }} aria-label={isHi ? 'सही उत्तर' : 'correct answer'}>✓</span>}
                  {chosen && !correct && <span style={{ color: '#DC2626' }} aria-label={isHi ? 'आपका उत्तर' : 'your answer'}>✗</span>}
                </div>
              );
            })}
          </div>
          {item.explanation && (
            <div
              className="rounded-lg px-3 py-2 text-xs leading-relaxed"
              style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)' }}
            >
              <p className="font-bold mb-1" style={{ color: '#7C3AED' }}>
                {isHi ? 'व्याख्या' : 'Explanation'}
              </p>
              <p style={{ color: 'var(--text-1)' }}>{item.explanation}</p>
            </div>
          )}
          {/* TODO(assessment): wire to /api/review/mark when revision review queue lands. */}
          <button
            type="button"
            data-testid="mock-results-review-bookmark"
            className="text-xs font-semibold rounded-lg px-2.5 py-1.5"
            style={{ background: 'var(--surface-1)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
          >
            {isHi ? 'पुनरीक्षण हेतु चिह्नित करें' : 'Mark this for revision'}
          </button>
        </div>
      )}
    </div>
  );
}
