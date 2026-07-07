'use client';

/**
 * PrincipalAiInput — the message composer for the Principal AI Assistant.
 *
 * UX rules (mirrors the AlfaBot composer pattern, school-admin themed):
 *   - 1000-char hard cap (matches the route's MAX_MESSAGE_LENGTH); soft warn at 800.
 *   - Enter sends; Shift+Enter inserts a newline.
 *   - Disabled while a turn is in flight or the daily quota is exhausted.
 *   - 48px send target (a11y), focus-visible, labeled textarea.
 *   - inputMode="text" + autoCapitalize="off" for clean Hindi/English mixing.
 *
 * Purely presentational: the parent owns send state, quota, and the POST.
 */

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

const MAX_CHARS = 1000;
const SOFT_WARN_AT = 800;

const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

interface PrincipalAiInputProps {
  isHi: boolean;
  /** True while a turn is in flight — disables input + shows a spinner. */
  sending: boolean;
  /** True when the daily quota is exhausted — disables input. */
  quotaExhausted: boolean;
  /** Called with the trimmed message text. */
  onSend: (text: string) => void;
}

export default function PrincipalAiInput({ isHi, sending, quotaExhausted, onSend }: PrincipalAiInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const disabled = sending || quotaExhausted;
  const charCount = value.length;
  const overWarn = charCount > SOFT_WARN_AT;

  const submit = (e?: FormEvent | KeyboardEvent) => {
    e?.preventDefault();
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(e);
    }
  };

  const placeholder = quotaExhausted
    ? tt(isHi, 'Daily limit reached — try again tomorrow', 'दैनिक सीमा समाप्त — कल पुनः प्रयास करें')
    : tt(isHi, 'Ask about your school…', 'अपने स्कूल के बारे में पूछें…');

  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 border-t border-[var(--border)] bg-[var(--surface-1)] p-3"
    >
      <div className="relative flex-1">
        <label htmlFor="principal-ai-input" className="sr-only">
          {tt(isHi, 'Message the Principal Assistant', 'Principal Assistant को संदेश भेजें')}
        </label>
        <textarea
          id="principal-ai-input"
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={onKey}
          placeholder={placeholder}
          rows={1}
          disabled={disabled}
          maxLength={MAX_CHARS}
          inputMode="text"
          autoCapitalize="off"
          autoCorrect="on"
          spellCheck
          className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 pr-14 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple)] disabled:opacity-60"
        />
        {charCount > 0 && (
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute bottom-1.5 right-3 text-[10px] ${
              overWarn ? 'text-danger' : 'text-[var(--text-3)]'
            }`}
          >
            {charCount}/{MAX_CHARS}
          </span>
        )}
      </div>
      <button
        type="submit"
        disabled={disabled || value.trim().length === 0}
        aria-label={tt(isHi, 'Send', 'भेजें')}
        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-on-accent transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--purple)] disabled:opacity-40"
        style={{ background: 'var(--purple)' }}
      >
        {sending ? (
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
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
