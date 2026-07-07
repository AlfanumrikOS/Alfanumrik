'use client';

/**
 * /exams/mock/[paperId]/results — Mock test results page (PR-6).
 *
 * Reads the submission result from sessionStorage (keyed by attempt_id) that
 * useMockTestState stashed at submit time. This avoids a re-fetch.
 *
 * Empty state — when the user lands here via deep-link / refresh and there is
 * no stashed result, we show a friendly "Results unavailable" card. A future
 * PR will wire `/api/exams/attempts/[id]` and replace the empty state with an
 * authoritative fetch.
 *
 * Layout, top → bottom:
 *   1. Header — paper id + submitted-at + total time taken
 *   2. Score card — large score_percent + X/Y correct + XP chip
 *   3. Breakdown bar — correct / wrong / skipped segments
 *   4. Chapter breakdown — per-chapter accuracy (weak ones flagged)
 *   5. Review cards — collapsible per-question review
 *   6. CTA footer — Take another / View progress
 *
 * P1 — score_percent / xp_earned NEVER recalculated; we display server values.
 * P7 — bilingual via isHi. Technical terms (XP, JEE, NEET) stay English.
 * P13 — no logging of response_index / correct_answer_index / question_text.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { LoadingFoxy } from '@alfanumrik/ui/ui';
import { RESULT_STORAGE_PREFIX } from '@alfanumrik/ui/exams/useMockTestState';
import type { SubmitResult } from '@alfanumrik/ui/exams/mock-test-types';
import {
  BreakdownBar,
  ChapterBreakdown,
  ResultsHeader,
  ReviewCard,
  ScoreCard,
  rollupByChapter,
} from '@alfanumrik/ui/exams/MockTestResultsParts';

const CARD_STYLE = { background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' };
const PRIMARY_CLS = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold';
const PRIMARY_STYLE = { background: 'linear-gradient(135deg, var(--orange), var(--orange-light, #FB923C))', color: '#fff' };
const SECONDARY_CLS = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold';
const SECONDARY_STYLE = { background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--border)' };

function EmptyState({ isHi }: { isHi: boolean }) {
  return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center p-6">
      <div className="rounded-2xl p-6 max-w-md w-full text-center space-y-4" style={CARD_STYLE} data-testid="mock-results-empty">
        <div className="text-5xl" aria-hidden="true">📭</div>
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? 'परिणाम उपलब्ध नहीं' : 'Results unavailable'}
        </h2>
        <p className="text-sm text-[var(--text-3)]">
          {isHi
            ? 'यह परिणाम सत्र अब उपलब्ध नहीं है। एक और मॉक टेस्ट लें।'
            : 'This result session is no longer available. Take another test.'}
        </p>
        <Link href="/exams/mock" className={PRIMARY_CLS} style={PRIMARY_STYLE}>
          {isHi ? 'अन्य पेपर देखें' : 'Take another test'}
        </Link>
      </div>
    </div>
  );
}

export default function MockTestResultsPage() {
  const { isHi } = useAuth();
  const params = useParams<{ paperId: string }>();
  const search = useSearchParams();
  const attemptId = search?.get('attempt') ?? null;

  const [result, setResult] = useState<SubmitResult | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    if (!attemptId) return;
    try {
      if (typeof window === 'undefined') return;
      const raw = sessionStorage.getItem(`${RESULT_STORAGE_PREFIX}${attemptId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SubmitResult;
      if (parsed && parsed.summary && Array.isArray(parsed.review)) {
        setResult(parsed);
      }
    } catch { /* corrupt entry — treat as missing */ }
  }, [attemptId]);

  const rollups = useMemo(
    () => (result ? rollupByChapter(result.review, isHi) : []),
    [result, isHi],
  );

  if (!hydrated) return <LoadingFoxy />;
  if (!attemptId || !result) return <EmptyState isHi={isHi} />;

  const paperIdSegment = params?.paperId ?? result.paper_id;

  return (
    <div className="mesh-bg min-h-dvh pb-24">
      <main className="app-container py-5 space-y-4">
        <ResultsHeader result={result} isHi={isHi} />
        <ScoreCard summary={result.summary} isHi={isHi} />
        <BreakdownBar summary={result.summary} isHi={isHi} />
        <ChapterBreakdown rollups={rollups} isHi={isHi} />

        <div className="space-y-2" data-testid="mock-results-review-list">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)] px-1">
            {isHi ? 'प्रश्न-दर-प्रश्न समीक्षा' : 'Question-by-question review'}
          </p>
          {result.review.map(item => (
            <ReviewCard key={item.question_id} item={item} isHi={isHi} />
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap pt-2" data-testid="mock-results-cta">
          <Link href="/exams/mock" className={PRIMARY_CLS} style={PRIMARY_STYLE}>
            {isHi ? 'एक और मॉक टेस्ट लें' : 'Take another mock test'}
          </Link>
          <Link href="/progress" className={SECONDARY_CLS} style={SECONDARY_STYLE}>
            {isHi ? 'प्रगति देखें' : 'View progress'}
          </Link>
        </div>

        {paperIdSegment && (
          <p className="text-[10px] text-[var(--text-3)] text-center pt-2" aria-hidden="true">
            · {paperIdSegment.slice(0, 8)} ·
          </p>
        )}
      </main>
    </div>
  );
}
