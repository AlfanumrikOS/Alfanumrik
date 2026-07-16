'use client';

import { useEffect, useRef, useState } from 'react';
import { WelcomeV2Provider, useWelcomeV2 } from '../WelcomeV2Context';
import Breadcrumbs from '../../Breadcrumbs';
import NavV3, { type NavV3Link } from './NavV3';
import PricingHeroV3, { type BillingCycle } from './PricingHeroV3';
import PricingPlansV3 from './PricingPlansV3';
import LadderStripV3 from './LadderStripV3';
import SchoolsBandV3 from './SchoolsBandV3';
import PricingFaqV3 from './PricingFaqV3';
import FooterV3 from './FooterV3';
import s from './welcome-v3.module.css';

/**
 * PricingV3 — /pricing marketing page on the landing-v3 design system
 * (design source of truth: design-previews/marketing-page-ultra.html,
 * same Tailark kit as WelcomeV3).
 *
 * Structure mirrors WelcomeV3.tsx exactly:
 *  - WelcomeV2Provider wraps the tree (version-agnostic language provider —
 *    the en/hi preference persists across /welcome ⇄ /pricing navigation
 *    because both read the same localStorage key)
 *  - light-theme lock: pre-paint bootstrap script + post-hydration
 *    re-assertion + body.dataset.theme pin (v3 ships no dark styles)
 *  - `lang` mirrored to <html> for screen readers
 *
 * Page-specific:
 *  - Nav anchor links point BACK at /welcome sections (preview contract);
 *    #plans / #faq stay local.
 *  - Breadcrumbs (Home → Pricing) kept exactly as the legacy page mounted
 *    them — the BreadcrumbList JSON-LD trail is an SEO surface pinned by
 *    e2e/landing-seo.spec.ts conventions.
 *  - Billing cycle state is lifted here so the hero toggle and the plan
 *    cards swap Monthly/Yearly prices in step.
 */

const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var r=document.currentScript&&document.currentScript.parentElement;if(r&&r.setAttribute){r.setAttribute('data-theme','light');}}catch(e){}})();`;

/** Preview contract: welcome-section anchors cross-link; plans/FAQ are local. */
const PRICING_NAV_LINKS: readonly NavV3Link[] = [
  { href: '/welcome#how', en: 'Features', hi: 'विशेषताएँ' },
  { href: '/welcome#ladder', en: 'The Ladder', hi: 'सीढ़ी' },
  { href: '/welcome#results', en: 'Results', hi: 'परिणाम' },
  { href: '#plans', en: 'Pricing', hi: 'मूल्य' },
  { href: '#faq', en: 'FAQ', hi: 'सामान्य प्रश्न' },
] as const;

function ThemedShell() {
  const { isHi } = useWelcomeV2();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>('monthly');

  // Mirror lang to <html> for accessibility / screen readers.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('lang', isHi ? 'hi' : 'en');
  }, [isHi]);

  // Landing surfaces are always light (same rationale as WelcomeV3).
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
      data-testid="pricing-root"
      suppressHydrationWarning
    >
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      <NavV3 links={PRICING_NAV_LINKS} />
      <Breadcrumbs items={[{ label: 'Home', href: '/welcome' }, { label: 'Pricing' }]} />
      <main>
        <PricingHeroV3 cycle={cycle} onCycleChange={setCycle} />
        <PricingPlansV3 cycle={cycle} />
        <LadderStripV3 />
        <SchoolsBandV3 />
        <PricingFaqV3 />
      </main>
      <FooterV3 />
    </div>
  );
}

export default function PricingV3() {
  return (
    <WelcomeV2Provider>
      <ThemedShell />
    </WelcomeV2Provider>
  );
}
