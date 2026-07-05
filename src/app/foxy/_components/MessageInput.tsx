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
import { Button } from '@/components/ui/primitives';
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
  /** Voice 3: forwarded to ChatInput; fires with the STT-detected language. */
  onDetectedLanguage?: (lang: string) => void;
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
  onDetectedLanguage,
}: MessageInputProps) {
  const studentTurnCount = messages.filter((m) => m.role === 'student').length;

  return (
    <>
      {/* Conversation length nudge — after 15+ user messages */}
      {studentTurnCount >= 15 && (
        <div
          className="mx-3 mb-2 p-2.5 rounded-xl text-xs flex items-center justify-between gap-2"
          style={{ background: 'color-mix(in srgb, var(--accent-warm) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-warm) 20%, transparent)' }}
        >
          <span style={{ color: 'var(--accent-warm-strong)' }}>
            {isHi
              ? '🦊 नई चैट शुरू करो ताकि Foxy बेहतर जवाब दे सके!'
              : '🦊 Start a new chat so Foxy can give better answers!'}
          </span>
          <Button size="sm" className="shrink-0 rounded-full" onClick={onNewConversation}>
            {isHi ? 'नई चैट' : 'New Chat'}
          </Button>
        </div>
      )}
      <ChatInput
        onSubmit={onSend}
        subjectKey={activeSubject}
        disabled={loading}
        language={language}
        onVoiceSend={voiceMode ? onSend : undefined}
        onDetectedLanguage={onDetectedLanguage}
      />
    </>
  );
}
