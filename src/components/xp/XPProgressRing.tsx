'use client';

import { calculateLevel, xpToNextLevel, getLevelName } from '@/lib/xp-rules';

/* ─── Types ──────────────────────────────────────────────── */

interface XPProgressRingProps {
  totalXp: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  isHi: boolean;
}

/* ─── Size Map ───────────────────────────────────────────── */

const SIZE_MAP = {
  sm: { px: 48, stroke: 4, fontSize: 14, labelSize: 8, subSize: 7 },
  md: { px: 72, stroke: 5, fontSize: 20, labelSize: 10, subSize: 9 },
  lg: { px: 96, stroke: 6, fontSize: 28, labelSize: 12, subSize: 10 },
} as const;

/* ─── Component ──────────────────────────────────────────── */

export default function XPProgressRing({ totalXp, size = 'md', showLabel = true, isHi }: XPProgressRingProps) {
  const level = calculateLevel(totalXp);
  const { current, needed, progress } = xpToNextLevel(totalXp);
  const levelName = getLevelName(level);
  const dim = SIZE_MAP[size];

  const radius = (dim.px - dim.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      {/* Ring */}
      <div
        className="relative inline-flex items-center justify-center"
        style={{ width: dim.px, height: dim.px }}
        role="img"
        aria-label={
          isHi
            ? `\u0932\u0947\u0935\u0932 ${level}, ${current} / ${needed} XP`
            : `Level ${level}, ${current} / ${needed} XP`
        }
      >
        <svg
          width={dim.px}
          height={dim.px}
          style={{ transform: 'rotate(-90deg)' }}
          aria-hidden="true"
        >
          {/* Track */}
          <circle
            cx={dim.px / 2}
            cy={dim.px / 2}
            r={radius}
            fill="none"
            stroke="var(--surface-2)"
            strokeWidth={dim.stroke}
          />
          {/* Gradient definition */}
          <defs>
            <linearGradient id={`xp-ring-grad-${size}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#F97316" />
              <stop offset="100%" stopColor="#F59E0B" />
            </linearGradient>
          </defs>
          {/* Progress arc */}
          <circle
            cx={dim.px / 2}
            cy={dim.px / 2}
            r={radius}
            fill="none"
            stroke={`url(#xp-ring-grad-${size})`}
            strokeWidth={dim.stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="xp-progress-ring-fill"
            style={{
              transition: 'stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
        </svg>
        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-bold leading-none"
            style={{
              fontSize: dim.fontSize,
              color: 'var(--text-1)',
              fontFamily: 'var(--font-display)',
            }}
          >
            {level}
          </span>
          {size !== 'sm' && (
            <span
              className="font-medium leading-none mt-0.5"
              style={{ fontSize: dim.labelSize, color: 'var(--text-3)' }}
            >
              {isHi ? '\u0932\u0947\u0935\u0932' : 'Lvl'}
            </span>
          )}
        </div>
      </div>

      {/* Label below ring */}
      {showLabel && (
        <div className="text-center">
          <p
            className="font-bold leading-tight"
            style={{
              fontSize: dim.subSize + 2,
              color: 'var(--orange)',
              fontFamily: 'var(--font-display)',
            }}
          >
            {levelName}
          </p>
          <p
            className="font-medium"
            style={{ fontSize: dim.subSize, color: 'var(--text-3)' }}
          >
            {current} / {needed} XP
            {isHi
              ? ` \u0932\u0947\u0935\u0932 ${level + 1} \u0924\u0915`
              : ` to Level ${level + 1}`}
          </p>
        </div>
      )}
    </div>
  );
}
