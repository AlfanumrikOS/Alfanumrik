'use client';

/**
 * XPProgressRing — Circular progress indicator for XP within current level.
 * SVG-based, no chart library (P10 budget).
 */

import React, { memo } from 'react';

interface XPProgressRingProps {
  xpInLevel: number;
  xpToNext: number;
  level: number;
  levelName: string;
}

export const XPProgressRing = memo(function XPProgressRing({
  xpInLevel,
  xpToNext,
  level,
  levelName,
}: XPProgressRingProps) {
  const total = xpInLevel + xpToNext;
  const progress = total > 0 ? xpInLevel / total : 0;
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-28 h-28">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          {/* Background ring */}
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            className="text-gray-200 dark:text-gray-700"
          />
          {/* Progress ring */}
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="text-orange-500 transition-all duration-700 ease-out"
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-gray-800 dark:text-gray-100">
            {level}
          </span>
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">
            Level
          </span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {levelName}
        </div>
        <div className="text-xs text-gray-500">
          {xpInLevel}/{total} XP
        </div>
      </div>
    </div>
  );
});
