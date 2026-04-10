'use client';

import { useRouter } from 'next/navigation';

/**
 * Comeback Hook — Curiosity gap that pulls students back.
 *
 * Psychology: "You were 80% through Chapter 5" creates the Zeigarnik
 * effect — incomplete tasks stay in memory and create pull to finish.
 * Combined with "almost there" framing, this is the strongest
 * return trigger available.
 */

interface ComebackHookProps {
  isHi: boolean;
  lastTopic?: { title: string; subject: string; progress: number } | null;
  almostMastered?: { title: string; mastery: number } | null;
  dueReviews: number;
  streak: number;
  quizzesTaken: number;
}

export default function ComebackHook({ isHi, lastTopic, almostMastered, dueReviews, streak, quizzesTaken }: ComebackHookProps) {
  const router = useRouter();

  // Priority 1: Streak at risk (most urgent emotional trigger)
  if (streak > 0 && streak <= 2) {
    return (
      <button onClick={() => router.push('/quiz?mode=practice')} className="w-full text-left rounded-xl p-3 flex items-center gap-3 transition-all active:scale-[0.98]"
        style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
        <span className="text-xl">🔥</span>
        <div className="flex-1">
          <div className="text-xs font-bold" style={{ color: '#EF4444' }}>
            {isHi ? `${streak} दिन की स्ट्रीक! खोना मत!` : `${streak}-day streak! Don't lose it!`}
          </div>
          <div className="text-[10px] text-[var(--text-3)]">
            {isHi ? '1 क्विज़ लो और स्ट्रीक बचाओ' : 'Take 1 quiz to save your streak'}
          </div>
        </div>
        <span className="text-xs font-bold" style={{ color: '#EF4444' }}>→</span>
      </button>
    );
  }

  // Priority 2: Almost mastered (Zeigarnik effect — 80%+ progress)
  if (almostMastered && almostMastered.mastery >= 70 && almostMastered.mastery < 95) {
    const pct = Math.round(almostMastered.mastery);
    return (
      <button onClick={() => router.push('/quiz?mode=cognitive')} className="w-full text-left rounded-xl p-3 flex items-center gap-3 transition-all active:scale-[0.98]"
        style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)' }}>
        <span className="text-xl">🎯</span>
        <div className="flex-1">
          <div className="text-xs font-bold" style={{ color: '#7C3AED' }}>
            {isHi ? `${almostMastered.title} — ${pct}% पूरा!` : `${almostMastered.title} — ${pct}% mastered!`}
          </div>
          <div className="text-[10px] text-[var(--text-3)]">
            {isHi ? 'बस थोड़ा और — महारत हासिल करो' : 'Almost there — finish mastering it'}
          </div>
        </div>
        <span className="text-xs font-bold" style={{ color: '#7C3AED' }}>→</span>
      </button>
    );
  }

  // Priority 3: Unfinished topic (continue where you left off)
  if (lastTopic && lastTopic.progress > 0 && lastTopic.progress < 100) {
    return (
      <button onClick={() => router.push('/foxy')} className="w-full text-left rounded-xl p-3 flex items-center gap-3 transition-all active:scale-[0.98]"
        style={{ background: 'rgba(8,145,178,0.06)', border: '1px solid rgba(8,145,178,0.15)' }}>
        <span className="text-xl">▶️</span>
        <div className="flex-1">
          <div className="text-xs font-bold" style={{ color: '#0891B2' }}>
            {isHi ? `${lastTopic.title} — जारी रखो` : `Continue: ${lastTopic.title}`}
          </div>
          <div className="text-[10px] text-[var(--text-3)]">
            {isHi ? `${lastTopic.progress}% पूरा हुआ` : `${lastTopic.progress}% complete`}
          </div>
        </div>
        <span className="text-xs font-bold" style={{ color: '#0891B2' }}>→</span>
      </button>
    );
  }

  // Priority 4: Due reviews
  if (dueReviews > 0) {
    return (
      <button onClick={() => router.push('/review')} className="w-full text-left rounded-xl p-3 flex items-center gap-3 transition-all active:scale-[0.98]"
        style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.15)' }}>
        <span className="text-xl">🧠</span>
        <div className="flex-1">
          <div className="text-xs font-bold" style={{ color: '#F5A623' }}>
            {isHi ? `${dueReviews} चीज़ें भूलने वाली हैं!` : `${dueReviews} things you're about to forget!`}
          </div>
          <div className="text-[10px] text-[var(--text-3)]">
            {isHi ? '5 मिनट में याददाश्त मजबूत करो' : '5 min to lock them in'}
          </div>
        </div>
        <span className="text-xs font-bold" style={{ color: '#F5A623' }}>→</span>
      </button>
    );
  }

  return null;
}
