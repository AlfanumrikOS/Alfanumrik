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

import { memo } from 'react';
import dynamic from 'next/dynamic';
import { ChatBubble } from '@/components/foxy/ChatBubble';
import { StructuredRenderBoundary } from '@/components/foxy/StructuredRenderBoundary';
import { isFoxyResponse } from '@/lib/foxy/is-foxy-response';
import { recoverFoxyResponseFromText } from '@/lib/foxy/recover-from-text';
import { denormalizeFoxyResponse } from '@/lib/foxy/denormalize';
import type { ChatMessage } from '../_lib/foxy-types';

const RichContent = dynamic(
  () => import('@/components/foxy/RichContent').then((m) => ({ default: m.RichContent })),
  { ssr: false, loading: () => null },
);

const FoxyStructuredRenderer = dynamic(
  () => import('@/components/foxy/FoxyStructuredRenderer').then((m) => ({ default: m.FoxyStructuredRenderer })),
  { ssr: false, loading: () => null },
);

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
}

function MessageListInner({
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
        const effectiveContent = recoveredStructured
          ? denormalizeFoxyResponse(recoveredStructured)
          : msg.content;

        const legacyTutorContent = (
          <RichContent content={effectiveContent} subjectKey={activeSubject} />
        );
        const tutorContent = useStructured ? (
          <StructuredRenderBoundary fallback={legacyTutorContent}>
            <FoxyStructuredRenderer
              response={effectiveStructured!}
              subjectKey={activeSubject}
            />
          </StructuredRenderBoundary>
        ) : (
          legacyTutorContent
        );

        return (
          <div key={msg.id}>
            <ChatBubble
              role={msg.role}
              content={msg.role === 'tutor' ? tutorContent : (
                <div>
                  {msg.imageUrl && (
                    <div className="mb-2 rounded-xl overflow-hidden max-w-[220px]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={msg.imageUrl} alt={isHi ? 'अपलोड की गई फ़ोटो' : 'Uploaded photo'} className="w-full h-auto rounded-xl" />
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
            />
            {msg.role === 'tutor' && !msg.reported && (
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

/**
 * REG-78 flicker fix (2026-05-24): wrap MessageList in React.memo so a
 * parent re-render that doesn't actually change ANY of MessageList's props
 * (notably the optional-callback props during streaming) doesn't force the
 * dedup IIFE + .map + per-message recovery work to run again.
 *
 * The per-bubble ChatBubble memo already prevents already-rendered bubbles
 * from re-running their render bodies, but the parent JSX construction (the
 * dedup + map + tutorContent JSX trees + the savedMessageIds set lookups)
 * still ran on every parent render before this wrap. With React.memo here,
 * MessageList only re-renders when one of its props actually changes
 * reference — which, during a streamed turn, only happens once per ~50ms
 * flush instead of on every unrelated parent state change.
 *
 * Default shallow comparator is correct: every prop is a primitive, a
 * stable array reference (savedMessageIds is a Set), a stable useCallback,
 * or the messages array itself (which mutates by reference on each flush).
 */
export const MessageList = memo(MessageListInner);
