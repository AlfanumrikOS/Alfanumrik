'use client';

/**
 * FoxyPanel — the slim, embeddable Foxy chat surface.
 *
 * Plan ref: Phase 4 U1 (FoxyPanel extraction). Renders a contextual chat
 * column composed from the moved primitives:
 *
 *   header (subject chip + optional close)
 *     ↓
 *   MessageList (slim: no save-flashcard / no report-dialog affordances)
 *     ↓
 *   MessageInput (composer + "start a new chat" nudge)
 *
 * State comes entirely from `useFoxyChat` — the same hook the full /foxy
 * page uses. All streaming, blocking, durable-thread, evidential-MCQ, and
 * learning-action wiring works out of the box.
 *
 * The panel is intentionally NOT wired to page-only chrome (TTS, sounds,
 * report dialog, save-flashcard, lesson advance, StudyToolsBar). Those
 * remain on the /foxy page and are threaded through the `SendMessageHooks`
 * pattern in useFoxyChat.
 *
 * Embed contexts:
 *   - 'today'          → dashboard "Ask Foxy" tap-gated panel
 *   - 'learn'          → learn chapter page (pre-filled subject/chapter)
 *   - 'quiz-results'   → post-quiz-review "Ask Foxy about the missed Q"
 *   - 'full'           → the /foxy page itself (aspirational; today the
 *                        full page renders its own MessageList + chrome)
 */

import { useEffect } from 'react';
import { useFoxyChat, type FoxySendPayload } from './useFoxyChat';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';

export type FoxyPanelContext = 'today' | 'learn' | 'quiz-results' | 'full';
export type FoxyPanelMode = 'learn' | 'explain' | 'practice' | 'revise' | 'doubt' | 'homework' | 'explorer';

export interface FoxyPanelProps {
  subject: string;
  grade: string;
  chapter?: string | null;
  /** Foxy mode. Defaults to 'doubt' — the embed-friendly Q&A mode. */
  mode?: FoxyPanelMode;
  context: FoxyPanelContext;
  /** Optional pre-filled prompt sent on mount (once). */
  initialPrompt?: string;
  isHi: boolean;
  language: string;
  studentId?: string;
  studentName?: string;
  /** Optional close handler — when set, the header renders a close button. */
  onClose?: () => void;
  /** Subject brand color for header chip + bubble accents. */
  subjectColor?: string;
  /** Optional voice STT support flag; embeds default to `false`. */
  voiceMode?: boolean;
}

export default function FoxyPanel({
  subject,
  grade,
  chapter,
  mode = 'doubt',
  context,
  initialPrompt,
  isHi,
  language,
  studentId,
  studentName,
  onClose,
  subjectColor = '#F97316',
  voiceMode = false,
}: FoxyPanelProps) {
  const chat = useFoxyChat();

  // Fire the initial prompt exactly once on mount when present.
  useEffect(() => {
    if (!initialPrompt || !initialPrompt.trim()) return;
    const payload: FoxySendPayload = {
      message: initialPrompt,
      studentId,
      studentName,
      grade,
      subject,
      language,
      mode,
      chapter: chapter ?? null,
    };
    void chat.sendMessage(payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = (text: string, image?: File | null) => {
    void chat.sendMessage({
      message: text,
      imageFile: image ?? null,
      studentId,
      studentName,
      grade,
      subject,
      language,
      mode,
      chapter: chapter ?? null,
    });
  };

  return (
    <div
      className="flex flex-col h-full min-h-0 rounded-2xl overflow-hidden"
      style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}
      data-testid="foxy-panel"
      data-context={context}
    >
      {/* Header — subject chip + optional close */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
            style={{
              background: `${subjectColor}15`,
              color: subjectColor,
              border: `1px solid ${subjectColor}30`,
            }}
          >
            🦊 {subject}
            {chapter ? <span className="opacity-70"> · {chapter}</span> : null}
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label={isHi ? 'बंद करो' : 'Close'}
            data-testid="foxy-panel-close"
            className="w-8 h-8 rounded-full flex items-center justify-center text-lg transition-all active:scale-95"
            style={{ background: 'var(--surface-1)', color: 'var(--text-2)' }}
          >
            ×
          </button>
        )}
      </div>

      {/* Message stream — slim: NO save-flashcard, NO report dialog. Those
          live on /foxy page.tsx only. onFeedback is a no-op so the ChatBubble
          👍/👎 controls remain visually available but do not persist a vote
          from an embed surface. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        <MessageList
          messages={chat.messages}
          collapsedAbove={null}
          onSetCollapsedAbove={() => {}}
          activeSubject={subject}
          cfgColor={subjectColor}
          studentName={studentName}
          isHi={isHi}
          ttsSupported={false}
          savedMessageIds={new Set()}
          onFeedback={() => {}}
          onReport={() => {}}
          onSaveFlashcard={() => {}}
          onSubmitQuizAnswer={chat.submitQuizAnswer}
        />
      </div>

      {/* Composer */}
      <div className="border-t" style={{ borderColor: 'var(--border)' }}>
        <MessageInput
          messages={chat.messages}
          language={language}
          isHi={isHi}
          loading={chat.loading}
          voiceMode={voiceMode}
          activeSubject={subject}
          onSend={handleSend}
          onNewConversation={chat.startNewConversation}
        />
      </div>
    </div>
  );
}
