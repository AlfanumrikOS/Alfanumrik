'use client';

/**
 * AlfaBotInput — Textarea + send button.
 *
 * UX rules:
 *   - 1000-char hard cap; soft warn at 800.
 *   - Enter sends; Shift+Enter newline.
 *   - Disabled while streaming or rate-limited.
 *   - Mobile: NO autofocus (avoids virtual-keyboard viewport jump).
 *   - Desktop: autofocus once on panel open, then never again.
 *   - inputMode="text" and autocapitalize="off" so phones don't title-case
 *     "i" → "I" mid-sentence (annoying in Hindi/English mix).
 */

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useAlfaBot } from './AlfaBotProvider';
import { useWelcomeV2 } from '@alfanumrik/ui/landing/WelcomeV2Context';
import s from './alfabot.module.css';

const MAX_CHARS = 1000;
const SOFT_WARN_AT = 800;

export default function AlfaBotInput() {
  const { isStreaming, rateLimitedUntil, sendMessage, prefilled, clearPrefilled } = useAlfaBot();
  const { t } = useWelcomeV2();
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Apply prefilled text from FAQ link / external open() — once per change.
  useEffect(() => {
    if (prefilled && prefilled !== value) {
      setValue(prefilled);
      clearPrefilled();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilled]);

  // Desktop-only autofocus on mount. Mobile detected via the same breakpoint
  // the CSS uses (≤640px = mobile bottom sheet).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isDesktop = window.matchMedia && window.matchMedia('(min-width: 641px)').matches;
    if (isDesktop && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  const isRateLimited = !!rateLimitedUntil && rateLimitedUntil.getTime() > Date.now();
  const disabled = isStreaming || isRateLimited;
  const charCount = value.length;
  const overWarn = charCount > SOFT_WARN_AT;

  const onSubmit = (e?: FormEvent | KeyboardEvent) => {
    e?.preventDefault();
    const text = value.trim();
    if (!text || disabled) return;
    void sendMessage(text, 'typed');
    setValue('');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
    }
  };

  const placeholder = t('Type your question...', 'अपना सवाल लिखिए...');

  return (
    <form className={s.inputRow} onSubmit={onSubmit}>
      <div className={s.textareaWrap}>
        <textarea
          ref={textareaRef}
          className={s.textarea}
          value={value}
          onChange={(e) => {
            const next = e.target.value.slice(0, MAX_CHARS);
            setValue(next);
          }}
          onKeyDown={onKey}
          placeholder={placeholder}
          rows={1}
          disabled={disabled}
          maxLength={MAX_CHARS}
          inputMode="text"
          autoCapitalize="off"
          autoCorrect="on"
          spellCheck={true}
          aria-label={t('AlfaBot input', 'AlfaBot इनपुट')}
        />
        <span
          className={`${s.charCounter} ${overWarn ? s.charCounterWarn : ''}`}
          aria-hidden="true"
        >
          {charCount}/{MAX_CHARS}
        </span>
      </div>
      <button
        type="submit"
        className={s.sendBtn}
        disabled={disabled || value.trim().length === 0}
        aria-label={t('Send', 'भेजें')}
      >
        {isStreaming ? (
          <span className={s.sendSpinner} aria-hidden="true" />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M3 11.5l17-8-7 17-2.5-7L3 11.5z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              fill="currentColor"
            />
          </svg>
        )}
      </button>
    </form>
  );
}
