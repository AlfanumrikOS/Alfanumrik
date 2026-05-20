'use client';

/**
 * AlfaBotMessage — Single chat bubble.
 *
 * Variants:
 *   - user      — right-aligned, ink background
 *   - assistant — left-aligned, cream w/ saffron accent, optional streaming cursor
 *   - system    — centered muted pill (used for rate-limit / abstain banners)
 *
 * Accessibility:
 *   - aria-live="polite" on assistant bubbles so screen readers narrate
 *     streaming text. We attach it to the bubble itself; React updating
 *     `content` while streaming triggers SR announcements at sane intervals.
 *   - Plain text only — markdown / HTML stripped upstream by the provider.
 */

import type { AlfabotChatMessage } from './AlfaBotProvider';
import s from './alfabot.module.css';

interface AlfaBotMessageProps {
  message: AlfabotChatMessage;
}

export default function AlfaBotMessage({ message }: AlfaBotMessageProps) {
  const { role, content, isStreaming } = message;

  if (role === 'system') {
    return (
      <div className={`${s.messageRow} ${s.messageRowSystem}`} role="status">
        <div className={`${s.bubble} ${s.bubbleSystem}`}>{content}</div>
      </div>
    );
  }

  if (role === 'user') {
    return (
      <div className={`${s.messageRow} ${s.messageRowUser}`}>
        <div className={`${s.bubble} ${s.bubbleUser}`}>{content}</div>
      </div>
    );
  }

  // assistant
  return (
    <div className={`${s.messageRow} ${s.messageRowAssistant}`}>
      <div
        className={`${s.bubble} ${s.bubbleAssistant}`}
        aria-live="polite"
        aria-atomic="false"
      >
        {content}
        {isStreaming && <span className={s.streamingCursor} aria-hidden="true" />}
      </div>
    </div>
  );
}
