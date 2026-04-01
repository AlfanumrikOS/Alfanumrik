'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getReviewCards, supabase } from '@/lib/supabase';
import { Card, Button, LoadingFoxy, BottomNav, EmptyState } from '@/components/ui';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';

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

interface RetentionTest {
  id: string;
  topic_title: string;
  subject: string;
  predicted_retention: number;
  scheduled_date: string;
}

export default function ReviewPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reviewed, setReviewed] = useState(0);
  const [retentionTests, setRetentionTests] = useState<RetentionTest[]>([]);

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
    // Load pending retention tests
    try {
      const { data: tests } = await supabase
        .from('retention_tests')
        .select('id, topic_title, subject, predicted_retention, scheduled_date')
        .eq('student_id', student.id)
        .eq('status', 'pending')
        .lte('scheduled_date', new Date().toISOString().split('T')[0])
        .order('scheduled_date')
        .limit(5);
      setRetentionTests(tests ?? []);
    } catch {
      setRetentionTests([]);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on student.id to avoid re-running on object reference changes
  }, [student?.id]);

  useEffect(() => {
    if (student) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- student?.id is the stable identity; student object reference changes on every render
  }, [student?.id, load]);

  // Track which cards have been reviewed in this session to prevent double-rating
  const reviewedCardIds = useRef(new Set<string>());

  // Rate limit: max reviews per minute (prevents automated rapid-fire reviews)
  const reviewTimestamps = useRef<number[]>([]);
  const MAX_REVIEWS_PER_MINUTE = 20; // Human can't genuinely review faster than this

  const rateCard = async (quality: number) => {
    const card = cards[currentIdx];
    if (!card || !student) return;

    // SECURITY: Prevent double-rating the same card in one session
    if (reviewedCardIds.current.has(card.id)) {
      console.warn('[Security] Card already reviewed in this session:', card.id);
      // Skip to next card
      if (currentIdx < cards.length - 1) setCurrentIdx(i => i + 1);
      else setCards([]);
      return;
    }

    // SECURITY: Rate limit — detect automated review bots
    const now = Date.now();
    reviewTimestamps.current = reviewTimestamps.current.filter(t => now - t < 60_000);
    if (reviewTimestamps.current.length >= MAX_REVIEWS_PER_MINUTE) {
      console.warn('[Security] Review rate limit exceeded — possible automation');
      return;
    }
    reviewTimestamps.current.push(now);

    // SECURITY: Validate quality is a valid value (not injected via DevTools)
    if (![0, 1, 2, 3, 4, 5].includes(quality)) {
      console.warn('[Security] Invalid quality value:', quality);
      return;
    }

    // SM-2 algorithm
    let newEase = card.ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (newEase < 1.3) newEase = 1.3;
    // Cap ease factor to prevent runaway values from manipulation
    if (newEase > 3.0) newEase = 3.0;

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

    // Cap interval to prevent absurd values (max 365 days)
    if (newInterval > 365) newInterval = 365;
    // Cap streak to prevent overflow (max 100)
    if (newStreak > 100) newStreak = 100;

    // Mark as reviewed before DB call to prevent double-click
    reviewedCardIds.current.add(card.id);

    // Update in DB (RLS ensures student can only update their own cards)
    try {
      const { error } = await supabase
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

      if (error) {
        console.error('Failed to update card:', error);
        reviewedCardIds.current.delete(card.id); // Allow retry on error
      }
    } catch (e) {
      console.error('Failed to update card:', e);
      reviewedCardIds.current.delete(card.id);
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
        <SectionErrorBoundary section="Flashcard Review">
        {/* Retention Tests Due */}
        {retentionTests.length > 0 && !loading && (
          <div className="mb-4 rounded-2xl p-4" style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)' }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">🧠</span>
              <span className="text-sm font-bold" style={{ color: '#7C3AED' }}>
                {retentionTests.length} {isHi ? 'रिटेंशन टेस्ट बाकी' : 'Retention Tests Due'}
              </span>
            </div>
            <div className="space-y-1.5">
              {retentionTests.map(test => (
                <div key={test.id} className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: test.predicted_retention < 0.5 ? '#EF4444' : '#F59E0B' }} />
                  <span className="flex-1 truncate font-medium" style={{ color: 'var(--text-2)' }}>
                    {test.topic_title}
                  </span>
                  <span className="text-[var(--text-3)] flex-shrink-0">
                    {Math.round((test.predicted_retention ?? 0) * 100)}% {isHi ? 'याददाश्त' : 'retention'}
                  </span>
                </div>
              ))}
            </div>
            <button
              onClick={() => router.push('/quiz?mode=cognitive')}
              className="mt-2 w-full py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
              style={{ background: 'rgba(124,58,237,0.1)', color: '#7C3AED', border: '1px solid rgba(124,58,237,0.2)' }}
            >
              🧠 {isHi ? 'रिटेंशन टेस्ट लो' : 'Take Retention Test'}
            </button>
          </div>
        )}

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
            <EmptyState
              icon={reviewed > 0 ? '🎉' : '🎉'}
              title={
                reviewed > 0
                  ? isHi
                    ? 'शाबाश! सब रिव्यू हो गया!'
                    : 'Great job! All reviews done!'
                  : isHi
                    ? 'सब पूरा! कोई रिव्यू बाकी नहीं।'
                    : 'All caught up! No reviews due.'
              }
              description={
                reviewed > 0
                  ? isHi
                    ? `${reviewed} कार्ड रिव्यू किये। तुम्हारी याददाश्त मजबूत हो रही है!`
                    : `${reviewed} cards reviewed. Your memory is getting stronger!`
                  : isHi
                    ? 'बहुत बढ़िया, ट्रैक पर हो!'
                    : 'Great job staying on track.'
              }
              action={
                <div className="flex gap-2 justify-center">
                  <Button onClick={() => router.push('/quiz')}>
                    {isHi ? 'क्विज़ खेलो' : 'Take a Quiz'} ⚡
                  </Button>
                  <Button variant="ghost" onClick={() => router.push('/dashboard')}>
                    {isHi ? 'होम' : 'Home'}
                  </Button>
                </div>
              }
            />
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
        </SectionErrorBoundary>
      </main>

      <BottomNav />
    </div>
  );
}
