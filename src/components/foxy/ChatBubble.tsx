'use client';

import { type ReactNode } from 'react';

/* ═══════════════════════════════════════════════════════════════
   ChatBubble — Message bubble for Foxy conversations
   Supports tutor/student roles, play-audio button, feedback
   ═══════════════════════════════════════════════════════════════ */

interface ChatBubbleProps {
  role: 'student' | 'tutor';
  content: ReactNode;
  rawContent: string;
  timestamp: string;
  studentName?: string;
  xp?: number;
  feedback?: 'up' | 'down' | null;
  reported?: boolean;
  color: string;
  isSpeaking: boolean;
  isLoadingAudio: boolean;
  voiceEnabled: boolean;
  activeSubject: string;
  onPlayAudio: () => void;
  onFeedback: (isUp: boolean) => void;
  onReport: () => void;
}

export function ChatBubble({
  role,
  content,
  rawContent,
  timestamp,
  studentName,
  xp,
  feedback,
  reported,
  color,
  isSpeaking,
  isLoadingAudio,
  voiceEnabled,
  activeSubject,
  onPlayAudio,
  onFeedback,
  onReport,
}: ChatBubbleProps) {
  const isTutor = role === 'tutor';
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="mb-4 w-full animate-fade-in">
      {/* Header row */}
      <div className="flex items-center gap-2 mb-1.5">
        {isTutor ? (
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0"
            style={{ background: 'linear-gradient(135deg, #E8590C, #F59E0B)' }}
          >
            🦊
          </div>
        ) : (
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] text-white font-bold shrink-0"
            style={{ background: `linear-gradient(135deg, ${color}, ${color}bb)` }}
          >
            {studentName?.[0]?.toUpperCase() || 'S'}
          </div>
        )}
        <span className="text-xs font-bold" style={{ color: isTutor ? 'var(--orange)' : color }}>
          {isTutor ? 'Foxy' : (studentName || 'You')}
        </span>
        <span className="text-[10px] text-[var(--text-3)]">{time}</span>

        {isTutor && (
          <span className="ml-auto px-1.5 py-0.5 rounded text-[8px] font-semibold"
            style={{ background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
            🤖 AI
          </span>
        )}
        {(xp ?? 0) > 0 && (
          <span className="px-2 py-0.5 rounded-lg text-[10px] font-extrabold text-white"
            style={{ background: 'linear-gradient(135deg, #F59E0B, #EF4444)' }}>
            +{xp} XP
          </span>
        )}
      </div>

      {/* Message body */}
      <div
        className="w-full rounded-2xl px-4 py-3 text-sm leading-relaxed"
        style={{
          background: isTutor ? 'var(--surface-1)' : `${color}08`,
          color: 'var(--text-1)',
          border: isTutor
            ? reported ? '1.5px solid #EF444440' : '1px solid var(--border)'
            : `1.5px solid ${color}20`,
        }}
      >
        {content}
      </div>

      {/* Action bar for tutor messages */}
      {isTutor && rawContent !== 'Oops! Please try again.' && (
        <div className="flex items-center gap-1 mt-1.5 pl-1">
          {/* Play/stop audio */}
          {voiceEnabled && (
            <button
              onClick={onPlayAudio}
              className="px-2 py-1 rounded-lg text-[11px] transition-all active:scale-90"
              style={{
                background: isSpeaking ? `${color}15` : 'transparent',
                color: isSpeaking ? color : 'var(--text-3)',
                border: isSpeaking ? `1px solid ${color}30` : '1px solid transparent',
              }}
            >
              {isLoadingAudio ? '⏳' : isSpeaking ? '⏹ Stop' : '🔊 Play'}
            </button>
          )}

          {/* Thumbs up */}
          <button
            onClick={() => onFeedback(true)}
            aria-label="Helpful response"
            aria-pressed={feedback === 'up'}
            className="px-2 py-1 rounded-lg text-[11px] transition-all active:scale-90"
            style={{
              background: feedback === 'up' ? '#16A34A18' : 'transparent',
              color: feedback === 'up' ? '#16A34A' : 'var(--text-3)',
              border: feedback === 'up' ? '1px solid #16A34A30' : '1px solid transparent',
            }}
          >
            👍
          </button>

          {/* Thumbs down */}
          <button
            onClick={() => onFeedback(false)}
            aria-label="Not helpful response"
            aria-pressed={feedback === 'down'}
            className="px-2 py-1 rounded-lg text-[11px] transition-all active:scale-90"
            style={{
              background: feedback === 'down' ? '#EF444418' : 'transparent',
              color: feedback === 'down' ? '#EF4444' : 'var(--text-3)',
              border: feedback === 'down' ? '1px solid #EF444430' : '1px solid transparent',
            }}
          >
            👎
          </button>

          {/* Report */}
          {!reported ? (
            <button
              onClick={onReport}
              aria-label="Report incorrect response"
              className="px-2 py-1 rounded-lg text-[10px] font-semibold transition-all active:scale-95 ml-1"
              style={{ color: 'var(--text-3)' }}
            >
              ⚠️ Report
            </button>
          ) : (
            <span className="px-2 py-1 text-[10px] font-semibold" style={{ color: '#EF4444' }}>
              ✓ Reported
            </span>
          )}

          {/* Verify with textbook hint */}
          {['math', 'science', 'physics', 'chemistry'].includes(activeSubject) &&
            (rawContent.includes('=') || rawContent.includes('formula') || rawContent.includes('²') || rawContent.includes('√')) && (
              <span className="ml-auto text-[9px] px-2 py-0.5 rounded"
                style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}>
                Verify with textbook
              </span>
            )}
        </div>
      )}
    </div>
  );
}
