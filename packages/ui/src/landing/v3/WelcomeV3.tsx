'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { WelcomeV2Provider, useWelcomeV2 } from '../WelcomeV2Context';
import NavV3 from './NavV3';
import HeroV3 from './HeroV3';
import TrustStripV3 from './TrustStripV3';
import FeaturesV3 from './FeaturesV3';
import HowFoxyThinksV3 from './HowFoxyThinksV3';
import LadderV3 from './LadderV3';
import OutcomeV3 from './OutcomeV3';
import TestimonialsV3 from './TestimonialsV3';
import PricingTeaserV3 from './PricingTeaserV3';
import FAQV3 from './FAQV3';
import FinalCtaV3 from './FinalCtaV3';
import FooterV3 from './FooterV3';
import s from './welcome-v3.module.css';

/**
 * WelcomeV3 — landing-page orchestrator for the CEO-approved v3 redesign
 * (design source of truth: design-previews/welcome-ultra.html, Tailark-kit
 * anatomy). Mirrors the structural role of ../WelcomeV2.tsx:
 *
 *  - wraps the tree in WelcomeV2Provider (language state / t() / isHi — the
 *    provider is version-agnostic despite its name; V3 deliberately reuses it
 *    so the en/hi preference persists across V2 ⇄ V3 rollback flips)
 *  - `data-testid="welcome-root"` + light-theme lock + suppressHydrationWarning
 *  - AlfaBotMount via next/dynamic ssr:false (flag-gated, safe unconditional)
 *
 * WelcomeV2 remains fully wired and reachable at /welcome?v=2 for rollback —
 * V2 component removal happens in a later cleanup PR.
 */

/**
 * AlfaBot landing chat widget — gated by `ff_alfabot_v1`. The mount
 * component performs its own flag probe and renders nothing when the flag
 * is off, so unconditional inclusion here is safe. `ssr: false` keeps it
 * out of the initial server-rendered HTML; the launcher chunk loads after
 * hydration on first paint. (Pattern copied from WelcomeV2.tsx.)
 */
const AlfaBotMount = dynamic(
  () => import('@alfanumrik/ui/alfabot').then((m) => m.AlfaBotMount),
  { ssr: false, loading: () => null },
);

/**
 * Inline blocking script that runs BEFORE first paint (copied from
 * WelcomeV2.tsx). The landing surface is locked to light regardless of
 * localStorage / matchMedia — the v3 stylesheet ships no dark styles, but
 * the attribute keeps any global body[data-theme] selectors resolving to
 * their light branch.
 */
const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var r=document.currentScript&&document.currentScript.parentElement;if(r&&r.setAttribute){r.setAttribute('data-theme','light');}}catch(e){}})();`;

function ThemedShell() {
  const { isHi } = useWelcomeV2();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Mirror lang to <html> for accessibility / screen readers.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('lang', isHi ? 'hi' : 'en');
  }, [isHi]);

  // Landing is always light. The bootstrap script above writes the attribute
  // synchronously pre-paint; this effect re-asserts it post-hydration in case
  // any intermediate code (AuthContext theme resolution for system-dark
  // visitors) mutated the attribute. Also pin body.dataset.theme so legacy
  // global selectors resolve to their light branch (NavV2 precedent).
  useEffect(() => {
    const root = rootRef.current;
    if (root) root.setAttribute('data-theme', 'light');
    if (typeof document === 'undefined') return;
    document.body.dataset.theme = 'light';
    return () => {
      if (typeof document !== 'undefined') delete document.body.dataset.theme;
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={s.root}
      data-testid="welcome-root"
      // lang is set server-side on the shell (the closest element we own —
      // <html> belongs to the root layout) so ?lang=hi SSR HTML is announced
      // as Hindi before hydration; the effect above syncs <html lang> after.
      lang={isHi ? 'hi' : 'en'}
      suppressHydrationWarning
    >
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      <NavV3 />
      <main>
        <HeroV3 />
        <TrustStripV3 />
        <FeaturesV3 />
        <HowFoxyThinksV3 />
        <LadderV3 />
        <OutcomeV3 />
        <TestimonialsV3 />
        <PricingTeaserV3 />
        <FAQV3 />
        <FinalCtaV3 />
      </main>
      <FooterV3 />
      <AlfaBotMount />
    </div>
  );
}

export default function WelcomeV3({
  initialLang,
}: {
  /**
   * Server-derived language from the `?lang=` URL param (threaded by
   * apps/host/src/app/welcome/page.tsx). Seeds WelcomeV2Provider so the
   * SSR HTML renders in the requested language; explicit param wins over
   * the localStorage preference post-hydration. Omitted → unchanged
   * behavior (EN first paint, localStorage hydration).
   */
  initialLang?: 'en' | 'hi';
} = {}) {
  return (
    <WelcomeV2Provider initialLang={initialLang}>
      <ThemedShell />
    </WelcomeV2Provider>
  );
}
