'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { FoxyAvatar } from '@/components/ui';

interface CelebrationOverlayProps {
  scorePercent: number;
  xpEarned: number;
  isHi: boolean;
  onDismiss: () => void;
}

/**
 * Full-screen celebration overlay after quiz completion.
 * Uses canvas-confetti (~6KB gzip) for particle effects.
 *
 * Tiers:
 * - Perfect (100%): Gold+purple confetti from both sides + sparkle emoji
 * - High (>=80%): Gold confetti burst + "Outstanding!"
 * - Good (60-79%): Silver confetti + "Great job!"
 * - Below 60: No confetti, encouraging message
 *
 * XP count-up animation uses requestAnimationFrame.
 * Auto-dismisses after 3s or on tap.
 */
export default function CelebrationOverlay({
  scorePercent,
  xpEarned,
  isHi,
  onDismiss,
}: CelebrationOverlayProps) {
  const [displayXP, setDisplayXP] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const [phase, setPhase] = useState<'enter' | 'visible' | 'exit'>('enter');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const scoreRafRef = useRef<number | null>(null);

  const isPerfect = scorePercent === 100;
  const isHigh = scorePercent >= 80;
  const isGood = scorePercent >= 60;

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

  const message = isPerfect
    ? (isHi ? 'PERFECT!' : 'PERFECT!')
    : isHigh
      ? (isHi ? '\u0936\u093E\u0928\u0926\u093E\u0930!' : 'Outstanding!')
      : isGood
        ? (isHi ? '\u0905\u091A\u094D\u091B\u093E \u0915\u093F\u092F\u093E!' : 'Great job!')
        : (isHi ? '\u091C\u093E\u0930\u0940 \u0930\u0916\u094B!' : 'Keep going!');

  const messageEmoji = isPerfect ? '\u{1F31F}' : isHigh ? '\u{1F3C6}' : isGood ? '\u{1F44D}' : '\u{1F9CA}';

  // ── Fire canvas-confetti ──
  const fireConfetti = useCallback(() => {
    if (typeof window === 'undefined') return;

    const goldColors = ['#FFD700', '#FFA500', '#FF8C00', '#E8581C'];
    const silverColors = ['#C0C0C0', '#A0A0A0', '#B8B8B8', '#D4D4D4'];

    if (isPerfect) {
      // Center burst
      confetti({
        particleCount: 100,
        spread: 80,
        origin: { y: 0.55 },
        colors: [...goldColors, '#7C3AED', '#FF6B6B'],
        disableForReducedMotion: true,
      });
      // Side bursts after a short delay
      setTimeout(() => {
        confetti({
          particleCount: 60,
          angle: 60,
          spread: 55,
          origin: { x: 0, y: 0.6 },
          colors: goldColors,
          disableForReducedMotion: true,
        });
        confetti({
          particleCount: 60,
          angle: 120,
          spread: 55,
          origin: { x: 1, y: 0.6 },
          colors: goldColors,
          disableForReducedMotion: true,
        });
      }, 300);
    } else if (isHigh) {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: goldColors,
        disableForReducedMotion: true,
      });
    } else if (isGood) {
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.6 },
        colors: silverColors,
        disableForReducedMotion: true,
      });
    }
  }, [isPerfect, isHigh, isGood]);

  // ── Score count-up animation ──
  useEffect(() => {
    if (scorePercent <= 0) return;
    const duration = 1200;
    const start = performance.now();

    function animate(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - (1 - progress) * (1 - progress); // ease-out quad
      setDisplayScore(Math.round(eased * scorePercent));
      if (progress < 1) {
        scoreRafRef.current = requestAnimationFrame(animate);
      }
    }
    scoreRafRef.current = requestAnimationFrame(animate);
    return () => { if (scoreRafRef.current) cancelAnimationFrame(scoreRafRef.current); };
  }, [scorePercent]);

  // ── XP count-up animation (starts after score finishes) ──
  useEffect(() => {
    if (xpEarned <= 0) return;
    const delay = 1300; // start after score count-up
    const duration = 800;
    const t = setTimeout(() => {
      const start = performance.now();
      function animate(now: number) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - (1 - progress) * (1 - progress);
        setDisplayXP(Math.round(eased * xpEarned));
        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate);
        }
      }
      rafRef.current = requestAnimationFrame(animate);
    }, delay);
    return () => {
      clearTimeout(t);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [xpEarned]);

  // ── Phase transitions + confetti trigger ──
  useEffect(() => {
    const enterTimer = setTimeout(() => {
      setPhase('visible');
      fireConfetti();
      // Play XP sound
      import('@/lib/sounds').then(({ playSound }) => playSound('xp')).catch(() => {});
    }, 100);

    // Auto-dismiss after 3s
    timerRef.current = setTimeout(() => {
      setPhase('exit');
      setTimeout(onDismiss, 400);
    }, 3000);

    return () => {
      clearTimeout(enterTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onDismiss, fireConfetti]);

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
      aria-label={isHi ? '\u0915\u094D\u0935\u093F\u091C\u093C \u092A\u0942\u0930\u093E \u0939\u0941\u0906' : 'Quiz completed'}
    >
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
      <div className="animate-count-up" style={{ animationDelay: '0.2s' }}>
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
      <div className="animate-grade-reveal mt-3">
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

      {/* XP earned — animated count-up */}
      {xpEarned > 0 && (
        <div className="animate-count-up mt-3" style={{ animationDelay: '0.6s' }}>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold tabular-nums"
            style={{
              background: 'rgba(232,88,28,0.2)',
              border: '1px solid rgba(232,88,28,0.4)',
              color: 'var(--orange-light)',
            }}
          >
            +{displayXP} XP
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
        {isHi ? '\u0935\u093F\u0935\u0930\u0923 \u0926\u0947\u0916\u094B \u2192' : 'See Details \u2192'}
      </button>
    </div>
  );
}
