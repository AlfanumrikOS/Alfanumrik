'use client';

/**
 * MessageList — renders the Foxy chat-message stream.
 *
 * Plan ref: docs/superpowers/plans/2026-05-09-student-quality-upgrade.md
 *           Task 4: extract messages.map(...) into a component
 *
 * MOVED VERBATIM from `src/app/foxy/page.tsx`:
 *   - The "show only recent / show all" collapsing buttons
 *   - The defensive dedup IIFE (P0 2026-04-28 — guards against id collisions)
 *   - The Phase 2 renderer-choice (structured vs legacy markdown) branch
 *   - The recoverFoxyResponseFromText fallback for legacy ```json ...``` rows
 *   - The ChatBubble render with all metadata (groundingStatus, traceId,
 *     abstainReason, suggestedAlternatives, feedback, reported)
 *   - The Save-to-flashcard button (tutor messages only, hidden once reported)
 *
 * The dynamic imports for `RichContent` and `FoxyStructuredRenderer` are kept
 * here (not in page.tsx) so the page bundle no longer pulls KaTeX/markdown
 * into its synchronous chunk — the dynamic imports below serve the same
 * P10 bundle-budget purpose they did when the page owned them.
 */

import Image from 'next/image';
import ChatBubble, { type LearningActionType } from '@/components/foxy/ChatBubble';
import { StructuredRenderBoundary } from '@/components/foxy/StructuredRenderBoundary';
import { isFoxyResponse } from '@/lib/foxy/is-foxy-response';
import { recoverFoxyResponseFromText } from '@/lib/foxy/recover-from-text';
import { denormalizeFoxyResponse } from '@/lib/foxy/denormalize';
import type { ChatMessage } from '../_lib/foxy-types';
import type { QuizMeBinding } from '@/components/foxy/FoxyStructuredRenderer';
import type { SubmitQuizAnswerInput, SubmitQuizAnswerResult } from '../_hooks/useFoxyChat';
import { RichContent } from '@/components/foxy/RichContent';
import { FoxyStructuredRenderer } from '@/components/foxy/FoxyStructuredRenderer';
import DynamicScaffold from '@/app/foxy/_components/DynamicScaffold';

export interface MessageListProps {
  messages: ChatMessage[];
  collapsedAbove: number | null;
  onSetCollapsedAbove: (idx: number | null) => void;

  /** Subject key used for ChatBubble's color theming + math sniffer. */
  activeSubject: string;
  /** Subject brand color (used by collapsing buttons). */
  cfgColor: string;

  studentName?: string;
  /** isHi === language === 'hi' — passed in from AuthContext via the page. */
  isHi: boolean;
  ttsSupported: boolean;
  savedMessageIds: Set<number>;

  onFeedback: (msgId: number, isUp: boolean) => void;
  onReport: (msgId: number) => void;
  onSaveFlashcard: (msgId: number, content: string) => void;
  onSpeak?: (text: string) => void;

  // ── Phase 1 learning-action bar (ff_foxy_learning_actions_v1) ──────────────
  /** When true, ChatBubble renders the new learning-action bar instead of the
   *  legacy QA-tester bar. When false (default), the legacy bar is unchanged. */
  learningActionsEnabled?: boolean;
  /** Dispatch a learning action for a given message (flag ON only). The page
   *  records telemetry + re-sends the prior question for re-teach/quiz. */
  onLearningAction?: (msg: ChatMessage, action: LearningActionType) => void;
  /** Local-id set of messages the student tapped "Got it" on (flag ON bar). */
  gotItMessageIds?: Set<number>;

  /**
   * Part B1: grade an evidential "Quiz me" answer. Wired from the page to
   * useFoxyChat().submitQuizAnswer. When provided AND a tutor message carries
   * `quizMe.evidential === true`, the MCQ renderer submits the chosen answer
   * through the sanctioned mastery pipeline. Absent → all MCQs are self-check.
   */
  onSubmitQuizAnswer?: (input: SubmitQuizAnswerInput) => Promise<SubmitQuizAnswerResult>;
}

