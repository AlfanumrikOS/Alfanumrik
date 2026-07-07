'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { WelcomeV2Provider, useWelcomeV2 } from './WelcomeV2Context';
import NavV2 from './NavV2';
import HeroV2 from './HeroV2';
import StatsV2 from './StatsV2';
import MissionV2 from './MissionV2';
import WorkbookV2 from './WorkbookV2';
import ShowcaseV2 from './ShowcaseV2';
import TrustV2 from './TrustV2';
import PricingTeaserV2 from './PricingTeaserV2';
import FAQV2 from './FAQV2';
import FinalCtaV2 from './FinalCtaV2';
import FooterV2 from './FooterV2';
import { StickyMobileCTA } from './StickyMobileCTA';
import s from './welcome-v2.module.css';

/**
 * AlfaBot landing chat widget — gated by `ff_alfabot_v1`. The mount
 * component performs its own flag probe and renders nothing when the flag
 * is off, so unconditional inclusion here is safe. `ssr: false` keeps it
 * out of the initial server-rendered HTML; the launcher chunk loads after
 * hydration on first paint.
 */
const AlfaBotMount = dynamic(
  () => import('@alfanumrik/ui/alfabot').then((m) => m.AlfaBotMount),
  { ssr: false, loading: () => null },
);

/**
 * Inline blocking script that runs BEFORE first paint.
 *
 * 2026-05-11: dark mode removed from the landing page per user direction.
 * The landing surface always renders light regardless of localStorage /
 * matchMedia. The dark CSS in welcome-v2.module.css is left in place for
 * potential future re-enable; this script + the useEffect below short-
 * circuit theme resolution to 'light' so those selectors never apply.
 *
 * Stringified inside a <script dangerouslySetInnerHTML> so React injects it
 * as raw markup.
 */
const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var r=document.currentScript&&document.currentScript.parentElement;if(r&&r.setAttribute){r.setAttribute('data-theme','light');}}catch(e){}})();`;

function ThemedShell() {
  const { isHi } = useWelcomeV2();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Mirror lang to <html> for accessibility / SR.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('lang', isHi ? 'hi' : 'en');
  }, [isHi]);

  // 2026-05-11: Landing always light. Earlier this effect resolved theme
  // from the WelcomeV2Context (light/dark/null=system) and registered a
  // matchMedia listener for system-preference changes. Both are gone — the
  // landing surface is locked to light. Bootstrap script above already
  // writes the attribute synchronously pre-paint; this effect re-asserts
  // it post-hydration in case any intermediate code mutated the attribute.
  useEffect(() => {
    const root = rootRef.current;
    if (root) root.setAttribute('data-theme', 'light');
  }, []);

  return (
    <div
      ref={rootRef}
      className={s.root}
      data-testid="welcome-root"
      suppressHydrationWarning
    >
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      <NavV2 />
      <main>
        <HeroV2 />
        <StatsV2 />
        <MissionV2 />
        <WorkbookV2 />
        <ShowcaseV2 />
        <TrustV2 />
        <PricingTeaserV2 />
        <FAQV2 />
        <FinalCtaV2 />
      </main>
      <FooterV2 />
      <StickyMobileCTA />
      <AlfaBotMount />
    </div>
  );
}

export default function WelcomeV2() {
  // NOTE (Wave 1): the old <LangProvider> (from ./LangToggle) wrapper was
  // removed — it was vestigial. The entire WelcomeV2 tree reads language from
  // WelcomeV2Context (useWelcomeV2) only; nothing under this tree calls
  // useLang(). LangProvider/useLang remain in use by the *legacy* landing
  // components (Hero.tsx, Footer.tsx, …) and the /for-* and /pricing routes,
  // which mount their own LangProvider — so the export is untouched.
  return (
    <WelcomeV2Provider>
      <ThemedShell />
    </WelcomeV2Provider>
  );
}
