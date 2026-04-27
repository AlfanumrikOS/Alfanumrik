'use client';

import { useEffect } from 'react';
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

function ThemedShell() {
  const { theme, isHi } = useWelcomeV2();
  // Compute effective theme to attach as data-theme on the .root scope.
  // null/undefined = follow system; CSS @media (prefers-color-scheme) handles it.
  const dataTheme: string | undefined =
    theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : undefined;

  // Mirror lang to <html> for accessibility / SR.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('lang', isHi ? 'hi' : 'en');
  }, [isHi]);

  return (
    <div className={s.root} data-theme={dataTheme} suppressHydrationWarning>
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
