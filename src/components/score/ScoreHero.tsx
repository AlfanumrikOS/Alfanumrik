'use client';

import { useState, useEffect } from 'react';
import { getScoreColor } from './ScoreCard';

/* ─── Props ─────────────────────────────────────────────── */

interface ScoreHeroProps {
  overallScore: number;    // 0-100
  levelName: string;
  isHi: boolean;
}

/* ─── Ring Constants ────────────────────────────────────── */

const RING_SIZE = 160;
const STROKE_WIDTH = 12;
const RADIUS = (RING_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/* ─── Component ─────────────────────────────────────────── */

export default function ScoreHero({ overallScore, levelName, isHi }: ScoreHeroProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(overallScore)));
  const color = getScoreColor(clamped);
  const targetOffset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE;

  // Animate the ring on mount: start from empty, fill to target
  const [offset, setOffset] = useState(CIRCUMFERENCE);

  useEffect(() => {
    // Small delay so the browser can paint the initial state first
    const raf = requestAnimationFrame(() => {
      setOffset(targetOffset);
    });
    return () => cancelAnimationFrame(raf);
  }, [targetOffset]);

  const gradientId = 'score-hero-gradient';

  return (
    <div
      className="flex flex-col items-center gap-3 py-4 animate-fade-in"
      role="region"
      aria-label={
        isHi
          ? `समग्र स्कोर: ${clamped} — ${levelName}`
          : `Overall score: ${clamped} — ${levelName}`
      }
    >
      {/* Ring chart */}
      <div
        className="relative inline-flex items-center justify-center"
        style={{ width: RING_SIZE, height: RING_SIZE }}
      >
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          style={{ transform: 'rotate(-90deg)' }}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color} stopOpacity={0.6} />
            </linearGradient>
          </defs>

          {/* Background track */}
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--surface-2)"
            strokeWidth={STROKE_WIDTH}
          />

          {/* Animated progress arc */}
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            style={{
              transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-4xl font-bold leading-none"
            style={{
              color,
              fontFamily: 'var(--font-display)',
            }}
          >
            {clamped}
          </span>
          <span
            className="text-xs font-medium mt-1"
            style={{ color: 'var(--text-3)' }}
          >
            / 100
          </span>
        </div>
      </div>

      {/* Level name below */}
      <div className="text-center">
        <p
          className="text-base font-bold"
          style={{
            color,
            fontFamily: 'var(--font-display)',
          }}
        >
          {levelName}
        </p>
        <p
          className="text-xs font-medium mt-0.5"
          style={{ color: 'var(--text-3)' }}
        >
          {isHi ? 'समग्र प्रदर्शन स्कोर' : 'Overall Performance Score'}
        </p>
      </div>
    </div>
  );
}
