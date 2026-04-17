'use client';

import { STREAK_MILESTONES, STREAK_VISIBILITY_THRESHOLD } from '@/lib/challenge-config';
import { shouldShowStreak } from '@/lib/challenge-streak';

/* ═══════════════════════════════════════════════════════════════
   StreakBadge — Compact Streak Display for Daily Challenge
   Shows fire emoji + day count with milestone badges inline.
   Three size variants: sm (nav bar), md (cards), lg (profile).
   ═══════════════════════════════════════════════════════════════ */

interface StreakBadgeProps {
  streak: number;
  badges: string[];
  isHi: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CONFIG = {
  sm: {
    container: 'inline-flex items-center gap-0.5',
    fireSize: 'text-sm',
    countSize: 'text-xs font-bold',
    badgeSize: 'text-xs',
    startText: 'text-[10px]',
  },
  md: {
    container: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl',
    fireSize: 'text-base',
    countSize: 'text-sm font-bold',
    badgeSize: 'text-sm',
    startText: 'text-xs',
  },
  lg: {
    container: 'inline-flex items-center gap-2 px-4 py-2 rounded-2xl',
    fireSize: 'text-xl',
    countSize: 'text-lg font-bold',
    badgeSize: 'text-base',
    startText: 'text-sm',
  },
} as const;

export default function StreakBadge({ streak, badges, isHi, size = 'md' }: StreakBadgeProps) {
  const config = SIZE_CONFIG[size];

  // Below threshold: show starter prompt or nothing
  if (!shouldShowStreak(streak)) {
    if (streak <= 0) return null;
    return (
      <span className={`${config.startText} text-[var(--text-3)]`}>
        {isHi ? 'स्ट्रीक शुरू करो!' : 'Start a streak!'}
      </span>
    );
  }

  // Match earned badges with milestone definitions
  const earnedBadgeSet = new Set(badges);
  const earnedMilestones = STREAK_MILESTONES.filter(m => earnedBadgeSet.has(m.badgeId));

  return (
    <div
      className={config.container}
      style={size !== 'sm' ? {
        background: 'rgba(249, 115, 22, 0.08)',
        border: '1px solid rgba(249, 115, 22, 0.2)',
      } : undefined}
      role="status"
      aria-label={
        isHi
          ? `${streak} दिन की स्ट्रीक`
          : `${streak} day streak`
      }
    >
      {/* Fire emoji */}
      <span className={`${config.fireSize} streak-flame`} aria-hidden="true">
        {'\uD83D\uDD25'}
      </span>

      {/* Day count */}
      <span className={config.countSize} style={{ color: '#F97316' }}>
        {streak}
      </span>

      {/* Milestone badges inline */}
      {earnedMilestones.length > 0 && (
        <span className="inline-flex items-center gap-0.5" aria-hidden="true">
          {earnedMilestones.map(m => (
            <span
              key={m.badgeId}
              className={config.badgeSize}
              title={isHi ? m.badgeLabelHi : m.badgeLabel}
            >
              {m.badgeIcon}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
