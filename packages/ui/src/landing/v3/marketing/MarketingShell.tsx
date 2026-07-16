'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { WelcomeV2Provider, useWelcomeV2 } from '../../WelcomeV2Context';
import Breadcrumbs from '../../../Breadcrumbs';
import NavV3, { type NavV3Link } from '../NavV3';
import FooterV3 from '../FooterV3';
import s from '../welcome-v3.module.css';

/**
 * MarketingShell — the shared page shell for the non-/welcome, non-/pricing
 * marketing pages rebuilt on the landing-v3 design system (/for-parents,
 * /for-teachers, /for-schools, /product, /about).
 *
 * Structure copies PricingV3.tsx exactly:
 *  - WelcomeV2Provider wraps the tree (version-agnostic language provider —
 *    the en/hi preference persists across every V3 marketing surface because
 *    all of them read the same localStorage key)
 *  - light-theme lock: pre-paint bootstrap script + post-hydration
 *    re-assertion + body.dataset.theme pin (v3 ships no dark styles)
 *  - `lang` mirrored to <html> for screen readers
 *  - NavV3 (links prop) → Breadcrumbs passthrough → <main> → FooterV3
 *
 * data-testid: per-page via the `testId` prop. NEVER "welcome-root" — that
 * id is unique to /welcome (pinned by e2e/welcome-landing.spec.ts).
 *
 * Breadcrumbs are a passthrough: each page keeps its legacy trail EXACTLY
 * (the BreadcrumbList JSON-LD is an SEO surface pinned by
 * e2e/landing-seo.spec.ts — e.g. For-Parents = Home → Solutions (no URL)
 * → For Parents).
 */

const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var r=document.currentScript&&document.currentScript.parentElement;if(r&&r.setAttribute){r.setAttribute('data-theme','light');}}catch(e){}})();`;

/**
 * Default nav set for deep marketing pages: section anchors point BACK at
 * /welcome (same preview contract as PricingV3's nav); Pricing goes to the
 * real /pricing page. Pages may override via the `navLinks` prop.
 */
export const MARKETING_NAV_LINKS: readonly NavV3Link[] = [
  { href: '/welcome#how', en: 'Features', hi: 'विशेषताएँ' },
  { href: '/welcome#ladder', en: 'The Ladder', hi: 'सीढ़ी' },
  { href: '/welcome#results', en: 'Results', hi: 'परिणाम' },
  { href: '/pricing', en: 'Pricing', hi: 'मूल्य' },
  { href: '/welcome#faq', en: 'FAQ', hi: 'सामान्य प्रश्न' },
] as const;

export interface MarketingCrumb {
  label: string;
  /** Omit for the current page and for non-page intermediates ("Solutions"). */
  href?: string;
}

export interface MarketingShellProps {
  /** Per-page root test id, e.g. "for-parents-root". */
  testId: string;
  /** Legacy breadcrumb trail, preserved verbatim (SEO-pinned). */
  breadcrumbs: MarketingCrumb[];
  /** Override the primary nav links (defaults to MARKETING_NAV_LINKS). */
  navLinks?: readonly NavV3Link[];
  children: ReactNode;
}

function ThemedShell({
  testId,
  breadcrumbs,
  navLinks = MARKETING_NAV_LINKS,
  children,
}: MarketingShellProps) {
  const { isHi } = useWelcomeV2();
  const rootRef = useRef<HTMLDivElement | null>(null);

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
      data-testid={testId}
      suppressHydrationWarning
    >
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      <NavV3 links={navLinks} />
      <Breadcrumbs items={breadcrumbs} />
      <main>{children}</main>
      <FooterV3 />
    </div>
  );
}

export default function MarketingShell(props: MarketingShellProps) {
  return (
    <WelcomeV2Provider>
      <ThemedShell {...props} />
    </WelcomeV2Provider>
  );
}
