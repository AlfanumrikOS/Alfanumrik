'use client';

/**
 * ExamModeToggle — For grades 11-12 (and 10 for board prep)
 *
 * When ON:
 * - Shows "Board Readiness: X%" instead of "Level N Explorer"
 * - Shows "Days Active" instead of streak flame emoji
 * - Shows board exam countdown for grade 10/12
 * - Hides XP/gamification decorations
 *
 * Persisted to localStorage key: 'alfanumrik_exam_mode'
 * Default ON for grade 11-12.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';

const STORAGE_KEY = 'alfanumrik_exam_mode';

// CBSE board exam dates (approximate — update yearly)
const BOARD_EXAM_DATES: Record<string, string> = {
  '10': '2026-02-15', // Class 10 boards (approximate)
  '12': '2026-02-05', // Class 12 boards (approximate)
};

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

interface ExamModeToggleProps {
  /** Board readiness score 0-100 (shown instead of level when exam mode is ON) */
  readinessPct?: number;
  /** Days student has been active (shown instead of streak) */
  daysActive?: number;
  /** Streak count (shown when exam mode is OFF) */
  streak?: number;
  /** Level number (shown when exam mode is OFF) */
  level?: number;
  /** Level name (shown when exam mode is OFF) */
  levelName?: string;
  /** Compact mode — just the toggle pill, no stats */
  compact?: boolean;
  className?: string;
}

export function useExamMode() {
  const { student } = useAuth();
  const grade = student?.grade ?? '9';
  const isUpperSecondary = grade === '11' || grade === '12';

  const [examMode, setExamModeState] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      setExamModeState(stored === 'true');
    } else {
      // Default ON for 11-12
      setExamModeState(isUpperSecondary);
    }
  }, [isUpperSecondary]);

  const setExamMode = useCallback((val: boolean) => {
    setExamModeState(val);
    localStorage.setItem(STORAGE_KEY, String(val));
  }, []);

  const toggleExamMode = useCallback(() => {
    setExamMode(!examMode);
  }, [examMode, setExamMode]);

  return { examMode: mounted ? examMode : isUpperSecondary, setExamMode, toggleExamMode, mounted };
}

export default function ExamModeToggle({
  readinessPct = 0,
  daysActive = 0,
  streak = 0,
  level = 1,
  levelName = 'Explorer',
  compact = false,
  className = '',
}: ExamModeToggleProps) {
  const { student, isHi } = useAuth();
  const grade = student?.grade ?? '9';
  const { examMode, toggleExamMode } = useExamMode();

  const boardDate = BOARD_EXAM_DATES[grade];
  const daysLeft = boardDate ? daysUntil(boardDate) : null;

  if (compact) {
    return (
      <button
        onClick={toggleExamMode}
        aria-label={examMode ? 'Switch to explore mode' : 'Switch to exam mode'}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${className}`}
        style={{
          background: examMode ? 'var(--purple, #7C3AED)' : 'var(--surface-1)',
          color: examMode ? '#fff' : 'var(--text-2)',
          border: `1px solid ${examMode ? 'var(--purple, #7C3AED)' : 'var(--border)'}`,
        }}
      >
        {examMode ? '🎯' : '🎮'}
        {examMode ? (isHi ? 'परीक्षा मोड' : 'Exam Mode') : (isHi ? 'एक्सप्लोर मोड' : 'Explore Mode')}
      </button>
    );
  }

  return (
    <div className={`rounded-2xl p-4 ${className}`} style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
      {/* Toggle Row */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
            {isHi ? 'परीक्षा मोड' : 'Exam Mode'}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-2)' }}>
            {isHi ? 'गेमिफ़िकेशन छुपाएं · बोर्ड फोकस' : 'Hide gamification · Board focus'}
          </p>
        </div>
        {/* Toggle pill */}
        <button
          onClick={toggleExamMode}
          role="switch"
          aria-checked={examMode}
          className="relative w-12 h-6 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
          style={{ background: examMode ? 'var(--purple, #7C3AED)' : 'var(--border)' }}
        >
          <span
            className="absolute top-1 w-4 h-4 rounded-full transition-transform"
            style={{
              background: '#fff',
              left: '4px',
              transform: examMode ? 'translateX(24px)' : 'translateX(0)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
            }}
          />
        </button>
      </div>

      {/* Stats row */}
      <div className="flex gap-3 flex-wrap">
        {examMode ? (
          <>
            {/* Board Readiness % */}
            <div className="flex-1 min-w-0 p-3 rounded-xl text-center" style={{ background: 'var(--purple, #7C3AED)' + '10' }}>
              <p className="text-xl font-black" style={{ color: 'var(--purple, #7C3AED)' }}>{readinessPct}%</p>
              <p className="text-[10px]" style={{ color: 'var(--text-2)' }}>
                {isHi ? 'बोर्ड तैयारी' : 'Board Readiness'}
              </p>
            </div>

            {/* Days Active */}
            <div className="flex-1 min-w-0 p-3 rounded-xl text-center" style={{ background: '#EFF6FF' }}>
              <p className="text-xl font-black" style={{ color: '#2563EB' }}>{daysActive}</p>
              <p className="text-[10px]" style={{ color: 'var(--text-2)' }}>
                {isHi ? 'दिन सक्रिय' : 'Days Active'}
              </p>
            </div>

            {/* Board Exam Countdown */}
            {daysLeft !== null && (
              <div className="flex-1 min-w-0 p-3 rounded-xl text-center" style={{ background: daysLeft <= 30 ? '#FEF2F2' : '#FFF8F0' }}>
                <p className="text-xl font-black" style={{ color: daysLeft <= 30 ? '#DC2626' : 'var(--orange, #F97316)' }}>{daysLeft}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-2)' }}>
                  {isHi ? `कक्षा ${grade} बोर्ड` : `Class ${grade} Board`}
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Level */}
            <div className="flex-1 min-w-0 p-3 rounded-xl text-center" style={{ background: '#FFF8F0' }}>
              <p className="text-xl font-black" style={{ color: 'var(--orange, #F97316)' }}>Lv.{level}</p>
              <p className="text-[10px]" style={{ color: 'var(--text-2)' }}>{levelName}</p>
            </div>

            {/* Streak */}
            <div className="flex-1 min-w-0 p-3 rounded-xl text-center" style={{ background: '#FFF8F0' }}>
              <p className="text-xl font-black" style={{ color: '#F97316' }}>🔥 {streak}</p>
              <p className="text-[10px]" style={{ color: 'var(--text-2)' }}>
                {isHi ? 'स्ट्रीक' : 'Streak'}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
