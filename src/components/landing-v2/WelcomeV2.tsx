'use client';

import { useEffect, useRef, useState } from 'react';
import { WelcomeV2Provider, useWelcomeV2 } from './WelcomeV2Context';
import NavV2 from './NavV2';
import HeroV2 from './HeroV2';
import StatsV2 from './StatsV2';
import WorkbookV2 from './WorkbookV2';
import ShowcaseV2 from './ShowcaseV2';
import TrustV2 from './TrustV2';
import PricingTeaserV2 from './PricingTeaserV2';
import FinalCtaV2 from './FinalCtaV2';
import FooterV2 from './FooterV2';
import s from './welcome-v2.module.css';

/**
 * Inline blocking script that runs BEFORE first paint.
 * Resolves the effective theme from localStorage → matchMedia and writes it
 * onto the .root element synchronously, so trust quotes / footer / pricing
 * tag render against the correct dark/light colour from the very first frame.
 *
 * Without this, system-dark users with `theme === null` would see ~40
 * components stuck in light variants (their dark overrides live under
 * `[data-theme='dark']`, not under the @media block) — the production
 * regression we're hot-fixing.
 *
 * Stringified inside a <script dangerouslySetInnerHTML> so React injects it
 * as raw markup. The script tags itself by id so React can find the same
 * .root in hydration.
 */
const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var k='alfanumrik-theme';var s=localStorage.getItem(k);var t=(s==='dark'||s==='light')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var r=document.currentScript&&document.currentScript.parentElement;if(r&&r.setAttribute){r.setAttribute('data-theme',t);}document.body&&document.body.setAttribute('data-theme',t);}catch(e){}})();`;

function ThemedShell() {
  const { theme, isHi } = useWelcomeV2();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Mounted flag so SSR can render WITHOUT a data-theme (the inline script
  // sets it pre-paint), and after hydration we control it via React for
  // user-driven toggles. Avoids hydration mismatch warnings.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Mirror lang to <html> for accessibility / SR.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('lang', isHi ? 'hi' : 'en');
  }, [isHi]);

  /**
   * After mount, when the user has NO explicit preference (theme === null),
   * mirror the OS `prefers-color-scheme` to the data-theme attribute and
   * keep it in sync with system changes. This is the PRIMARY fix for the
   * ~40 invisible-element bugs: without an explicit data-theme, the
   * `.root[data-theme='dark'] X` selectors don't apply and elements stay
   * stuck in their light defaults on a dark background.
   *
   * When the user HAS an explicit preference, we set data-theme directly to
   * that value below — this effect bails early.
   */
  useEffect(() => {
    if (!mounted) return;
    const root = rootRef.current;
    if (!root) return;

    if (theme === 'dark' || theme === 'light') {
      root.setAttribute('data-theme', theme);
      // Mirror to body so the NavV2 useEffect (legacy) and any global
      // selectors stay aligned.
      if (typeof document !== 'undefined') {
        document.body.setAttribute('data-theme', theme);
      }
      return;
    }

    // theme === null → follow system, with live updates.
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const next = mq.matches ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      if (typeof document !== 'undefined') {
        document.body.setAttribute('data-theme', next);
      }
    };
    apply();
    // Older Safari uses addListener; modern browsers use addEventListener.
    if (mq.addEventListener) {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
    mq.addListener(apply);
    return () => {
      mq.removeListener(apply);
    };
  }, [mounted, theme]);

  return (
    <div ref={rootRef} className={s.root} suppressHydrationWarning>
      {/*
        Inline script runs synchronously at parse time, BEFORE React hydrates.
        It writes data-theme onto this very <div> (its parentElement) so the
        first paint already uses the correct theme. After hydration, the
        useEffect above takes over and keeps the attribute in sync with state
        and system changes.
      */}
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      <NavV2 />
      <main>
        <HeroV2 />
        <StatsV2 />
        <WorkbookV2 />
        <ShowcaseV2 />
        <TrustV2 />
        <PricingTeaserV2 />
        <FinalCtaV2 />
      </main>
      <FooterV2 />
    </div>
  );
}

export default function WelcomeV2() {
  return (
    <WelcomeV2Provider>
      <ThemedShell />
    </WelcomeV2Provider>
  );
}
