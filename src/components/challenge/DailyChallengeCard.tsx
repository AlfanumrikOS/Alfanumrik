'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui';

/* ═══════════════════════════════════════════════════════════════
   DailyChallengeCard — Dashboard Widget for Today's Challenge
   Shows locked / unlocked / solved state with streak info.
   Compact card design for the dashboard grid.
   ═══════════════════════════════════════════════════════════════ */

interface DailyChallengeCardProps {
  studentId: string;
  grade: string;
  isHi: boolean;
  isUnlocked: boolean;
  streak: number;
  todaySubject?: string;
  todaySubjectHi?: string;
  todayTopic?: string;
  isSolved?: boolean;
}

export default function DailyChallengeCard({
  studentId,
  grade,
  isHi,
  isUnlocked,
  streak,
  todaySubject,
  todaySubjectHi,
  todayTopic,
  isSolved,
}: DailyChallengeCardProps) {
  const subjectLabel = isHi ? (todaySubjectHi || todaySubject) : todaySubject;

  // ── Solved state ──
  if (isSolved) {
    return (
      <Link href="/challenge" className="block">
        <div
          className="rounded-2xl p-4 transition-all active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.06), rgba(34, 197, 94, 0.02))',
            border: '1.5px solid rgba(34, 197, 94, 0.2)',
          }}
        >
          <div className="flex items-center gap-3">
            {/* Checkmark icon */}
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(34, 197, 94, 0.12)' }}
            >
              <span className="text-lg" aria-hidden="true">{'\u2705'}</span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-[#16A34A]">
                  {isHi ? 'हल हो गया!' : 'Solved!'}
                </p>
                {streak >= 3 && (
                  <span className="text-xs font-bold" style={{ color: '#F97316' }}>
                    {'\uD83D\uDD25'} {streak}
                  </span>
                )}
              </div>
              {subjectLabel && (
                <p className="text-xs text-[var(--text-3)] mt-0.5 truncate">{subjectLabel}</p>
              )}
              <p className="text-[10px] text-[var(--text-3)] mt-0.5">
                {isHi ? 'कल फिर आना!' : 'Come back tomorrow!'}
              </p>
            </div>
          </div>
        </div>
      </Link>
    );
  }

  // ── Locked state ──
  if (!isUnlocked) {
    return (
      <div
        className="rounded-2xl p-4"
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          opacity: 0.75,
        }}
      >
        <div className="flex items-center gap-3">
          {/* Lock icon */}
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
          >
            <span className="text-lg text-[var(--text-3)]" aria-hidden="true">{'\uD83D\uDD12'}</span>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--text-2)]">
              {isHi ? 'डेली चैलेंज' : 'Daily Challenge'}
            </p>
            {subjectLabel && (
              <p className="text-xs text-[var(--text-3)] mt-0.5 truncate">{subjectLabel}</p>
            )}
            <p className="text-[10px] text-[var(--text-3)] mt-0.5">
              {isHi ? 'अनलॉक करने के लिए एक क्विज़ पूरा करो' : 'Complete a quiz to unlock'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Unlocked state (ready to play) ──
  return (
    <Link href="/challenge" className="block">
      <div
        className="rounded-2xl p-4 transition-all active:scale-[0.98] card-hover"
        style={{
          background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.06), rgba(124, 58, 237, 0.04))',
          border: '1.5px solid rgba(249, 115, 22, 0.2)',
        }}
      >
        <div className="flex items-center gap-3">
          {/* Play button icon */}
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, #F97316, #EA580C)',
            }}
          >
            <span className="text-white text-sm font-bold" aria-hidden="true">{'\u25B6'}</span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-[var(--text-1)]">
                {isHi ? 'डेली चैलेंज' : 'Daily Challenge'}
              </p>
              {streak >= 3 && (
                <span className="text-xs font-bold" style={{ color: '#F97316' }}>
                  {'\uD83D\uDD25'} {streak}
                </span>
              )}
            </div>
            {todayTopic && (
              <p className="text-xs text-[var(--text-2)] mt-0.5 truncate">{todayTopic}</p>
            )}
            {subjectLabel && !todayTopic && (
              <p className="text-xs text-[var(--text-3)] mt-0.5 truncate">{subjectLabel}</p>
            )}
            <p className="text-[10px] font-bold mt-0.5" style={{ color: '#F97316' }}>
              {isHi ? 'अभी खेलो!' : 'Solve now!'} {'\u2192'}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}
