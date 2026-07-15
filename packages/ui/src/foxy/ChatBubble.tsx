'use client';

import { useState, type ReactNode, memo } from 'react';
import { UnverifiedBanner } from '@alfanumrik/ui/foxy/UnverifiedBanner';
import { HardAbstainCard } from '@alfanumrik/ui/grounding/HardAbstainCard';
import { ReportIssueModal } from '@alfanumrik/ui/foxy/ReportIssueModal';
import { useAuth } from '@alfanumrik/lib/AuthContext';

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

/**
 * The four PRIMARY post-answer buttons the Teaching Director may suggest — the
 * structural subset of `LearningActionType` MINUS 'save' (the notebook utility
 * the Director never advises). Mirrors `SuggestedButton` in
 * `packages/lib/src/foxy/teaching-director.ts`. When `suggestedButtons` is
 * present on a turn the bar renders ONLY these; absent ⇒ all four render.
 */
export type SuggestedButtonType = 'got_it' | 'explain_simpler' | 'show_example' | 'quiz_me';

/** Kind of an advisory "next" action the Director recommends (never auto-runs). */
export type NextActionKind =
  | 'quiz_concept'
  | 'review_prerequisite'
  | 'advance_topic'
  | 'reflect';

/**
 * An advisory follow-up the Teaching Director surfaces beneath the action bar
 * (flag ON only). Display-only: these communicate what comes next; they never
 * mutate XP/mastery and carry no client-side business logic. Structural mirror
 * of `RecommendedAction` in `packages/lib/src/foxy/teaching-director.ts`.
 */
export interface NextAction {
  kind: NextActionKind;
  /** Bilingual, student-facing CTA label (P7). */
  label: { en: string; hi: string };
  /** Concept the action targets, when known. */
  conceptId?: string;
}

