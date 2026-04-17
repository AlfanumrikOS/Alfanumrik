'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { StreakBadge } from '@/components/ui';
import { calculateLevel, xpToNextLevel, getLevelName } from '@/lib/xp-rules';
import { getLevelFromScore } from '@/lib/score-config';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';

/**
 * ProgressSnapshot — Compact metric strip.
 * Shows Performance Score + level, Legacy XP, streak, mastered count.
 * Tappable to /progress.
 *
 * During the XP-to-Performance-Score migration, both systems are shown
 * with subtle labels distinguishing them.
 */

interface ProgressSnapshotProps {
  totalXp: number;
  streak: number;
  mastered: number;
  isHi: boolean;
}

export default function ProgressSnapshot({ totalXp, streak, mastered, isHi }: ProgressSnapshotProps) {
  const router = useRouter();
  const { student } = useAuth();
  const level = calculateLevel(totalXp);
  const prog = xpToNextLevel(totalXp);
  const levelName = getLevelName(level);

  // Fetch overall Performance Score for this student (average across subjects)
  const [perfScore, setPerfScore] = useState<number | null>(null);

  useEffect(() => {
    if (!student?.id) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('performance_scores')
          .select('overall_score')
          .eq('student_id', student.id);
        if (data && data.length > 0) {
          const avg = data.reduce((sum: number, row: any) => sum + (Number(row.overall_score) || 0), 0) / data.length;
          setPerfScore(Math.round(avg));
        }
      } catch {
        // Non-fatal: Performance Score display is informational
      }
    })();
  }, [student?.id]);

  const perfLevel = perfScore !== null ? getLevelFromScore(perfScore) : null;

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
      {/* Performance Score — new primary metric */}
      {perfScore !== null && (
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-1.5">
              <span
                className="text-2xl font-bold"
                style={{
                  fontFamily: 'var(--font-display)',
                  color: perfScore >= 75 ? '#10B981' : perfScore >= 50 ? '#F59E0B' : perfScore >= 35 ? '#F97316' : '#EF4444',
                }}
              >
                {perfScore}
              </span>
              <span className="text-xs text-[var(--text-3)] font-normal">/ 100</span>
            </div>
            <div className="text-[10px] text-[var(--text-3)] mt-0.5">
              {isHi ? 'Performance Score' : 'Performance Score'} · {perfLevel}
            </div>
          </div>
          <StreakBadge count={streak} />
        </div>
      )}

      {/* Legacy XP row — shown smaller during migration */}
      <div className={`flex items-center justify-between ${perfScore !== null ? 'mb-2' : 'mb-3'}`}>
        {perfScore === null && (
          /* Show XP prominently if no Performance Score yet */
          <div>
            <div className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              <span className="gradient-text">{totalXp.toLocaleString()}</span>
              <span className="text-xs text-[var(--text-3)] ml-1 font-normal">XP</span>
            </div>
            <div className="text-xs text-[var(--text-3)] mt-0.5">
              {isHi ? `स्तर ${level}` : `Level ${level}`} · {levelName}
            </div>
          </div>
        )}
        {perfScore !== null && (
          /* Show XP as secondary during migration */
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[var(--text-3)]">
              {isHi ? 'Legacy XP:' : 'Legacy XP:'}
            </span>
            <span className="text-xs font-semibold gradient-text">{totalXp.toLocaleString()}</span>
            <span className="text-[10px] text-[var(--text-3)]">
              · {isHi ? `स्तर ${level}` : `Lv ${level}`}
            </span>
          </div>
        )}
        {perfScore === null && <StreakBadge count={streak} />}
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
