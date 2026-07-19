'use client';

/**
 * MasteryRadar — SVG radar chart for cross-subject mastery.
 * Inline SVG + Tailwind — no chart library (P10 budget).
 */

import React, { memo } from 'react';

interface MasteryRadarProps {
  subjects: Array<{
    subject: string;
    averageMastery: number;
  }>;
}

const SUBJECT_LABELS: Record<string, { en: string; hi: string; color: string }> = {
  math: { en: 'Math', hi: 'गणित', color: '#F97316' },
  science: { en: 'Science', hi: 'विज्ञान', color: '#10B981' },
  sst: { en: 'SST', hi: 'सामाजिक', color: '#8B5CF6' },
  english: { en: 'English', hi: 'अंग्रेजी', color: '#3B82F6' },
};

function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number
): { x: number; y: number } {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

export const MasteryRadar = memo(function MasteryRadar({
  subjects,
}: MasteryRadarProps) {
  if (subjects.length === 0) return null;

  const cx = 100;
  const cy = 100;
  const maxR = 80;
  const n = subjects.length;
  const angleStep = 360 / n;

  // Background grid (20%, 40%, 60%, 80%, 100%)
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];

  // Data points
  const points = subjects.map((s, i) => {
    const angle = i * angleStep;
    const r = (s.averageMastery / 100) * maxR;
    return polarToCartesian(cx, cy, r, angle);
  });

  const dataPath =
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') +
    ' Z';

  return (
    <div className="w-full max-w-[220px] mx-auto">
      <svg viewBox="0 0 200 200" className="w-full h-auto">
        {/* Grid circles */}
        {gridLevels.map((level) => (
          <circle
            key={level}
            cx={cx}
            cy={cy}
            r={maxR * level}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            className="text-gray-200 dark:text-gray-700"
          />
        ))}

        {/* Axis lines */}
        {subjects.map((_, i) => {
          const end = polarToCartesian(cx, cy, maxR, i * angleStep);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={end.x}
              y2={end.y}
              stroke="currentColor"
              strokeWidth="0.5"
              className="text-gray-200 dark:text-gray-700"
            />
          );
        })}

        {/* Data area */}
        <path
          d={dataPath}
          fill="rgba(249, 115, 22, 0.2)"
          stroke="#F97316"
          strokeWidth="2"
        />

        {/* Data points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="4"
            fill={SUBJECT_LABELS[subjects[i].subject]?.color ?? '#F97316'}
          />
        ))}

        {/* Labels */}
        {subjects.map((s, i) => {
          const labelR = maxR + 15;
          const pos = polarToCartesian(cx, cy, labelR, i * angleStep);
          const info = SUBJECT_LABELS[s.subject];
          return (
            <text
              key={i}
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="central"
              className="text-[9px] fill-gray-600 dark:fill-gray-400 font-medium"
            >
              {info?.en ?? s.subject}
            </text>
          );
        })}
      </svg>
    </div>
  );
});
