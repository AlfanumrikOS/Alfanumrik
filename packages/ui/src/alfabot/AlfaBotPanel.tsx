'use client';

/**
 * AlfaBotPanel — The chat window. Lazy-loaded by the launcher on first open.
 *
 * Layout:
 *   - Mobile (≤640px): bottom sheet, slides up, max-height 70vh
 *   - Desktop (>640px): 380×560 anchored bottom-right, slides+fades
 *
 * Accessibility:
 *   - aria-modal="true" on mobile (it's truly modal — backdrop blocks the page)
 *   - role="region" on desktop (it's a side panel, not a modal)
 *   - Focus trap on mobile: Tab cycles between input/send/close/escape link
 *   - Esc closes (wired in the provider so it works even when focus isn't here)
 *   - prefers-reduced-motion handled in CSS
 */

import { useEffect, useRef } from 'react';
import { useAlfaBot } from './AlfaBotProvider';
import { useWelcomeV2 } from '@alfanumrik/ui/landing/WelcomeV2Context';
import AlfaBotMessage from './AlfaBotMessage';
import AlfaBotStarterChips from './AlfaBotStarterChips';
import AlfaBotInput from './AlfaBotInput';
import AlfaBotEscapeHatch from './AlfaBotEscapeHatch';
import AlfaBotLangNudge from './AlfaBotLangNudge';
import AlfaBotRateLimit from './AlfaBotRateLimit';
import AlfaBotInquiryForm from './AlfaBotInquiryForm';
import type { AlfabotAudience } from '@alfanumrik/lib/alfabot/types';
import s from './alfabot.module.css';

const AUDIENCE_LABEL: Record<AlfabotAudience, { en: string; hi: string }> = {
  parent: { en: 'a Parent', hi: 'अभिभावक' },
  student: { en: 'a Student', hi: 'विद्यार्थी' },
  teacher: { en: 'a Teacher', hi: 'शिक्षक' },
  school: { en: 'a School lead', hi: 'विद्यालय प्रमुख' },
};

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
}

export default function AlfaBotPanel() {
  const { messages, isOpen, close, error, audience, view } = useAlfaBot();
  const { t } = useWelcomeV2();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll body to bottom on new message. The "latest content" dep is
  // pulled into a local so the linter can statically verify the deps array.
  const latestMessageContent = messages[messages.length - 1]?.content ?? '';
  useEffect(() => {
    if (!bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages.length, latestMessageContent]);

  // Focus trap (mobile only — desktop side panel is non-modal).
  useEffect(() => {
    if (!isOpen) return;
    if (typeof document === 'undefined') return;
    if (!isMobileViewport()) return;

    const root = panelRef.current;
    if (!root) return;
    const focusables = (): HTMLElement[] =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  if (!isOpen) return null;

  const showStarters = messages.length === 0;

  const onBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) close('outside_click');
  };

  // We use aria-modal=true on mobile, role=region on desktop.
  // matchMedia at render-time picks the right mode; we still set both so SR
  // users on either form factor get coherent semantics.
  const isMobile = isMobileViewport();

  return (
    <div
      className={s.panelBackdrop}
      onClick={onBackdropClick}
      data-testid="alfabot-backdrop"
    >
      <div
        ref={panelRef}
        className={s.panel}
        role={isMobile ? 'dialog' : 'region'}
        aria-modal={isMobile ? true : undefined}
        aria-label={t('AlfaBot chat', 'AlfaBot चैट')}
        data-testid="alfabot-panel"
      >
        <header className={s.header}>
          <div className={s.headerLeft}>
            <h2 className={s.headerTitle}>AlfaBot</h2>
            <span className={s.headerAudience} aria-label={t('Active audience', 'सक्रिय दर्शक')}>
              {t(
                `Talking to you as ${AUDIENCE_LABEL[audience].en}`,
                `${AUDIENCE_LABEL[audience].hi} के रूप में`,
              )}
            </span>
          </div>
          <button
            type="button"
            className={s.headerClose}
            onClick={() => close('close_button')}
            aria-label={t('Close AlfaBot', 'AlfaBot बंद करें')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div ref={bodyRef} className={s.body} data-testid="alfabot-body">
          {view === 'inquiry' ? (
            <AlfaBotInquiryForm />
          ) : (
            <>
              {showStarters && <AlfaBotStarterChips />}
              {messages.map((m) => (
                <AlfaBotMessage key={m.id} message={m} />
              ))}
              {error && (
                <AlfaBotMessage
                  message={{
                    id: 'error-banner',
                    role: 'system',
                    content: t(
                      'Something went wrong. Please try again or message us via Contact / WhatsApp.',
                      'कुछ ग़लत हो गया। कृपया दोबारा कोशिश करें या Contact / WhatsApp के ज़रिए हमें लिखें।',
                    ),
                  }}
                />
              )}
              <AlfaBotLangNudge />
            </>
          )}
        </div>

        {view === 'chat' && (
          <footer className={s.footer}>
            <AlfaBotRateLimit />
            <AlfaBotInput />
            <AlfaBotEscapeHatch />
          </footer>
        )}
      </div>
    </div>
  );
}