/** Leading glyph per next-action kind (display-only affordance). */
const NEXT_ACTION_ICON: Record<NextActionKind, string> = {
  quiz_concept: '📝',
  review_prerequisite: '🔁',
  advance_topic: '➡️',
  reflect: '💭',
};

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

  // ── Phase 2.1 Teaching Director (ff_foxy_teaching_director_v1) ─────────────
  /**
   * Context-aware subset of the four PRIMARY learning-action buttons supplied by
   * the Teaching Director. When present, ONLY the listed buttons render (each
   * primary button is gated by `(suggestedButtons?.includes('<type>') ?? true)`).
   * When ABSENT (flag OFF, or Director produced no plan) all four render —
   * byte-identical to today. Only meaningful while `learningActionsEnabled`.
   */
  suggestedButtons?: SuggestedButtonType[];
  /**
   * Advisory "next" actions the Director recommends. Rendered as a subtle,
   * display-only chip row beneath the action bar (bilingual, P7). Never
   * dispatches an action or mutates state. Absent ⇒ no chip row (today's UI).
   */
  nextActions?: NextAction[];
  /**
   * Whether this message actually has a renderable body. Defaults to true so
   * every existing caller stays byte-identical. MessageList passes `false` for a
   * tutor turn whose text is empty AND that carries no structured payload / no
   * ui-action — the "streaming settled with no text" and "empty persisted
   * content" cases that otherwise paint an empty white bubble under the header.
   * When false (and there is no verifier badge to show), the message-body box is
   * not rendered at all. Grounding banners / hard-abstain cards are unaffected —
   * they render outside this guard.
   */
  hasBodyContent?: boolean;
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
  suggestedButtons,
  nextActions,
  hasBodyContent = true,
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
  // Phase 2.1: a primary button renders when the Teaching Director suggested it
  // OR when no subset was supplied (absent ⇒ render all four — today's default).
  const showPrimary = (t: SuggestedButtonType) => suggestedButtons?.includes(t) ?? true;

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

      {showHardAbstainCard && abstainReason && (
        <HardAbstainCard
          reason={abstainReason}
          alternatives={suggestedAlternatives}
        />
      )}

      {/* Message body — suppressed on hard-abstain (content is empty there), and
          suppressed when there is genuinely nothing to render (hasBodyContent
          === false) so an empty tutor turn never paints a blank white bar. A
          verifier badge still forces the box open. */}
      {!showHardAbstainCard && (hasBodyContent || showBadge) && (
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
            <div
              role="status"
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
              className="inline-flex items-center gap-1 mb-2 px-2 py-0.5 rounded-full text-[10px] font-bold"
              style={
                badgeState === 'verified'
                  ? {
                      background: 'color-mix(in srgb, var(--success) 12%, transparent)',
                      color: 'var(--success)',
                      border: '1px solid color-mix(in srgb, var(--success) 26%, transparent)',
                    }
                  : badgeState === 'out_of_scope'
                    ? {
                        // Neutral/info pill — reuses the same muted token set as
                        // the "🤖 AI" provenance pill and "Verify with textbook"
                        // hint in this component. Deliberately NOT success/warning.
                        background: 'var(--surface-2)',
                        color: 'var(--text-2)',
                        border: '1px solid var(--border)',
                      }
                    : {
                        background: 'color-mix(in srgb, var(--warning) 14%, transparent)',
                        color: 'var(--warning)',
                        border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
                      }
              }
            >
              {badgeState === 'verified'
                ? (isHi ? '✓ जांचा गया' : '✓ Verified')
                : badgeState === 'out_of_scope'
                  ? (isHi ? '📚 अध्याय से बाहर' : '📚 Outside Current Chapter')
                  : (isHi ? '⚠ खुद जांचें' : '⚠ Check this yourself')}
            </div>
          )}
          {content}
        </div>
      )}

      {/* ── Legacy action bar (flag OFF — byte-identical to today) ──────────
          Renders ONLY when the learning-action redesign is disabled. */}
      {!learningActionsEnabled && isTutor && rawContent !== 'Oops! Please try again.' && (
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
          Tutor TEACHING turns only. Suppressed on the error fallback bubble
          ('Oops! Please try again.') AND on hard-abstain bubbles — when the
          grounded-answer service refuses, a HardAbstainCard renders in place of
          teaching content, so "Got it / Explain simpler / Show example / Quiz
          me on this" would be nonsensical there (criteria 4: no bar on pure
          abstain/error surfaces). The flag-OFF legacy bar above is deliberately
          left untouched, so the OFF path stays byte-identical to today.

          PHASE 2.1 — Teaching Director `suggestedButtons` (WIRED):
          The Director supplies a context-aware subset of the four primary
          actions (present only when ff_foxy_teaching_director_v1 is ON and a
          plan composed). Each primary button below is gated by
          `showPrimary('<type>')` === `(suggestedButtons?.includes('<type>') ?? true)`,
          so an ABSENT set renders all four (today's behavior) and a present set
          renders ONLY the listed buttons. `nextActions`, when present, renders a
          subtle display-only chip row beneath the bar. Purely additive. */}
      {learningActionsEnabled && isTutor && !showHardAbstainCard && rawContent !== 'Oops! Please try again.' && (
        <div className="mt-2 pl-1">
          {gotIt ? (
            // Got it ✓ collapses the row into a lightweight micro-CTA — no
            // extra network call. Re-engages without re-teaching.
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold"
              style={{
                background: 'color-mix(in srgb, var(--success) 10%, transparent)',
                color: 'var(--success)',
                border: '1px solid color-mix(in srgb, var(--success) 22%, transparent)',
              }}
              role="status"
              aria-live="polite"
              data-testid="learning-action-gotit-confirm"
            >
              <span aria-hidden="true">✓</span>
              {isHi ? 'बढ़िया! अगला कदम चाहिए?' : 'Nice! Want the next step?'}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Primary row — each button is gated by the Director's
                  context-aware subset (absent ⇒ all four render). */}
              {showPrimary('got_it') && (
                <button
                  type="button"
                  onClick={() => onLearningAction?.('got_it')}
                  className="px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all active:scale-95 min-h-[44px]"
                  style={{
                    background: 'color-mix(in srgb, var(--success) 8%, transparent)',
                    color: 'var(--success)',
                    border: '1px solid color-mix(in srgb, var(--success) 20%, transparent)',
                  }}
                  data-testid="learning-action-gotit"
                >
                  {isHi ? 'समझ गया ✓' : 'Got it ✓'}
                </button>
              )}
              {showPrimary('explain_simpler') && (
                <button
                  type="button"
                  onClick={() => onLearningAction?.('explain_simpler')}
                  className="px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all active:scale-95 min-h-[44px]"
                  style={{ background: 'var(--surface-1)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
                  data-testid="learning-action-simpler"
                >
                  {isHi ? 'आसान करके बताओ' : 'Explain simpler'}
                </button>
              )}
              {showPrimary('show_example') && (
                <button
                  type="button"
                  onClick={() => onLearningAction?.('show_example')}
                  className="px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all active:scale-95 min-h-[44px]"
                  style={{ background: 'var(--surface-1)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
                  data-testid="learning-action-example"
                >
                  {isHi ? 'उदाहरण दिखाओ' : 'Show example'}
                </button>
              )}
              {showPrimary('quiz_me') && (
                <button
                  type="button"
                  onClick={() => onLearningAction?.('quiz_me')}
                  className="px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all active:scale-95 min-h-[44px]"
                  style={{
                    background: 'color-mix(in srgb, var(--purple) 8%, transparent)',
                    color: 'var(--purple)',
                    border: '1px solid color-mix(in srgb, var(--purple) 22%, transparent)',
                  }}
                  data-testid="learning-action-quiz"
                >
                  {isHi ? 'इस पर क्विज़ लो' : 'Quiz me on this'}
                </button>
              )}

              {/* Overflow "⋯" menu — Save · Read aloud · Report an issue */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOverflowOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={overflowOpen}
                  aria-label={isHi ? 'और विकल्प' : 'More options'}
                  className="px-2.5 py-1.5 rounded-xl text-[14px] font-bold leading-none transition-all active:scale-95 min-h-[44px] min-w-[44px]"
                  style={{ background: 'var(--surface-1)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
                  data-testid="learning-action-overflow"
                >
                  ⋯
                </button>
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
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] font-semibold transition-all active:scale-[0.98] disabled:cursor-default"
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
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] font-semibold transition-all active:scale-[0.98]"
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
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] font-semibold transition-all active:scale-[0.98]"
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

          {/* Phase 2.1 — advisory "next" affordance from the Teaching Director.
              Display-only chips (no dispatch, no state mutation) that hint at
              what comes next. Rendered only when the Director supplied at least
              one recommended action. Bilingual (P7). Absent ⇒ nothing renders,
              so the OFF path stays byte-identical to today. */}
          {nextActions && nextActions.length > 0 && (
            <div
              className="mt-1.5 flex flex-wrap items-center gap-1.5"
              data-testid="learning-next-actions"
            >
              <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'आगे' : 'Next'}
              </span>
              {nextActions.map((na, i) => (
                <span
                  key={`${na.kind}-${na.conceptId ?? i}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
                  data-testid={`learning-next-action-${na.kind}`}
                >
                  <span aria-hidden="true">{NEXT_ACTION_ICON[na.kind]}</span>
                  {isHi ? na.label.hi : na.label.en}
                </span>
              ))}
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
    prev.gotIt === next.gotIt &&
    JSON.stringify(prev.suggestedButtons) === JSON.stringify(next.suggestedButtons) &&
    JSON.stringify(prev.nextActions) === JSON.stringify(next.nextActions) &&
    prev.hasBodyContent === next.hasBodyContent
  );
}

export default memo(ChatBubble, areChatBubblePropsEqual);

