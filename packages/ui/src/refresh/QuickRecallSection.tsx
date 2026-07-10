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
 * Auto-hides (renders null) when there are 0 cards due. The parent
 * page is responsible for showing the empty-state nudge in that case.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { getReviewCards as getDomainReviewCards } from '@alfanumrik/lib/domains/profile';
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

const QUALITY_BUTTONS = [
  { q: 0, label: '😵 Forgot', labelHi: '😵 भूल गया', color: '#DC2626' },
  { q: 3, label: '😐 Hard',   labelHi: '😐 कठिन',   color: '#D97706' },
  { q: 4, label: '🙂 Good',   labelHi: '🙂 ठीक',    color: '#0891B2' },
  { q: 5, label: '😎 Easy',   labelHi: '😎 आसान',   color: '#16A34A' },
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
      <div className="text-center py-6 text-sm text-[var(--text-3)]">
        {isHi ? 'कार्ड लोड हो रहे हैं...' : 'Loading cards...'}
      </div>
    );
  }
  if (cards.length === 0) return null;

  const card = cards[currentIdx];

  return (
    <section data-testid="refresh-section-a" className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? '⚡ झटपट याद' : '⚡ Quick Recall'}
        </h2>
        <span className="text-xs text-[var(--text-3)] font-medium">
          {currentIdx + 1}/{cards.length}
        </span>
      </header>

      <div className="text-center text-xs text-[var(--text-3)]">
        {/* Display hardening: quiz-review cards write `topic` as a machine
            composite dedupe key (subject:chapter:question_id). humaneCardLabel
            renders it as "Chapter N" (Hindi: "अध्याय N") and passes
            human-readable topics (Foxy cards) through untouched. The subject
            is already rendered here, so includeSubject is false. */}
        {card.subject} · {humaneCardLabel(card.chapter_title || card.topic, { isHi, includeSubject: false })}
      </div>

      <button
        onClick={() => setFlipped(!flipped)}
        className="w-full min-h-[200px] rounded-2xl p-6 flex flex-col items-center justify-center text-center transition-all active:scale-[0.98]"
        style={{
          background: flipped
            ? 'linear-gradient(135deg, rgba(8,145,178,0.06), rgba(22,163,74,0.06))'
            : 'var(--surface-1)',
          border: `1.5px solid ${flipped ? 'var(--teal, #0891B2)' : 'var(--border)'}`,
        }}
      >
        {flipped ? (
          <>
            <div className="text-xs text-[var(--text-3)] mb-3 uppercase tracking-wider font-semibold">
              {isHi ? 'उत्तर' : 'Answer'}
            </div>
            <div className="text-base leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>
              {card.back_text}
            </div>
          </>
        ) : (
          <>
            <div className="text-xs text-[var(--text-3)] mb-3 uppercase tracking-wider font-semibold">
              {isHi ? 'प्रश्न' : 'Question'}
            </div>
            <div className="text-lg font-semibold leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>
              {card.front_text}
            </div>
            {!showHint && card.hint && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowHint(true); }}
                className="mt-4 text-xs px-4 py-1.5 rounded-full"
                style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
              >
                💡 {isHi ? 'संकेत' : 'Hint'}
              </button>
            )}
            {showHint && card.hint && (
              <div className="mt-4 text-sm p-3 rounded-xl" style={{ background: 'rgba(245,166,35,0.08)' }}>
                💡 {card.hint}
              </div>
            )}
          </>
        )}
      </button>

      {flipped && (
        <div className="grid grid-cols-4 gap-2">
          {QUALITY_BUTTONS.map((btn) => (
            <button
              key={btn.q}
              onClick={() => rateCard(btn.q)}
              data-testid={`refresh-quality-${btn.q}`}
              className="py-3 rounded-xl text-xs font-semibold transition-all active:scale-95"
              style={{
                background: `${btn.color}10`,
                border: `1.5px solid ${btn.color}30`,
                color: btn.color,
              }}
            >
              {isHi ? btn.labelHi : btn.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
