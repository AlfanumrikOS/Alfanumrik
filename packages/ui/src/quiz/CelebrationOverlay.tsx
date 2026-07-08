'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { FoxyAvatar } from '@alfanumrik/ui/ui';
import { Badge, Button } from '@alfanumrik/ui/ui/primitives';
import type { Tone } from '@alfanumrik/ui/ui/primitives/tokens';
import { bandForValue, bandLabel } from '@alfanumrik/lib/dashboard/mastery-band-labels';
import { CELEBRATION_CONFETTI, WARM_CONFETTI, NEUTRAL_BURST } from '@alfanumrik/lib/confetti-palette';

interface CelebrationOverlayProps {
  scorePercent: number;
  xpEarned: number;
  isHi: boolean;
  onDismiss: () => void;
}

/**
 * Full-screen celebration overlay after quiz completion, composed on the
 * canonical Dialog foundation (tokenised scrim + portal + focus management).
 * Uses canvas-confetti (~6KB gzip) for particle effects; the confetti canvas
 * paints above the dialog surface so the burst covers the whole viewport.
 *
 * Score band (Getting started / Building it / Strong) REPLACES the old
 * A+…F letter ladder — growth-mindset, no punitive grade. The score NUMBER
 * is the server value, displayed verbatim via count-up (P1: never recomputed).
 *
 * XP count-up animation uses requestAnimationFrame.
 * Auto-dismisses after 3s or on tap of "See Details" / the scrim.
 */
export default function CelebrationOverlay({
  scorePercent,
  xpEarned,
  isHi,
  onDismiss,
}: CelebrationOverlayProps) {
  const [displayXP, setDisplayXP] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const rafRef = useRef<number | null>(null);
  const scoreRafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissBtnRef = useRef<HTMLButtonElement | null>(null);

  const isPerfect = scorePercent === 100;
  const isHigh = scorePercent >= 80;
  const isGood = scorePercent >= 60;

  // Growth-mindset band label (no letter grade). Band drives the accent tone.
  const band = bandForValue(scorePercent);
  const bandText = bandLabel(band, isHi);
  // Non-punitive tone mapping — low reads as calm "info", never danger-red.
  const bandTone: Tone = band === 'high' ? 'success' : band === 'mid' ? 'warning' : 'info';

  const message = isPerfect
    ? 'PERFECT!'
    : isHigh
      ? (isHi ? 'शानदार!' : 'Outstanding!')
      : isGood
        ? (isHi ? 'अच्छा किया!' : 'Great job!')
        : (isHi ? 'जारी रखो!' : 'Keep going!');

  const messageEmoji = isPerfect ? '\u{1F31F}' : isHigh ? '\u{1F3C6}' : isGood ? '\u{1F44D}' : '\u{1F9CA}';

  // ── Fire canvas-confetti ──
  const fireConfetti = useCallback(() => {
    if (typeof window === 'undefined') return;

    const goldColors = WARM_CONFETTI;
    const silverColors = NEUTRAL_BURST;

    if (isPerfect) {
      confetti({
        particleCount: 100,
        spread: 80,
        origin: { y: 0.55 },
        colors: CELEBRATION_CONFETTI,
        disableForReducedMotion: true,
      });
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
    const delay = 1300;
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

  // ── Confetti + sound on mount, auto-dismiss after 3s ──
  useEffect(() => {
    const enterTimer = setTimeout(() => {
      fireConfetti();
      import('@alfanumrik/lib/sounds').then(({ playSound }) => playSound('xp')).catch((err: unknown) => {
        console.warn('[celebration] sound playback failed:', err instanceof Error ? err.message : String(err));
      });
    }, 100);

    timerRef.current = setTimeout(onDismiss, 3000);

    return () => {
      clearTimeout(enterTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onDismiss, fireConfetti]);

  const handleDismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    onDismiss();
  }, [onDismiss]);

  // ── aria-modal honesty: on-mount focus + Escape-to-dismiss ──
  // The overlay claims role="dialog" aria-modal="true", so keyboard users must
  // be able to (a) land inside it and (b) leave it via Escape. Neither the
  // confetti triggers nor the 3s auto-dismiss are touched here.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    // Move focus to the primary action so keyboard users start inside the
    // dialog. Honor prefers-reduced-motion by suppressing any scroll-into-view.
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    dismissBtnRef.current?.focus({ preventScroll: prefersReducedMotion });

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleDismiss]);

  return (
    // Full-viewport tokenised scrim + centered celebration surface. The scrim
    // click dismisses; the panel stops propagation. Confetti canvas (z-index
    // 100) paints above everything.
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--scrim)', zIndex: 'var(--z-modal)' }}
      onClick={handleDismiss}
      role="dialog"
      aria-modal="true"
      aria-label={isHi ? 'क्विज़ पूरा हुआ' : 'Quiz completed'}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl bg-surface-1 text-foreground shadow-lg px-6 py-8 flex flex-col items-center text-center animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Foxy mascot */}
        <div className="mb-4">
          <FoxyAvatar state="happy" size="lg" />
        </div>

        {/* Score percentage — count-up (server value, verbatim) */}
        <div className="text-6xl font-bold tabular-nums text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
          {displayScore}%
        </div>

        {/* Band badge — replaces the removed A+…F letter grade */}
        <div className="mt-3">
          <Badge tone={bandTone} variant="soft" className="text-fluid-sm px-3 py-1">
            {bandText}
          </Badge>
        </div>

        {/* Motivational message */}
        <p className="mt-4 text-fluid-lg font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
          {message} {messageEmoji}
        </p>

        {/* XP earned — animated count-up */}
        {xpEarned > 0 && (
          <div className="mt-3">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-fluid-sm font-bold tabular-nums"
              style={{
                background: 'color-mix(in srgb, var(--accent-warm) 16%, var(--surface-1))',
                border: '1px solid color-mix(in srgb, var(--accent-warm) 34%, transparent)',
                color: 'var(--accent-warm-strong)',
              }}
            >
              +{displayXP} XP
            </span>
          </div>
        )}

        {/* See Details button */}
        <Button
          ref={dismissBtnRef}
          variant="secondary"
          size="sm"
          className="mt-6"
          onClick={(e) => {
            e.stopPropagation();
            handleDismiss();
          }}
        >
          {isHi ? 'विवरण देखो →' : 'See Details →'}
        </Button>
      </div>
    </div>
  );
}
