'use client';

/**
 * AlfaBotLauncher — Floating chat bubble + optional speech-tail nudge.
 *
 * Bundle posture (P10):
 *   This component must be lean — it ships in the initial bundle on every
 *   landing-page visit. The heavyweight AlfaBotPanel is dynamic-imported
 *   below with `ssr: false` so it only enters the browser cache on first
 *   open. We avoid SVG icon libraries; the chat-bubble glyph is a tiny
 *   inline SVG.
 *
 * Speech tail:
 *   Appears after EITHER 8s of dwell OR when the user has scrolled past
 *   WorkbookV2 (a landmark roughly 1.5 viewports down). Dismiss button
 *   persists for the session via sessionStorage. We use the same custom
 *   event channel as NavV2 to detect mobile-menu opens — when the burger
 *   opens, we hide the launcher so it doesn't compete with the nav.
 *
 * Lazy panel:
 *   `dynamic(() => import('./AlfaBotPanel'), { ssr: false, loading: () => null })`
 *   — the panel chunk is only fetched after the user clicks the launcher.
 */

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAlfaBot } from './AlfaBotProvider';
import { useWelcomeV2 } from '@/components/landing-v2/WelcomeV2Context';
import s from './alfabot.module.css';

const AlfaBotPanel = dynamic(() => import('./AlfaBotPanel'), {
  ssr: false,
  loading: () => null,
});

const TAIL_DISMISS_KEY = 'alfabot-tail-dismissed';
const DWELL_MS = 8000;

export default function AlfaBotLauncher() {
  const { isOpen, open } = useAlfaBot();
  const { t } = useWelcomeV2();
  const [tailDismissed, setTailDismissed] = useState(false);
  const [tailEligible, setTailEligible] = useState(false);
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  // Was the speech tail the trigger for opening? Used for analytics source.
  const [tailTriggered, setTailTriggered] = useState(false);

  // ── Read session-persisted tail dismiss ────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (sessionStorage.getItem(TAIL_DISMISS_KEY) === '1') {
        setTailDismissed(true);
      }
    } catch {
      /* sessionStorage unavailable */
    }
  }, []);

  // ── Trigger 1: 8s dwell ────────────────────────────────────────────────
  useEffect(() => {
    if (tailDismissed) return;
    const id = setTimeout(() => setTailEligible(true), DWELL_MS);
    return () => clearTimeout(id);
  }, [tailDismissed]);

  // ── Trigger 2: scrolled past WorkbookV2 landmark ───────────────────────
  useEffect(() => {
    if (tailDismissed) return;
    const onScroll = () => {
      // ~1.5 viewports below the fold is a safe approximation that doesn't
      // require querySelectoring the actual workbook element on every scroll.
      if (window.scrollY > window.innerHeight * 1.5) {
        setTailEligible(true);
        window.removeEventListener('scroll', onScroll);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [tailDismissed]);

  // ── Listen for mobile-menu-open events from NavV2 ──────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOpen = () => setNavMenuOpen(true);
    const onClose = () => setNavMenuOpen(false);
    window.addEventListener('welcome-v2:mobile-menu-open', onOpen);
    window.addEventListener('welcome-v2:mobile-menu-close', onClose);
    return () => {
      window.removeEventListener('welcome-v2:mobile-menu-open', onOpen);
      window.removeEventListener('welcome-v2:mobile-menu-close', onClose);
    };
  }, []);

  const tailVisible = useMemo(
    () => tailEligible && !tailDismissed && !isOpen && !navMenuOpen,
    [tailEligible, tailDismissed, isOpen, navMenuOpen],
  );

  const dismissTail = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTailDismissed(true);
    try {
      sessionStorage.setItem(TAIL_DISMISS_KEY, '1');
    } catch {
      /* noop */
    }
  };

  const handleClick = () => {
    const source = tailVisible ? 'speech_tail' : 'bubble';
    setTailTriggered(source === 'speech_tail');
    open(source);
  };

  // Hide bubble when nav menu is open OR panel is open (the panel renders its
  // own header close button — keeping the launcher visible would be visual noise).
  const launcherHidden = navMenuOpen || isOpen;

  // Hide nothing during SSR — launcher is mounted by AlfaBotMount which is
  // already ssr:false.
  return (
    <>
      {tailVisible && (
        <div
          className={`${s.speechTail} ${s.speechTailVisible}`}
          role="status"
          aria-live="polite"
          onClick={handleClick}
        >
          <span className={s.speechTailText}>
            {t(
              "Pooch lo — main 2 second me jawab du.",
              "पूछिए — मैं 2 सेकंड में जवाब दूँगा।",
            )}
          </span>
          <button
            type="button"
            className={s.speechTailDismiss}
            onClick={dismissTail}
            aria-label={t('Dismiss', 'बंद करें')}
          >
            ×
          </button>
        </div>
      )}
      {!launcherHidden && (
        <button
          type="button"
          className={s.launcher}
          aria-label={t('Open AlfaBot chat', 'AlfaBot चैट खोलें')}
          aria-expanded={isOpen}
          aria-controls="alfabot-panel"
          onClick={handleClick}
          data-testid="alfabot-launcher"
          data-tail-triggered={tailTriggered ? 'true' : undefined}
        >
          <svg className={s.launcherIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4V6a2 2 0 0 1 2-2Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              fill="rgba(255,255,255,0.1)"
            />
            <circle cx="9" cy="11" r="1.3" fill="currentColor" />
            <circle cx="13" cy="11" r="1.3" fill="currentColor" />
            <circle cx="17" cy="11" r="1.3" fill="currentColor" />
          </svg>
        </button>
      )}
      {/* Panel is rendered conditionally inside its own component (returns null
          when !isOpen). Mounting it here keeps it in the same React tree as the
          launcher and ensures the dynamic import only fires after first open. */}
      {isOpen && <AlfaBotPanel />}
    </>
  );
}
