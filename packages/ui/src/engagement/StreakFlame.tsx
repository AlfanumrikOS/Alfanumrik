'use client';

/**
 * StreakFlame — Animated streak counter with milestone badges.
 * CSS animations only (P10 budget).
 */

import React, { memo } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';

interface StreakFlameProps {
  current: number;
  best: number;
}

const CHROME = {
  en: { days: 'day streak', best: 'Best' },
  hi: { days: 'दिन की स्ट्रीक', best: 'सर्वश्रेष्ठ' },
} as const;

const MILESTONES = [7, 30, 100] as const;

export const StreakFlame = memo(function StreakFlame({
  current,
  best,
}: StreakFlameProps) {
  const { isHi } = useAuth();
  const chrome = isHi ? CHROME.hi : CHROME.en;
  const isActive = current > 0;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Flame + counter */}
      <div className="flex items-center gap-2">
        <div
          className={`text-3xl ${isActive ? 'animate-bounce' : 'opacity-40'}`}
          style={{ animationDuration: '2s' }}
        >
          <span role="img" aria-label="streak">🔥</span>
        </div>
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-gray-800 dark:text-gray-100">
              {current}
            </span>
            <span className="text-sm text-gray-500">{chrome.days}</span>
          </div>
          <div className="text-xs text-gray-400">
            {chrome.best}: {best}
          </div>
        </div>
      </div>

      {/* Milestone badges — wrap on small screens */}
      <div className="flex flex-wrap justify-center gap-1">
        {MILESTONES.map((m) => (
          <span
            key={m}
            className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
              current >= m
                ? 'bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
            }`}
          >
            {m}d
          </span>
        ))}
      </div>
    </div>
  );
});
