'use client';

/**
 * Refresh page — Section A "Quick Recall".
 *
 * Renders up to 5 due SM-2 flashcards with the standard flip-and-rate
 * UI. Calls the existing POST /api/learner/review/grade endpoint for
 * each rating (preserves the learner.review_graded event publish).
 *
 * Extracted from src/app/review/page.tsx (2026-05-20). The card-flip
 * UI, rate-limiting, and double-rate guards are copied verbatim — this
 * is a presentation refactor, not an engine change.
 *
 * Phase 8 rebuild: presentation now rides the canonical primitives
 * (Button grading controls + Skeleton loader) and token-only colour. The
 * SM-2 grade values (0/3/4/5), rate-limit guard, double-rate guard, the
 * POST to /api/learner/review/grade, and every data-testid are UNCHANGED.
 *
 * Auto-hides (renders null) when there are 0 cards due. The parent
 * page is responsible for showing the empty-state nudge in that case.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { getReviewCards as getDomainReviewCards } from '@alfanumrik/lib/domains/profile';
import { Button, Skeleton } from '@alfanumrik/ui/ui/primitives';
import { humaneCardLabel } from '@alfanumrik/lib/srs-card-label';

interface ReviewCard {
  id: string;
  subject: string;
  topic: string;
  chapter_title: string;
  front_text: string;
  back_text: string;
  hint: string;
  source: string | null;
  ease_factor: number;
  interval_days: number;
  streak: number;
  repetition_count: number;
  total_reviews: number;
  correct_reviews: number;
  last_review_date: string | null;
}

// SM-2 grade values are load-bearing (again=0 / hard=3 / good=4 / easy=5) —
// only the presentation `toneVar` is a token. Each label carries an emoji AND a
// word so the rating is legible without colour (WCAG 1.4.1).
const QUALITY_BUTTONS = [
  { q: 0, label: '😵 Forgot', labelHi: '😵 भूल गया', toneVar: 'var(--danger)' },
  { q: 3, label: '😐 Hard',   labelHi: '😐 कठिन',   toneVar: 'var(--warning)' },
  { q: 4, label: '🙂 Good',   labelHi: '🙂 ठीक',    toneVar: 'var(--info)' },
  { q: 5, label: '😎 Easy',   labelHi: '😎 आसान',   toneVar: 'var(--success)' },
] as const;

const MAX_REVIEWS_PER_MINUTE = 20;

export interface QuickRecallSectionProps {
  /** Called after the section finishes loading cards. Parent uses this
   *  to decide whether to show the empty-state nudge below. */
  onLoaded?: (cardCount: number) => void;
  /** Called whenever a card is graded — parent may want to bump a
   *  visible counter or refresh adjacent sections. */
  onGraded?: () => void;
}

