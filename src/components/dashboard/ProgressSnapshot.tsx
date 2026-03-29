'use client';

import { useRouter } from 'next/navigation';
import { StreakBadge } from '@/components/ui';
import { calculateLevel, xpToNextLevel, getLevelName } from '@/lib/xp-rules';

/**
 * ProgressSnapshot — Compact 3-metric strip.
 * Shows XP + level, streak, mastered count. Tappable to /progress.
 * No clutter — just the 3 numbers a student cares about.
 */

interface ProgressSnapshotProps {
  totalXp: number;
  streak: number;
  mastered: number;
  isHi: boolean;
}

export default function ProgressSnapshot({ totalXp, streak, mastered, isHi }: ProgressSnapshotProps) {
  const router = useRouter();
  const level = calculateLevel(totalXp);
  const prog = xpToNextLevel(totalXp);
  const levelName = getLevelName(level);

  return (
    <button
      onClick={() => router.push('/progress')}
      className="w-full rounded-2xl p-4 transition-all active:scale-[0.98]"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.03)',
      }}
    >
      {/* Top row: XP + Streak */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="gradient-text">{totalXp.toLocaleString()}</span>
            <span className="text-xs text-[var(--text-3)] ml-1 font-normal">XP</span>
          </div>
          <div className="text-xs text-[var(--text-3)] mt-0.5">
            {isHi ? `स्तर ${level}` : `Level ${level}`} · {levelName}
          </div>
        </div>
        <StreakBadge count={streak} />
      </div>

      {/* XP progress bar */}
      <div className="w-full h-2 rounded-full overflow-hidden mb-3" style={{ background: 'var(--surface-2)' }}>
        <div
          className="h-full rounded-full xp-bar"
          style={{ width: `${prog.progress}%`, background: 'var(--orange)' }}
        />
      </div>

      {/* Bottom row: stats */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--text-3)]">
          {prog.current}/{prog.needed} {isHi ? 'अगले स्तर तक' : 'to next level'}
        </span>
        <span className="font-semibold" style={{ color: 'var(--green)' }}>
          {mastered} {isHi ? 'महारत' : 'mastered'}
        </span>
      </div>
    </button>
  );
}
