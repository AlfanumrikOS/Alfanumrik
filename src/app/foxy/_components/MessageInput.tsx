'use client';

/**
 * MessageInput — Foxy chat composer + the "long-conversation nudge".
 *
 * Plan ref: docs/superpowers/plans/2026-05-09-student-quality-upgrade.md
 *           Task 5a: extract message-input UI
 *
 * Wraps the existing `<ChatInput>` (which carries the textarea, math
 * symbol picker, voice button, and image upload) with the page-side
 * "🦊 Start a new chat so Foxy can give better answers!" nudge that
 * appears after 15+ student turns. Both are kept together because the
 * nudge sits visually attached to the input on the page.
 */

import { ChatInput } from '@/components/foxy/ChatInput';
import type { ChatMessage } from '../_lib/foxy-types';

export interface MessageInputProps {
  messages: ChatMessage[];
  /** Full language string (en/hi/hinglish) forwarded to ChatInput.
   *  Component-level copy uses isHi for the EN/HI nudge label. */
  language: string;
  isHi: boolean;
  loading: boolean;
  voiceMode: boolean;
  activeSubject: string;
  onSend: (text: string, image?: File | null) => void;
  onNewConversation: () => void;
}

export function MessageInput({
  messages,
  language,
  isHi,
  loading,
  voiceMode,
  activeSubject,
  onSend,
  onNewConversation,
}: MessageInputProps) {
  const studentTurnCount = messages.filter((m) => m.role === 'student').length;

  return (
    <>
      {/* Conversation length nudge — after 15+ user messages */}
      {studentTurnCount >= 15 && (
        <div
          className="mx-3 mb-2 p-2.5 rounded-xl text-xs flex items-center justify-between gap-2"
          style={{ background: '#F97316' + '0D', border: '1px solid #F97316' + '25' }}
        >
          <span style={{ color: '#C2410C' }}>
            {isHi
              ? '🦊 नई चैट शुरू करो ताकि Foxy बेहतर जवाब दे सके!'
              : '🦊 Start a new chat so Foxy can give better answers!'}
          </span>
          <button
            onClick={onNewConversation}
            className="shrink-0 px-3 py-1.5 rounded-full text-[10px] font-bold text-white transition-all active:scale-95"
            style={{ background: '#F97316' }}
          >
            {isHi ? 'नई चैट' : 'New Chat'}
          </button>
        </div>
      )}
      <ChatInput
        onSubmit={onSend}
        subjectKey={activeSubject}
        disabled={loading}
        language={language}
        onVoiceSend={voiceMode ? onSend : undefined}
      />
    </>
  );
}