export function MessageList({
  messages,
  collapsedAbove,
  onSetCollapsedAbove,
  activeSubject,
  cfgColor,
  studentName,
  isHi,
  ttsSupported,
  savedMessageIds,
  onFeedback,
  onReport,
  onSaveFlashcard,
  onSpeak,
  learningActionsEnabled,
  onLearningAction,
  gotItMessageIds,
  onSubmitQuizAnswer,
}: MessageListProps) {
  return (
    <>
      {/* Messages — with collapsing for long threads */}
      {messages.length > 10 && collapsedAbove === null && (
        <button
          onClick={() => onSetCollapsedAbove(messages.length - 6)}
          className="w-full text-center py-2 mb-3 rounded-xl text-[11px] font-semibold transition-all active:scale-[0.98]"
          style={{ background: 'var(--surface-1)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
        >
          {isHi
            ? `↑ केवल हाल के संदेश दिखाओ (कुल ${messages.length})`
            : `↑ Show only recent messages (${messages.length} total)`}
        </button>
      )}

      {collapsedAbove !== null && (
        <button
          onClick={() => onSetCollapsedAbove(null)}
          className="w-full text-center py-2 mb-3 rounded-xl text-[11px] font-semibold transition-all active:scale-[0.98]"
          style={{ background: `${cfgColor}08`, color: cfgColor, border: `1px solid ${cfgColor}20` }}
        >
          {isHi
            ? `↓ सभी ${messages.length} संदेश दिखाओ`
            : `↓ Show all ${messages.length} messages`}
        </button>
      )}

      {/* P0 (2026-04-28) defensive dedup — guards against the duplicate-render
          symptom where the same ChatMessage somehow appears twice in the array.
          The structural fix is the monotonic nextMessageId() in useFoxyChat. */}
      {(() => {
        const seenIds = new Set<number>();
        return messages.filter((m) => {
          if (seenIds.has(m.id)) return false;
          seenIds.add(m.id);
          return true;
        });
      })().map((msg: ChatMessage, idx: number) => {
        if (collapsedAbove !== null && idx < collapsedAbove) return null;

        // ── Phase 2 renderer choice (structured vs legacy markdown) ──
        // Recovery branch: legacy persisted rows that have raw ```json ...```
        // in `content` and NULL `structured` get parsed at render time so the
        // student sees real blocks instead of a fenced JSON dump.
        const recoveredStructured =
          msg.role === 'tutor' && !msg.structured
            ? recoverFoxyResponseFromText(msg.content)
            : null;
        const effectiveStructured = msg.structured ?? recoveredStructured ?? undefined;
        const useStructured =
          msg.role === 'tutor' && effectiveStructured && isFoxyResponse(effectiveStructured);
        let effectiveContent = recoveredStructured
          ? denormalizeFoxyResponse(recoveredStructured)
          : msg.content;

        let uiActionPayload = null;
        try {
          const match = effectiveContent.match(/```json\s*(\{[\s\S]*?"ui_action"[\s\S]*?\})\s*```/);
          if (match) {
             const parsed = JSON.parse(match[1]);
             if (parsed.ui_action) uiActionPayload = parsed.ui_action;
             effectiveContent = effectiveContent.replace(match[0], '').trim();
          }
        } catch(e) {}

        const legacyTutorContent = (
          <RichContent content={effectiveContent} subjectKey={activeSubject} />
        );

        // Part B1: build the evidential binding for THIS message's MCQ. Present
        // only when the turn carried a `quizMe` contract AND a grade callback is
        // wired. The MCQ renderer reads `evidential` to decide whether it grades
        // through /api/foxy/quiz-answer (moves mastery) or self-checks locally.
        // `onGrade` is always supplied (no-op safe) so the renderer's type is
        // satisfied; it is only invoked when `evidential === true`.
        const quizMeBinding: QuizMeBinding | undefined =
          msg.quizMe && onSubmitQuizAnswer
            ? {
                evidential: msg.quizMe.evidential,
                servedItemId: msg.quizMe.evidential ? msg.quizMe.servedItemId : undefined,
                onGrade: onSubmitQuizAnswer,
              }
            : undefined;

        const tutorContent = useStructured ? (
          <StructuredRenderBoundary fallback={legacyTutorContent}>
            <FoxyStructuredRenderer
              response={effectiveStructured!}
              subjectKey={activeSubject}
              quizMe={quizMeBinding}
            />
          </StructuredRenderBoundary>
        ) : (
          legacyTutorContent
        );

        return (
          <div key={msg.id}>
            <ChatBubble
              role={msg.role}
              content={msg.role === 'tutor' ? (
                <div>
                  {tutorContent}
                  {uiActionPayload && <DynamicScaffold action={uiActionPayload} />}
                </div>
              ) : (
                <div>
                  {msg.imageUrl && (
                    <div className="mb-2 rounded-xl overflow-hidden max-w-[220px]">
                      <Image src={msg.imageUrl} alt={isHi ? 'अपलोड की गई फ़ोटो' : 'Uploaded photo'} width={400} height={300} className="w-full h-auto rounded-xl" />
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              )}
              rawContent={effectiveContent}
              timestamp={msg.timestamp}
              studentName={studentName}
              xp={msg.xp}
              feedback={msg.feedback}
              reported={msg.reported}
              color={cfgColor}
              activeSubject={activeSubject}
              onFeedback={(isUp) => onFeedback(msg.id, isUp)}
              onReport={() => onReport(msg.id)}
              onSpeak={ttsSupported && msg.role === 'tutor' && onSpeak ? () => onSpeak(effectiveContent) : undefined}
              groundingStatus={msg.groundingStatus}
              traceId={msg.traceId}
              abstainReason={msg.abstainReason}
              suggestedAlternatives={msg.suggestedAlternatives}
              badgeState={msg.badgeState}
              // Only thread the persisted uuid through when the new bar is
              // active — keeps the flag-OFF ReportIssueModal payload
              // byte-identical to today (messageId was undefined before).
              messageId={learningActionsEnabled ? msg.persistedMessageId : undefined}
              learningActionsEnabled={learningActionsEnabled}
              onLearningAction={
                learningActionsEnabled && onLearningAction
                  ? (action) => onLearningAction(msg, action)
                  : undefined
              }
              saved={savedMessageIds.has(msg.id)}
              gotIt={gotItMessageIds?.has(msg.id) ?? false}
            />
            {/* Legacy Save-to-flashcard button (flag OFF — byte-identical to
                today). When the new bar is active, Save lives in its overflow
                menu, so this legacy button is suppressed. */}
            {!learningActionsEnabled && msg.role === 'tutor' && !msg.reported && (
              <div className="flex justify-start pl-11 -mt-2 mb-3">
                <button
                  onClick={() => onSaveFlashcard(msg.id, effectiveContent)}
                  disabled={savedMessageIds.has(msg.id)}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all active:scale-95 disabled:cursor-default"
                  style={{
                    background: savedMessageIds.has(msg.id) ? '#16A34A10' : 'var(--surface-1)',
                    color: savedMessageIds.has(msg.id) ? '#16A34A' : 'var(--text-3)',
                    border: `1px solid ${savedMessageIds.has(msg.id) ? '#16A34A30' : 'var(--border)'}`,
                  }}
                >
                  {savedMessageIds.has(msg.id)
                    ? (isHi ? '✓ सेव हो गया' : '✓ Saved')
                    : (isHi ? '📌 सेव करो' : '📌 Save')}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
