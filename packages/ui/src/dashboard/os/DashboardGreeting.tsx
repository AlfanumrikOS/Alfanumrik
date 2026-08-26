'use client';

/**
 * DashboardGreeting — the warm daily greeting strip above TodaysMission.
 *
 * Renders a personalized "Good morning, {firstName}" with streak flame
 * animation and XP count. Uses the design-system tokens:
 *   --font-display (Sora) for the name
 *   --accent-warm / --accent-warm-strong for streak
 *   --xp-color (marigold) for XP
 *   --cream-soft / --cream for the warm gradient background
 *
 * Falls back gracefully when streak/XP data is unavailable (loading or null).
 */

import { useMemo } from 'react';

interface DashboardGreetingProps {
  studentName: string;
  streak: number;
  totalXp: number;
  isHi: boolean;
}

function getGreetingHour(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

const GREETING_COPY: Record<string, { en: string; hi: string }> = {
  morning: { en: 'Good morning', hi: 'सुप्रभात' },
  afternoon: { en: 'Good afternoon', hi: 'नमस्ते' },
  evening: { en: 'Good evening', hi: 'शुभ संध्या' },
};

export default function DashboardGreeting({
  studentName,
  streak,
  totalXp,
  isHi,
}: DashboardGreetingProps) {
  const firstName = useMemo(
    () => studentName.split(' ')[0] || studentName,
    [studentName],
  );

  const period = getGreetingHour();
  const greeting = isHi ? GREETING_COPY[period].hi : GREETING_COPY[period].en;

  const formatXp = (xp: number): string => {
    if (xp >= 1000) {
      return `${(xp / 1000).toFixed(1)}k`;
    }
    return xp.toLocaleString('en-IN');
  };

  return (
    <div
      className="mb-4 rounded-2xl px-5 py-4"
      style={{
        background:
          'linear-gradient(135deg, rgba(232,88,28,0.06) 0%, rgba(245,166,35,0.04) 100%)',
        border: '1px solid rgba(232,88,28,0.1)',
      }}
      data-testid="dashboard-greeting"
    >
      <div className="flex items-center justify-between gap-4">
        {/* Greeting text */}
        <div className="min-w-0 flex-1">
          <h1
            className="text-xl font-bold leading-tight tracking-tight"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
          >
            {greeting},{' '}
            <span
              style={{
                background:
                  'linear-gradient(135deg, var(--accent-warm), var(--gold))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              {firstName}
            </span>{' '}
            {period === 'morning' ? '☀️' : period === 'afternoon' ? '🌤️' : '🌙'}
          </h1>
          <p
            className="text-fluid-xs mt-0.5"
            style={{ color: 'var(--text-3)' }}
          >
            {isHi
              ? 'आज कुछ नया सीखने का दिन है'
              : 'A new day to learn something new'}
          </p>
        </div>

        {/* Streak + XP badges */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Streak badge */}
          {streak > 0 && (
            <div
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
              style={{
                background: 'rgba(232,88,28,0.08)',
                border: '1px solid rgba(232,88,28,0.15)',
              }}
              data-testid="streak-badge"
            >
              <span
                className="streak-flame text-base"
                aria-hidden="true"
              >
                🔥
              </span>
              <span
                className="text-sm font-bold tabular-nums"
                style={{ color: 'var(--accent-warm-strong)' }}
              >
                {streak}
              </span>
            </div>
          )}

          {/* XP badge */}
          {totalXp > 0 && (
            <div
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
              style={{
                background: 'rgba(245,166,35,0.08)',
                border: '1px solid rgba(245,166,35,0.15)',
              }}
              data-testid="xp-badge"
            >
              <span className="text-base" aria-hidden="true">
                ⭐
              </span>
              <span
                className="text-sm font-bold tabular-nums"
                style={{ color: 'var(--gold)' }}
              >
                {formatXp(totalXp)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
