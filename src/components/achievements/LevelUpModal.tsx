'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { FoxyAvatar } from '@/components/ui';
import { WARM_CONFETTI, PURPLE_CONFETTI } from '@/lib/confetti-palette';

interface LevelUpModalProps {
  newLevel: number;       // 1-10
  levelNameEn: string;    // from LEVEL_NAMES
  levelNameHi: string;    // from LEVEL_NAMES_HI
  xpTotal: number;        // displayed with count-up animation
  isHi: boolean;          // P7 bilingual
  onDismiss: () => void;
}

/**
 * Full-screen level-up celebration modal.
 * Fires after CelebrationOverlay auto-dismisses (wired in QuizResults
 * with a 3200ms delay — 200ms after the 3s overlay exits).
 *
 * z-[60] sits above CelebrationOverlay's z-50.
 * Auto-dismisses after 4000ms (extra impact for level-up vs. 3s quiz overlay).
 * XP count-up animation uses requestAnimationFrame, same pattern as CelebrationOverlay.
 * Gold + purple confetti from center burst + 2 side bursts after 300ms.
 *
 * P7: All strings bilingual (EN + HI). No PII — only level number/name displayed.
 */
export default function LevelUpModal({
  newLevel,
  levelNameEn,
  levelNameHi,
  xpTotal,
  isHi,
  onDismiss,
}: LevelUpModalProps) {
  const [displayXP, setDisplayXP] = useState(0);
  const [phase, setPhase] = useState<'enter' | 'visible' | 'exit'>('enter');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  const levelName = isHi ? levelNameHi : levelNameEn;

  // ── Fire gold + purple confetti from both sides ──
  const fireConfetti = useCallback(() => {
    if (typeof window === 'undefined') return;

    // Brand-aligned celebration palette (shared, brand-wide).
    const goldColors = WARM_CONFETTI;
    const purpleColors = PURPLE_CONFETTI;
    const allColors = [...goldColors, ...purpleColors];

    // Center burst
    confetti({
      particleCount: 100,
      spread: 80,
      origin: { y: 0.55 },
      colors: allColors,
      disableForReducedMotion: true,
    });

    // Side bursts after 300ms
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
        colors: purpleColors,
        disableForReducedMotion: true,
      });
    }, 300);
  }, []);

  // ── XP count-up animation ──
  useEffect(() => {
    if (xpTotal <= 0) return;
    const delay = 600; // start after enter animation settles
    const duration = 1000;
    const t = setTimeout(() => {
      const start = performance.now();
      function animate(now: number) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - (1 - progress) * (1 - progress); // ease-out quad
        setDisplayXP(Math.round(eased * xpTotal));
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
  }, [xpTotal]);

  // ── Phase transitions + confetti trigger ──
  useEffect(() => {
    const enterTimer = setTimeout(() => {
      setPhase('visible');
      fireConfetti();
      import('@/lib/sounds').then(({ playSound }) => playSound('xp')).catch((err: unknown) => {
        console.warn('[level-up] sound playback failed:', err instanceof Error ? err.message : String(err));
      });
    }, 100);

    // Auto-dismiss after 4000ms (extra impact vs. 3s quiz overlay)
    timerRef.current = setTimeout(() => {
      setPhase('exit');
      setTimeout(onDismiss, 400);
    }, 4000);

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
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center px-6 bg-black/[0.72] backdrop-blur-[10px]"
      style={{
        /* Tailwind cannot express runtime-conditional transitions — inline required */
        WebkitBackdropFilter: 'blur(10px)',
        opacity: phase === 'exit' ? 0 : 1,
        transition: 'opacity 0.3s ease-out',
      }}
      onClick={handleDismiss}
      role="dialog"
      aria-modal="true"
      aria-label={isHi ? 'स्तर बढ़ा' : 'Level Up'}
    >
      {/* Foxy mascot */}
      <div
        className="mb-4"
        style={{
          /* Tailwind cannot express runtime-conditional transitions — inline required */
          opacity: phase === 'enter' ? 0 : 1,
          transform: phase === 'enter' ? 'scale(0.5)' : 'scale(1)',
          transition: 'all 0.5s cubic-bezier(0.34,1.56,0.64,1)',
        }}
      >
        <FoxyAvatar state="happy" size="lg" />
      </div>

      {/* Level badge — refined purple → warm gradient via design tokens.
          --purple → --accent-warm keeps the warm stop on-brand under cosmic
          (where --orange remaps to violet). Premium soft purple glow.
          Runtime opacity/transform stay inline (Tailwind can't express them). */}
      <div
        className="inline-flex items-center gap-2 rounded-full px-5 py-2 mb-5 text-sm font-bold text-white"
        style={{
          background: 'linear-gradient(135deg, var(--purple), var(--accent-warm))',
          boxShadow: '0 6px 28px rgb(var(--purple-rgb) / 0.38)',
          /* Tailwind cannot express runtime-conditional transitions — inline required */
          opacity: phase === 'enter' ? 0 : 1,
          transform: phase === 'enter' ? 'translateY(-8px) scale(0.9)' : 'translateY(0) scale(1)',
          transition: 'all 0.5s ease-out 0.2s',
          fontFamily: 'var(--font-display)',
        }}
      >
        <span>&#11088;</span>
        <span>Lv.{newLevel} &mdash; {levelName}</span>
      </div>

      {/* Title — warm glow via the stable warm channel (not --orange, which
          remaps to violet under cosmic). */}
      <h2
        className="text-4xl font-bold text-white mb-2"
        style={{
          textShadow: '0 0 40px rgb(var(--accent-warm-rgb) / 0.55)',
          fontFamily: 'var(--font-display)',
          /* Tailwind cannot express runtime-conditional transitions — inline required */
          opacity: phase === 'enter' ? 0 : 1,
          transform: phase === 'enter' ? 'scale(0.8)' : 'scale(1)',
          transition: 'all 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.1s',
        }}
      >
        {isHi ? '🎉 स्तर बढ़ा!' : '🎉 Level Up!'}
      </h2>

      {/* Subtitle */}
      <p
        className="text-lg font-semibold text-white/90 mb-6"
        style={{
          /* Tailwind cannot express runtime-conditional transitions — inline required */
          opacity: phase === 'enter' ? 0 : 1,
          transform: phase === 'enter' ? 'translateY(8px)' : 'translateY(0)',
          transition: 'all 0.5s ease-out 0.4s',
        }}
      >
        {isHi
          ? `आप अब ${levelName} हैं`
          : `You are now a ${levelNameEn}`}
      </p>

      {/* XP total chip — count-up animation */}
      <div
        style={{
          /* Tailwind cannot express runtime-conditional transitions — inline required */
          opacity: phase === 'enter' ? 0 : 1,
          transition: 'opacity 0.3s ease-out 0.6s',
        }}
      >
        <span
          className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold tabular-nums"
          style={{
            background: 'rgb(var(--accent-warm-rgb) / 0.22)',
            border: '1px solid rgb(var(--accent-warm-rgb) / 0.42)',
            /* warm channel keeps the chip text warm under cosmic (--orange-light
               remaps to violet there). */
            color: 'var(--accent-warm)',
          }}
        >
          <span>{isHi ? 'कुल XP:' : 'Total XP:'}</span>
          <span>{displayXP.toLocaleString()}</span>
        </span>
      </div>

      {/* Dismiss button */}
      <button
        className="mt-8 text-sm font-semibold rounded-full px-7 py-3 transition-all active:scale-95 min-w-[44px] min-h-[44px] bg-white/15 text-white border border-white/[0.25]"
        style={{
          /* Tailwind cannot express runtime-conditional transitions — inline required */
          opacity: phase === 'enter' ? 0 : 1,
          transition: 'opacity 0.3s ease-out 0.9s',
        }}
        onClick={(e) => {
          e.stopPropagation();
          handleDismiss();
        }}
      >
        {isHi ? 'जारी रखें →' : 'Continue →'}
      </button>
    </div>
  );
}
