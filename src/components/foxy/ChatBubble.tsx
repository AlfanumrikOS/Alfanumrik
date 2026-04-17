'use client';

import { type ReactNode } from 'react';
import { UnverifiedBanner } from '@/components/foxy/UnverifiedBanner';

/* ═══════════════════════════════════════════════════════════════
   ChatBubble — Message bubble for Foxy conversations
   Supports tutor/student roles, feedback
   ═══════════════════════════════════════════════════════════════ */

/**
 * Grounding status — mirrors the server's Phase 3 contract:
 *   grounded      : answer is supported by retrieved NCERT chunks (confidence ≥ threshold)
 *   unverified    : answer generated but low-confidence — show caution banner
 *   hard-abstain  : service refused to answer — show fallback card
 */
export type GroundingStatus = 'grounded' | 'unverified' | 'hard-abstain';

/** Abstain reason surfaced from the grounded-answer service. */
export type AbstainReason =
  | 'chapter_not_ready'
  | 'no_chunks_retrieved'
  | 'low_similarity'
  | 'no_supporting_chunks'
  | 'scope_mismatch'
  | 'upstream_error'
  | 'circuit_open';

/** Suggested alternative chapter/topic when the requested one isn't ready. */
export interface SuggestedAlternative {
  grade: string;
  subject_code: string;
  chapter_number: number;
  chapter_title: string;
  rag_status: 'ready';
}

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
  activeSubject: string;
  onFeedback: (isUp: boolean) => void;
  onReport: () => void;
  /** Called when the student taps 🔊 to replay this message via TTS */
  onSpeak?: () => void;
  /** Grounding verdict from the grounded-answer service (tutor bubbles only) */
  groundingStatus?: GroundingStatus;
  /** Trace id for debugging — shown in tooltip when set */
  traceId?: string;
  /** Abstain reason — only set when groundingStatus === 'hard-abstain' */
  abstainReason?: AbstainReason;
  /** Suggested alternatives — only set when groundingStatus === 'hard-abstain' */
  suggestedAlternatives?: SuggestedAlternative[];
}

export function ChatBubble({
  role,
  content,
  rawContent,
  timestamp,
  studentName,
  feedback,
  reported,
  color,
  activeSubject,
  onFeedback,
  onReport,
  onSpeak,
  groundingStatus,
  traceId,
  abstainReason,
  suggestedAlternatives,
}: ChatBubbleProps) {
  const isTutor = role === 'tutor';
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const showUnverifiedBanner = isTutor && groundingStatus === 'unverified';
  const showHardAbstainCard = isTutor && groundingStatus === 'hard-abstain';

  return (
    <div className="mb-4 w-full animate-slide-up">
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
          <span
            className="ml-auto px-1.5 py-0.5 rounded text-[8px] font-semibold"
            style={{ background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
            title={traceId ? `trace: ${traceId}` : undefined}
          >
            🤖 AI
          </span>
        )}

      </div>

      {showUnverifiedBanner && <UnverifiedBanner traceId={traceId} />}

      {/* TODO Task 3.12: replace with <HardAbstainCard /> */}
      {showHardAbstainCard && (
        <div
          data-testid="hard-abstain-card"
          role="status"
          className="mb-2 rounded-xl px-3 py-3 text-xs"
          style={{
            background: 'var(--surface-2)',
            border: '1px dashed var(--border)',
            color: 'var(--text-2)',
          }}
        >
          <p className="font-semibold mb-1">Foxy can&apos;t answer this yet</p>
          <p className="text-[11px] opacity-80">
            {abstainReason === 'chapter_not_ready'
              ? 'This chapter hasn\'t been added to Foxy\'s reference library yet.'
              : abstainReason === 'circuit_open' || abstainReason === 'upstream_error'
                ? 'Foxy is temporarily unavailable. Please try again in a moment.'
                : 'Foxy couldn\'t find enough NCERT material to answer confidently.'}
          </p>
          {suggestedAlternatives && suggestedAlternatives.length > 0 && (
            <ul className="mt-2 space-y-1">
              {suggestedAlternatives.slice(0, 3).map((alt) => (
                <li key={`${alt.subject_code}-${alt.chapter_number}`} className="text-[11px]">
                  Try: Ch. {alt.chapter_number} — {alt.chapter_title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Message body — suppressed on hard-abstain since content is empty */}
      {!showHardAbstainCard && (
        <div
          className="w-full rounded-2xl px-4 py-3 text-sm leading-relaxed overflow-hidden min-w-0"
          style={{
            background: isTutor ? 'var(--surface-1)' : `${color}08`,
            color: 'var(--text-1)',
            border: isTutor
              ? reported ? '1.5px solid color-mix(in srgb, var(--danger) 25%, transparent)' : '1px solid var(--border)'
              : `1.5px solid ${color}20`,
          }}
        >
          {content}
        </div>
      )}

      {/* Action bar for tutor messages */}
      {isTutor && rawContent !== 'Oops! Please try again.' && (
        <div className="flex items-center gap-1 mt-1.5 pl-1">
          {/* Thumbs up */}
          <button
            onClick={() => onFeedback(true)}
            aria-label="Helpful response"
            aria-pressed={feedback === 'up'}
            className="px-2 py-1 rounded-lg text-[11px] transition-all active:scale-90"
            style={{
              background: feedback === 'up' ? 'color-mix(in srgb, var(--success) 10%, transparent)' : 'transparent',
              color: feedback === 'up' ? 'var(--success)' : 'var(--text-3)',
              border: feedback === 'up' ? '1px solid color-mix(in srgb, var(--success) 20%, transparent)' : '1px solid transparent',
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
              background: feedback === 'down' ? 'color-mix(in srgb, var(--danger) 10%, transparent)' : 'transparent',
              color: feedback === 'down' ? 'var(--danger)' : 'var(--text-3)',
              border: feedback === 'down' ? '1px solid color-mix(in srgb, var(--danger) 20%, transparent)' : '1px solid transparent',
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
            <span className="px-2 py-1 text-[10px] font-semibold" style={{ color: 'var(--danger)' }}>
              ✓ Reported
            </span>
          )}

          {/* Replay via TTS */}
          {onSpeak && (
            <button
              onClick={onSpeak}
              aria-label="Read aloud"
              title="Read aloud"
              className="px-2 py-1 rounded-lg text-[11px] transition-all active:scale-90 ml-auto"
              style={{ color: 'var(--text-3)', background: 'transparent' }}
            >
              🔊
            </button>
          )}

          {/* Verify with textbook hint */}
          {!onSpeak && ['math', 'science', 'physics', 'chemistry'].includes(activeSubject) &&
            (rawContent.includes('=') || rawContent.includes('formula') || rawContent.includes('²') || rawContent.includes('√')) && (
              <span className="ml-auto text-[9px] px-2 py-0.5 rounded"
                style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}>
                Verify with textbook
              </span>
            )}
          {onSpeak && ['math', 'science', 'physics', 'chemistry'].includes(activeSubject) &&
            (rawContent.includes('=') || rawContent.includes('formula') || rawContent.includes('²') || rawContent.includes('√')) && (
              <span className="text-[9px] px-2 py-0.5 rounded"
                style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}>
                Verify with textbook
              </span>
            )}
        </div>
      )}
    </div>
  );
}
