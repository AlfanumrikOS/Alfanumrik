'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getReviewCards, supabase } from '@/lib/supabase';
import { Card, Button, LoadingFoxy, BottomNav } from '@/components/ui';

interface ReviewCard {
  id: string;
  subject: string;
  topic: string;
  chapter_title: string;
  front_text: string;
  back_text: string;
  hint: string;
  ease_factor: number;
  interval_days: number;
  streak: number;
  repetition_count: number;
  total_reviews: number;
  correct_reviews: number;
}

const QUALITY_BUTTONS = [
  { q: 0, label: '😵 Forgot', labelHi: '😵 भूल गया', color: '#DC2626' },
  { q: 3, label: '😐 Hard', labelHi: '😐 कठिन', color: '#D97706' },
  { q: 4, label: '🙂 Good', labelHi: '🙂 ठीक', color: '#0891B2' },
  { q: 5, label: '😎 Easy', labelHi: '😎 आसान', color: '#16A34A' },
];

export default function ReviewPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reviewed, setReviewed] = useState(0);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

  const load = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    try {
      const data = await getReviewCards(student.id, 20);
      setCards(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load review cards:', e);
      setCards([]);
    }
    setLoading(false);
  }, [student]);

  useEffect(() => {
    if (student) load();
  }, [student?.id, load]);

  const rateCard = async (quality: number) => {
    const card = cards[currentIdx];
    if (!card || !student) return;

    // SM-2 algorithm
    let newEase = card.ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (newEase < 1.3) newEase = 1.3;
    let newInterval = card.interval_days;
    let newStreak = card.streak;

    if (quality < 3) {
      newInterval = 1;
      newStreak = 0;
    } else {
      if (card.streak === 0) newInterval = 1;
      else if (card.streak === 1) newInterval = 6;
      else newInterval = Math.round(card.interval_days * newEase);
      newStreak = card.streak + 1;
    }

    // Update in DB
    try {
      await supabase
        .from('spaced_repetition_cards')
        .update({
          ease_factor: newEase,
          interval_days: newInterval,
          streak: newStreak,
          repetition_count: (card.repetition_count || 0) + 1,
          next_review_date: new Date(
            Date.now() + newInterval * 86400000
          ).toISOString().split('T')[0],
          last_review_date: new Date().toISOString().split('T')[0],
          last_quality: quality,
          total_reviews: (card.total_reviews || 0) + 1,
          correct_reviews: (card.correct_reviews || 0) + (quality >= 3 ? 1 : 0),
          updated_at: new Date().toISOString(),
        })
        .eq('id', card.id);
    } catch (e) {
      console.error('Failed to update card:', e);
    }

    setReviewed((r) => r + 1);
    setFlipped(false);
    setShowHint(false);

    if (currentIdx < cards.length - 1) {
      setCurrentIdx((i) => i + 1);
    } else {
      // All done
      setCards([]);
    }
  };

  if (isLoading || !student) return <LoadingFoxy />;

  const card = cards[currentIdx];
  const remaining = cards.length - currentIdx;

  return (
    <div className="mesh-bg min-h-dvh pb-nav flex flex-col">
      {/* Header */}
      <header
        className="page-header"
        style={{
          background: 'rgba(251,248,244,0.88)',
          backdropFilter: 'blur(20px)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="app-container py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">
              ←
            </button>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              🔄 {isHi ? 'रिव्यू' : 'Review'}
            </h1>
          </div>
          {cards.length > 0 && (
            <span className="text-xs text-[var(--text-3)] font-medium">
              {remaining} {isHi ? 'बाकी' : 'remaining'}
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-lg mx-auto px-4 py-6 w-full flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl animate-float mb-3">🔄</div>
              <p className="text-sm text-[var(--text-3)]">
                {isHi ? 'कार्ड लोड हो रहे हैं...' : 'Loading review cards...'}
              </p>
            </div>
          </div>
        ) : !card ? (
          /* All done or no cards */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-5xl mb-4">{reviewed > 0 ? '🎉' : '✨'}</div>
              <h3
                className="text-xl font-bold mb-2"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {reviewed > 0
                  ? isHi
                    ? 'शाबाश! सब रिव्यू हो गया!'
                    : 'Great job! All reviews done!'
                  : isHi
                    ? 'कोई रिव्यू बाकी नहीं'
                    : 'No reviews due'}
              </h3>
              <p className="text-sm text-[var(--text-3)] max-w-xs mx-auto mb-4">
                {reviewed > 0
                  ? isHi
                    ? `${reviewed} कार्ड रिव्यू किये। तुम्हारी याददाश्त मजबूत हो रही है!`
                    : `${reviewed} cards reviewed. Your memory is getting stronger!`
                  : isHi
                    ? 'क्विज़ खेलो — नए रिव्यू कार्ड अपने आप बनेंगे।'
                    : 'Take quizzes to generate review cards automatically.'}
              </p>
              <div className="flex gap-2 justify-center">
                <Button onClick={() => router.push('/quiz')}>
                  {isHi ? 'क्विज़ खेलो' : 'Take a Quiz'} ⚡
                </Button>
                <Button variant="ghost" onClick={() => router.push('/dashboard')}>
                  {isHi ? 'होम' : 'Home'}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* Flashcard UI */
          <div className="flex-1 flex flex-col gap-4">
            {/* Progress bar */}
            <div className="flex items-center gap-2">
              <div
                className="flex-1 h-2 rounded-full overflow-hidden"
                style={{ background: 'var(--surface-2)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${(currentIdx / cards.length) * 100}%`,
                    background: 'var(--orange)',
                  }}
                />
              </div>
              <span className="text-xs text-[var(--text-3)] font-medium">
                {currentIdx + 1}/{cards.length}
              </span>
            </div>

            {/* Subject/Chapter label */}
            <div className="text-center">
              <span className="text-xs font-semibold px-3 py-1 rounded-full"
                style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
                {card.subject} · {card.chapter_title || card.topic}
              </span>
            </div>

            {/* Card */}
            <button
              onClick={() => setFlipped(!flipped)}
              className="flex-1 min-h-[240px] rounded-2xl p-6 flex flex-col items-center justify-center text-center transition-all active:scale-[0.98]"
              style={{
                background: flipped
                  ? 'linear-gradient(135deg, rgba(8,145,178,0.06), rgba(22,163,74,0.06))'
                  : 'var(--surface-1)',
                border: `1.5px solid ${flipped ? 'var(--teal, #0891B2)' : 'var(--border)'}`,
                boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowHint(true);
                      }}
                      className="mt-4 text-xs px-4 py-1.5 rounded-full"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
                    >
                      💡 {isHi ? 'संकेत दिखाओ' : 'Show Hint'}
                    </button>
                  )}
                  {showHint && card.hint && (
                    <div
                      className="mt-4 text-sm p-3 rounded-xl"
                      style={{ background: 'rgba(245,166,35,0.08)', color: 'var(--text-2)' }}
                    >
                      💡 {card.hint}
                    </div>
                  )}
                </>
              )}
            </button>

            {/* Tap to flip hint */}
            {!flipped && (
              <p className="text-center text-xs text-[var(--text-3)]">
                {isHi ? 'उत्तर देखने के लिए टैप करो' : 'Tap the card to reveal the answer'}
              </p>
            )}

            {/* Rating Buttons — only show when flipped */}
            {flipped && (
              <div>
                <p className="text-center text-xs text-[var(--text-3)] mb-2">
                  {isHi ? 'कितना याद था?' : 'How well did you remember?'}
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {QUALITY_BUTTONS.map((btn) => (
                    <button
                      key={btn.q}
                      onClick={() => rateCard(btn.q)}
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
              </div>
            )}

            {/* Streak indicator */}
            <div className="text-center text-xs text-[var(--text-3)]">
              {card.streak > 0 && `🔥 ${card.streak} ${isHi ? 'बार सही' : 'correct streak'}`}
              {card.streak === 0 && (isHi ? 'पहली बार या फिर से सीखो' : 'First time or relearning')}
            </div>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