export default function QuickRecallSection({ onLoaded, onGraded }: QuickRecallSectionProps) {
  const { student, isHi } = useAuth();
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [loading, setLoading] = useState(true);

  const reviewedCardIds = useRef(new Set<string>());
  const reviewTimestamps = useRef<number[]>([]);

  const load = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    try {
      const result = await getDomainReviewCards(student.id, 20);
      const loaded: ReviewCard[] = result.ok && Array.isArray(result.data)
        ? (result.data as ReviewCard[]).slice(0, 5)
        : [];
      setCards(loaded);
      onLoaded?.(loaded.length);
    } catch {
      setCards([]);
      onLoaded?.(0);
    } finally {
      setLoading(false);
    }
  }, [student, onLoaded]);

  useEffect(() => { void load(); }, [load]);

  const rateCard = async (quality: 0 | 3 | 4 | 5) => {
    const card = cards[currentIdx];
    if (!card || !student) return;

    if (reviewedCardIds.current.has(card.id)) {
      if (currentIdx < cards.length - 1) setCurrentIdx(i => i + 1);
      else setCards([]);
      return;
    }

    const now = Date.now();
    reviewTimestamps.current = reviewTimestamps.current.filter(t => now - t < 60_000);
    if (reviewTimestamps.current.length >= MAX_REVIEWS_PER_MINUTE) return;
    reviewTimestamps.current.push(now);

    reviewedCardIds.current.add(card.id);

    try {
      const res = await fetch('/api/learner/review/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ cardId: card.id, quality }),
      });
      if (!res.ok) reviewedCardIds.current.delete(card.id);
    } catch {
      reviewedCardIds.current.delete(card.id);
    }

    onGraded?.();
    setFlipped(false);
    setShowHint(false);
    if (currentIdx < cards.length - 1) setCurrentIdx(i => i + 1);
    else setCards([]);
  };

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only">{isHi ? 'कार्ड लोड हो रहे हैं...' : 'Loading cards...'}</span>
        <Skeleton className="h-5 w-40" />
        <Skeleton radius="lg" className="h-[200px] w-full" />
      </div>
    );
  }
  if (cards.length === 0) return null;

  const card = cards[currentIdx];

  return (
    <section data-testid="refresh-section-a" className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-fluid-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? '⚡ झटपट याद' : '⚡ Quick Recall'}
        </h2>
        <span className="text-fluid-xs font-medium tabular-nums text-muted-foreground">
          {currentIdx + 1}/{cards.length}
        </span>
      </header>

      <div className="text-center text-fluid-xs text-muted-foreground">
        {/* Display hardening: quiz-review cards write `topic` as a machine
            composite dedupe key (subject:chapter:question_id). humaneCardLabel
            renders it as "Chapter N" (Hindi: "अध्याय N") and passes
            human-readable topics (Foxy cards) through untouched. The subject
            is already rendered here, so includeSubject is false. */}
        {card.subject} · {humaneCardLabel(card.chapter_title || card.topic, { isHi, includeSubject: false })}
      </div>

      {/* Whole card taps to flip (a real <button>, keyboard-native). The hint
          control lives OUTSIDE the flip button below — no nested interactives. */}
      <button
        onClick={() => setFlipped(!flipped)}
        aria-pressed={flipped}
        className="flex min-h-[200px] w-full flex-col items-center justify-center rounded-xl border p-6 text-center transition-all duration-200 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        style={{
          background: flipped
            ? 'color-mix(in srgb, var(--info) 7%, var(--surface-1))'
            : 'var(--surface-1)',
          borderColor: flipped ? 'var(--info)' : 'var(--border)',
        }}
      >
        <span className="mb-3 text-fluid-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {flipped ? (isHi ? 'उत्तर' : 'Answer') : (isHi ? 'प्रश्न' : 'Question')}
        </span>
        <span
          className={flipped ? 'text-fluid-base leading-relaxed text-foreground' : 'text-fluid-md font-semibold leading-relaxed text-foreground'}
          style={{ whiteSpace: 'pre-wrap' }}
        >
          {flipped ? card.back_text : card.front_text}
        </span>
      </button>

      {!flipped && card.hint && !showHint && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHint(true)}
            leadingIcon={<span>💡</span>}
            className="rounded-full text-muted-foreground"
          >
            {isHi ? 'संकेत' : 'Hint'}
          </Button>
        </div>
      )}
      {!flipped && card.hint && showHint && (
        <div
          className="rounded-xl p-3 text-center text-fluid-sm text-foreground"
          style={{ background: 'color-mix(in srgb, var(--warning) 10%, var(--surface-1))' }}
        >
          💡 {card.hint}
        </div>
      )}

      {flipped && (
        <div className="grid grid-cols-4 gap-2">
          {QUALITY_BUTTONS.map((btn) => (
            <Button
              key={btn.q}
              variant="secondary"
              size="sm"
              fullWidth
              onClick={() => rateCard(btn.q)}
              data-testid={`refresh-quality-${btn.q}`}
              className="whitespace-normal px-1 text-fluid-xs leading-tight"
              style={{
                backgroundColor: `color-mix(in srgb, ${btn.toneVar} 12%, var(--surface-1))`,
                borderColor: `color-mix(in srgb, ${btn.toneVar} 34%, transparent)`,
                color: 'var(--text-1)',
              }}
            >
              {isHi ? btn.labelHi : btn.label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
