'use client';

import { useEffect, useState, useRef } from 'react';
import { FoxyAvatar } from '@/components/ui';

interface CelebrationOverlayProps {
  scorePercent: number;
  xpEarned: number;
  isHi: boolean;
  onDismiss: () => void;
  /** Optional CME next-action recommendation, e.g. "Practice Trigonometry" */
  cmeRecommendation?: string | null;
}

export default function CelebrationOverlay({
  scorePercent,
  xpEarned,
  isHi,
  onDismiss,
  cmeRecommendation,
}: CelebrationOverlayProps) {
  const [displayScore, setDisplayScore] = useState(0);
  const [phase, setPhase] = useState<'enter' | 'visible' | 'exit'>('enter');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Grade badge
  const grade =
    scorePercent >= 90 ? 'A+' :
    scorePercent >= 80 ? 'A' :
    scorePercent >= 70 ? 'B' :
    scorePercent >= 60 ? 'C' :
    scorePercent >= 40 ? 'D' : 'F';

  const gradeColor =
    scorePercent >= 80 ? 'var(--green)' :
    scorePercent >= 60 ? 'var(--teal)' :
    scorePercent >= 40 ? 'var(--orange)' : 'var(--red)';

  // Motivational message
  const message =
    scorePercent >= 80
      ? (isHi ? 'शानदार!' : 'Amazing!')
      : scorePercent >= 60
        ? (isHi ? 'अच्छा किया!' : 'Good job!')
        : (isHi ? 'जारी रखो!' : 'Keep going!');

  const messageEmoji =
    scorePercent >= 80 ? '🎉' : scorePercent >= 60 ? '💪' : '🦊';

  // Count-up animation for score
  useEffect(() => {
    const duration = 1200; // ms
    const steps = 30;
    const increment = scorePercent / steps;
    let current = 0;
    let step = 0;

    countRef.current = setInterval(() => {
      step++;
      current = Math.min(Math.round(increment * step), scorePercent);
      setDisplayScore(current);
      if (step >= steps) {
        if (countRef.current) clearInterval(countRef.current);
      }
    }, duration / steps);

    return () => { if (countRef.current) clearInterval(countRef.current); };
  }, [scorePercent]);

  // Phase transitions
  useEffect(() => {
    // Enter -> visible after a brief moment
    const enterTimer = setTimeout(() => setPhase('visible'), 100);

    // Auto-dismiss after 3 seconds
    timerRef.current = setTimeout(() => {
      setPhase('exit');
      setTimeout(onDismiss, 400); // allow exit animation
    }, 3000);

    return () => {
      clearTimeout(enterTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onDismiss]);

  const handleDismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase('exit');
    setTimeout(onDismiss, 300);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6"
      style={{
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        opacity: phase === 'exit' ? 0 : 1,
        transition: 'opacity 0.3s ease-out',
      }}
      onClick={handleDismiss}
      role="dialog"
      aria-label={isHi ? 'क्विज़ पूरा हुआ' : 'Quiz completed'}
    >
      {/* Confetti burst ring */}
      {scorePercent >= 60 && (
        <div
          className="absolute animate-confetti rounded-full"
          style={{
            width: 280,
            height: 280,
            border: `3px solid ${gradeColor}`,
            opacity: 0,
          }}
        />
      )}

      {/* Foxy mascot */}
      <div
        className="mb-4"
        style={{
          opacity: phase === 'enter' ? 0 : 1,
          transform: phase === 'enter' ? 'scale(0.5)' : 'scale(1)',
          transition: 'all 0.5s cubic-bezier(0.34,1.56,0.64,1)',
        }}
      >
        <FoxyAvatar state="happy" size="lg" />
      </div>

      {/* Score percentage — count-up */}
      <div
        className="animate-count-up"
        style={{ animationDelay: '0.2s' }}
      >
        <div
          className="text-7xl font-bold tabular-nums"
          style={{
            fontFamily: 'var(--font-display)',
            color: '#fff',
            textShadow: `0 0 40px ${gradeColor}60`,
          }}
        >
          {displayScore}%
        </div>
      </div>

      {/* Grade badge */}
      <div
        className="animate-grade-reveal mt-3"
      >
        <span
          className="inline-flex items-center justify-center text-2xl font-bold rounded-full"
          style={{
            width: 56,
            height: 56,
            background: gradeColor,
            color: '#fff',
            fontFamily: 'var(--font-display)',
            boxShadow: `0 4px 24px ${gradeColor}50`,
          }}
        >
          {grade}
        </span>
      </div>

      {/* Motivational message */}
      <p
        className="mt-4 text-xl font-bold text-white"
        style={{
          fontFamily: 'var(--font-display)',
          opacity: phase === 'enter' ? 0 : 1,
          transform: phase === 'enter' ? 'translateY(10px)' : 'translateY(0)',
          transition: 'all 0.5s ease-out 0.5s',
        }}
      >
        {message} {messageEmoji}
      </p>

      {/* XP earned */}
      {xpEarned > 0 && (
        <div
          className="mt-3 animate-count-up"
          style={{ animationDelay: '0.6s' }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold"
            style={{
              background: 'rgba(232,88,28,0.2)',
              border: '1px solid rgba(232,88,28,0.4)',
              color: 'var(--orange-light)',
            }}
          >
            ⭐ +{xpEarned} XP
          </span>
        </div>
      )}

      {/* CME next action recommendation */}
      {cmeRecommendation && (
        <div
          className="mt-3 animate-count-up"
          style={{ animationDelay: '0.9s' }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium"
            style={{
              background: 'rgba(124,58,237,0.15)',
              border: '1px solid rgba(124,58,237,0.3)',
              color: '#C4B5FD',
            }}
          >
            🦊 {isHi ? 'Foxy का सुझाव:' : 'Foxy suggests:'} {cmeRecommendation}
          </span>
        </div>
      )}

      {/* See Details button */}
      <button
        className="mt-6 text-sm font-semibold rounded-full px-6 py-2.5 transition-all active:scale-95"
        style={{
          background: 'rgba(255,255,255,0.15)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.25)',
          opacity: phase === 'enter' ? 0 : 1,
          transition: 'opacity 0.3s ease-out 0.8s',
        }}
        onClick={(e) => {
          e.stopPropagation();
          handleDismiss();
        }}
      >
        {isHi ? 'विवरण देखो →' : 'See Details →'}
      </button>
    </div>
  );
}
