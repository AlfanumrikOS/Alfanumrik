'use client';

import { useState, type ReactNode, memo } from 'react';
import { UnverifiedBanner } from '@/components/foxy/UnverifiedBanner';
import { HardAbstainCard } from '@/components/grounding/HardAbstainCard';
import { ReportIssueModal } from '@/components/foxy/ReportIssueModal';
import { IconButton, Badge, Button } from '@/components/ui/primitives';
import { useAuth } from '@/lib/AuthContext';

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

/** A post-answer learning-action the new bar can dispatch (flag ON only). */
export type LearningActionType =
  | 'got_it'
  | 'explain_simpler'
  | 'show_example'
  | 'quiz_me'
  | 'save';

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
  /**
   * Server-computed SymPy-verifier badge state (display-only; never recomputed
   * client-side). Renders a green "Verified" pill ('verified'), an amber
   * "Check this yourself" pill ('check_manually'), or a neutral/info
   * "Outside Current Chapter" pill ('out_of_scope') for curriculum-out-of-scope
   * math questions. On 'none' / undefined the badge element is NOT rendered at
   * all — no wrapper, no spacing — so non-math and legacy tutor bubbles stay
   * byte-identical to today.
   */
  badgeState?: 'verified' | 'check_manually' | 'none' | 'out_of_scope';
  /** Message id — passed through to ReportIssueModal for the ai_issue_reports FK. */
  messageId?: string;
  /** Question bank id — passed through to ReportIssueModal if the answer was a quiz question. */
  questionBankId?: string;

  // ── Phase 1 learning-action bar (ff_foxy_learning_actions_v1) ──────────────
  /**
   * When true, the legacy QA-tester bar (thumbs + ⚠️ Report + the separate
   * "Report an issue" link) is REPLACED by the learning-action row. When false
   * (default), the legacy bar renders BYTE-IDENTICALLY to today.
   */
  learningActionsEnabled?: boolean;
  /**
   * Dispatch a learning action (flag ON only). The wiring layer (MessageList →
   * page) records the telemetry and, for re-teach/quiz actions, re-sends the
   * prior question with the matching coachDirective.
   */
  onLearningAction?: (action: LearningActionType) => void;
  /** True once this answer has been saved to the notebook (flag ON bar). */
  saved?: boolean;
  /** True once the student tapped "Got it" on this answer (flag ON bar). */
  gotIt?: boolean;
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
  badgeState,
  messageId,
  questionBankId,
  learningActionsEnabled,
  onLearningAction,
  saved,
  gotIt,
}: ChatBubbleProps) {
  const { isHi } = useAuth();
  const isTutor = role === 'tutor';
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const showUnverifiedBanner = isTutor && groundingStatus === 'unverified';
  const showHardAbstainCard = isTutor && groundingStatus === 'hard-abstain';
  // Display-only SymPy-verifier badge. Renders ONLY for the three affirmative
  // states; 'none'/undefined renders nothing (zero DOM change for non-math).
  const showBadge =
    isTutor &&
    !showHardAbstainCard &&
    (badgeState === 'verified' ||
      badgeState === 'check_manually' ||
      badgeState === 'out_of_scope');
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  // Phase 1: the "⋯" overflow menu state for the new learning-action bar.
  const [overflowOpen, setOverflowOpen] = useState(false);

  return (
    <div className="mb-4 w-full animate-slide-up">
      {/* Header row */}
      <div className="flex items-center gap-2 mb-1.5">
        {isTutor ? (
          <div
            className="foxy-avatar-warm w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0"
          >
            🦊
          </div>
        ) : (
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
            style={{ background: `linear-gradient(135deg, ${color}, ${color}bb)`, color: 'white' }}
          >
            {studentName?.[0]?.toUpperCase() || 'S'}
          </div>
        )}
        <span className="text-xs font-bold" style={{ color: isTutor ? 'var(--orange)' : color }}>
          {isTutor ? 'Foxy' : (studentName || 'You')}
        </span>
        <span className="text-[10px] text-[var(--text-3)]">{time}</span>

        {isTutor && (
          <Badge
            tone="neutral"
            variant="soft"
            className="ml-auto"
            title={traceId ? `trace: ${traceId}` : undefined}
          >
            🤖 AI
          </Badge>
        )}

      </div>

      {showUnverifiedBanner && <UnverifiedBanner traceId={traceId} />}

      {showHardAbstainCard && abstainReason && (
        <HardAbstainCard
          reason={abstainReason}
          alternatives={suggestedAlternatives}
        />
      )}

      {/* Message body — suppressed on hard-abstain since content is empty */}
      {!showHardAbstainCard && (
        <div
          className={`w-full rounded-2xl px-4 py-3 text-sm leading-relaxed overflow-hidden min-w-0 ${isTutor ? 'foxy-bubble-tutor' : 'foxy-bubble-user'}`}
          style={{
            // User bubble routes its subject-brand tint through the premium
            // surface class via --bubble-tint (color-mix in CSS). Tutor bubble
            // keeps the reported-danger border override inline.
            ['--bubble-tint' as string]: color,
            color: 'var(--text-1)',
            ...(isTutor && reported
              ? { border: '1.5px solid color-mix(in srgb, var(--danger) 25%, transparent)' }
              : {}),
          }}
        >
          {showBadge && (
            <Badge
              tone={
                badgeState === 'verified'
                  ? 'success'
                  : badgeState === 'out_of_scope'
                    ? 'neutral'
                    : 'warning'
              }
              variant="soft"
              role="status"
              className="mb-2"
              aria-label={
                badgeState === 'verified'
                  ? (isHi ? 'जांचा गया' : 'Verified')
                  : badgeState === 'out_of_scope'
                    ? (isHi ? 'अध्याय से बाहर' : 'Outside current chapter')
                    : (isHi ? 'खुद जांचें' : 'Check this yourself')
              }
              title={
                badgeState === 'out_of_scope'
                  ? (isHi
                      ? 'यह प्रश्न चुनी गई कक्षा/अध्याय से संबंधित नहीं है।'
                      : 'This question does not belong to the selected class/chapter.')
                  : undefined
              }
            >
              {badgeState === 'verified'
                ? (isHi ? '✓ जांचा गया' : '✓ Verified')
                : badgeState === 'out_of_scope'
                  ? (isHi ? '📚 अध्याय से बाहर' : '📚 Outside Current Chapter')
                  : (isHi ? '⚠ खुद जांचें' : '⚠ Check this yourself')}
            </Badge>
          )}
          {content}
        </div>
      )}

      {/* ── Legacy action bar (flag OFF — byte-identical to today) ──────────
          Renders ONLY when the learning-action redesign is disabled. */}
      {!learningActionsEnabled && isTutor && rawContent !== 'Oops! Please try again.' && (
        <div className="flex items-center gap-1 mt-1.5 pl-1">
          {/* Thumbs up */}
          <IconButton
            label="Helpful response"
            icon="👍"
            variant="ghost"
            size="sm"
            aria-pressed={feedback === 'up'}
            onClick={() => onFeedback(true)}
            style={
              feedback === 'up'
                ? { background: 'color-mix(in srgb, var(--success) 10%, transparent)', color: 'var(--success)' }
                : { color: 'var(--text-3)' }
            }
          />

          {/* Thumbs down */}
          <IconButton
            label="Not helpful response"
            icon="👎"
            variant="ghost"
            size="sm"
            aria-pressed={feedback === 'down'}
            onClick={() => onFeedback(false)}
            style={
              feedback === 'down'
                ? { background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)' }
                : { color: 'var(--text-3)' }
            }
          />

          {/* Report */}
          {!reported ? (
            <IconButton
              label="Report incorrect response"
              icon="⚠️"
              variant="ghost"
              size="sm"
              className="ml-1"
              onClick={onReport}
              style={{ color: 'var(--text-3)' }}
            />
          ) : (
            <Badge tone="danger" variant="soft" className="ml-1">
              ✓ Reported
            </Badge>
          )}

          {/* Replay via TTS */}
          {onSpeak && (
            <IconButton
              label="Read aloud"
              icon="🔊"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={onSpeak}
              style={{ color: 'var(--text-3)' }}
            />
          )}

          {/* Verify with textbook hint */}
          {!onSpeak && ['math', 'science', 'physics', 'chemistry'].includes(activeSubject) &&
            (rawContent.includes('=') || rawContent.includes('formula') || rawContent.includes('²') || rawContent.includes('√')) && (
              <Badge tone="neutral" variant="soft" className="ml-auto">
                {isHi ? 'किताब से जांचें' : 'Verify with textbook'}
              </Badge>
            )}
          {onSpeak && ['math', 'science', 'physics', 'chemistry'].includes(activeSubject) &&
            (rawContent.includes('=') || rawContent.includes('formula') || rawContent.includes('²') || rawContent.includes('√')) && (
              <Badge tone="neutral" variant="soft">
                {isHi ? 'किताब से जांचें' : 'Verify with textbook'}
              </Badge>
            )}
        </div>
      )}

      {/* Legacy "Report an issue" link (flag OFF — byte-identical to today).
          Suppressed when the new bar is active; the new bar puts the single
          report path inside its overflow menu. */}
      {!learningActionsEnabled && isTutor && (
        <button
          type="button"
          onClick={() => setIssueModalOpen(true)}
          data-testid="report-issue-link"
          className="mt-1 pl-1 text-[10px] text-[var(--text-3)] underline underline-offset-2 transition hover:text-[var(--text-2)]"
        >
          {isHi ? 'इस जवाब में समस्या रिपोर्ट करें' : 'Report an issue with this answer'}
        </button>
      )}

      {/* ── New learning-action bar (flag ON) ───────────────────────────────
          Tutor messages only; suppressed on the error fallback bubble. */}
      {learningActionsEnabled && isTutor && rawContent !== 'Oops! Please try again.' && (
        <div className="mt-2 pl-1">
          {gotIt ? (
            // Got it ✓ collapses the row into a lightweight micro-CTA — no
            // extra network call. Re-engages without re-teaching.
            <Badge
              tone="success"
              variant="soft"
              icon="✓"
              role="status"
              aria-live="polite"
              data-testid="learning-action-gotit-confirm"
            >
              {isHi ? 'बढ़िया! अगला कदम चाहिए?' : 'Nice! Want the next step?'}
            </Badge>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Primary row */}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onLearningAction?.('got_it')}
                style={{
                  background: 'color-mix(in srgb, var(--success) 8%, transparent)',
                  color: 'var(--success)',
                  borderColor: 'color-mix(in srgb, var(--success) 20%, transparent)',
                }}
                data-testid="learning-action-gotit"
              >
                {isHi ? 'समझ गया ✓' : 'Got it ✓'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onLearningAction?.('explain_simpler')}
                data-testid="learning-action-simpler"
              >
                {isHi ? 'आसान करके बताओ' : 'Explain simpler'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onLearningAction?.('show_example')}
                data-testid="learning-action-example"
              >
                {isHi ? 'उदाहरण दिखाओ' : 'Show example'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onLearningAction?.('quiz_me')}
                style={{
                  background: 'color-mix(in srgb, var(--purple) 8%, transparent)',
                  color: 'var(--purple)',
                  borderColor: 'color-mix(in srgb, var(--purple) 22%, transparent)',
                }}
                data-testid="learning-action-quiz"
              >
                {isHi ? 'इस पर क्विज़ लो' : 'Quiz me on this'}
              </Button>

              {/* Overflow "⋯" menu — Save · Read aloud · Report an issue */}
              <div className="relative">
                <IconButton
                  label={isHi ? 'और विकल्प' : 'More options'}
                  icon="⋯"
                  variant="secondary"
                  size="sm"
                  onClick={() => setOverflowOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={overflowOpen}
                  data-testid="learning-action-overflow"
                />
                {overflowOpen && (
                  <div
                    role="menu"
                    className="absolute left-0 z-20 mt-1 w-52 rounded-xl py-1 shadow-lg"
                    style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      disabled={saved}
                      onClick={() => { onLearningAction?.('save'); setOverflowOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold transition-all active:scale-[0.98] disabled:cursor-default"
                      style={{ color: saved ? 'var(--success)' : 'var(--text-2)' }}
                      data-testid="learning-action-save"
                    >
                      <span aria-hidden="true">{saved ? '✓' : '📒'}</span>
                      {saved
                        ? (isHi ? 'नोटबुक में सेव हो गया' : 'Saved')
                        : (isHi ? 'नोटबुक में सेव करो' : 'Save to notebook')}
                    </button>
                    {onSpeak && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { onSpeak(); setOverflowOpen(false); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold transition-all active:scale-[0.98]"
                        style={{ color: 'var(--text-2)' }}
                        data-testid="learning-action-speak"
                      >
                        <span aria-hidden="true">🔊</span>
                        {isHi ? 'पढ़कर सुनाओ' : 'Read aloud'}
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setIssueModalOpen(true); setOverflowOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold transition-all active:scale-[0.98]"
                      style={{ color: 'var(--text-2)' }}
                      data-testid="learning-action-report"
                    >
                      <span aria-hidden="true">⚠️</span>
                      {isHi ? 'समस्या रिपोर्ट करें' : 'Report an issue'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Shared ai_issue_reports modal — the SINGLE report path. Mounted for
          tutor messages in BOTH flag states (legacy link / new overflow both
          open it). */}
      {isTutor && (
        <ReportIssueModal
          isOpen={issueModalOpen}
          onClose={() => setIssueModalOpen(false)}
          traceId={traceId}
          messageId={messageId}
          questionBankId={questionBankId}
        />
      )}
    </div>
  );
};

// Custom prop comparator for memoization
function areChatBubblePropsEqual(prev: React.ComponentProps<typeof ChatBubble>, next: React.ComponentProps<typeof ChatBubble>) {
  return (
    prev.role === next.role &&
    prev.content === next.content &&
    prev.rawContent === next.rawContent &&
    prev.timestamp === next.timestamp &&
    prev.studentName === next.studentName &&
    prev.xp === next.xp &&
    prev.feedback === next.feedback &&
    prev.reported === next.reported &&
    prev.color === next.color &&
    prev.activeSubject === next.activeSubject &&
    prev.groundingStatus === next.groundingStatus &&
    prev.traceId === next.traceId &&
    prev.abstainReason === next.abstainReason &&
    JSON.stringify(prev.suggestedAlternatives) === JSON.stringify(next.suggestedAlternatives) &&
    prev.badgeState === next.badgeState &&
    prev.messageId === next.messageId &&
    prev.questionBankId === next.questionBankId &&
    prev.learningActionsEnabled === next.learningActionsEnabled &&
    prev.onLearningAction === next.onLearningAction &&
    prev.saved === next.saved &&
    prev.gotIt === next.gotIt
  );
}

export default memo(ChatBubble, areChatBubblePropsEqual);

