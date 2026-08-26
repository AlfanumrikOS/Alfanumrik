'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useWelcomeV2 } from '../WelcomeV2Context';
import { track } from '@alfanumrik/lib/posthog/client';
import FoxyMascot from './FoxyMascot';
import s from './welcome-v3.module.css';

/**
 * V3 nav — Tailark hero-section-1 anatomy: logo · anchor links · actions.
 * The V2 role switcher is intentionally removed (CEO-approved preview has
 * none); analytics therefore report the constant `active_role: 'parent'` —
 * the primary buying persona for this page.
 *
 * Faithful-to-preview note: below 1024px the anchor links are hidden with no
 * burger menu (the preview has none — every section is one scroll away).
 */

/** V3 landing has no role switcher; analytics use this constant persona. */
export const V3_ACTIVE_ROLE = 'parent';

/** One primary-nav link. Same-page anchors and cross-page hrefs both allowed. */
export interface NavV3Link {
  href: string;
  en: string;
  hi: string;
}

const LINKS: readonly NavV3Link[] = [
  { href: '#how', en: 'Features', hi: 'विशेषताएँ' },
  { href: '#ladder', en: 'The Ladder', hi: 'सीढ़ी' },
  { href: '#results', en: 'Results', hi: 'परिणाम' },
  { href: '#pricing', en: 'Pricing', hi: 'मूल्य' },
  { href: '#faq', en: 'FAQ', hi: 'सामान्य प्रश्न' },
] as const;

export default function NavV3({
  /**
   * Override the anchor links for V3 pages other than /welcome (e.g. /pricing
   * points Features/Ladder/Results back at /welcome#… and keeps #plans/#faq
   * local, matching design-previews/marketing-page-ultra.html). Defaults to
   * the /welcome anchor set — existing callers are unchanged.
   */
  links = LINKS,
}: {
  links?: readonly NavV3Link[];
} = {}) {
  const { isHi, toggleLang, t } = useWelcomeV2();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={s.nav}>
      <div className={s.navInner}>
        <Link href="/" className={s.navLogo} aria-label="Alfanumrik home">
          <FoxyMascot size={28} />
          <strong>Alfanumrik</strong>
        </Link>

        <nav aria-label={t('Primary', 'मुख्य')}>
          <ul className={s.navLinks}>
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() =>
                    track('landing_nav_click', {
                      source: 'primary',
                      destination: link.href,
                      label: t(link.en, link.hi),
                      active_role: V3_ACTIVE_ROLE,
                    })
                  }
                >
                  {t(link.en, link.hi)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <button type="button" className={s.hamburger} onClick={() => setMenuOpen(true)} aria-label="Menu">
          <svg className={s.icon} viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>

        <div className={s.navActions}>
          <button
            type="button"
            className={s.langToggle}
            onClick={toggleLang}
            aria-pressed={isHi}
            aria-label={isHi ? 'Switch to English' : 'भाषा हिन्दी में बदलें'}
          >
            {isHi ? (
              <>
                <span lang="hi">हिं</span> · EN
              </>
            ) : (
              <>
                EN · <span lang="hi">हिं</span>
              </>
            )}
          </button>
          <Link
            href="/login"
            className={`${s.btn} ${s.btnGhost} ${s.btnSm} ${s.navLogin}`}
            onClick={() =>
              track('landing_cta_click', {
                location: 'nav',
                destination: '/login',
                active_role: V3_ACTIVE_ROLE,
                language: isHi ? 'hi' : 'en',
              })
            }
          >
            {t('Log in', 'लॉग इन')}
          </Link>
          <Link
            href="/login"
            className={`${s.btn} ${s.btnPrimary} ${s.btnSm}`}
            onClick={() =>
              track('landing_cta_click', {
                location: 'nav',
                destination: '/login',
                active_role: V3_ACTIVE_ROLE,
                language: isHi ? 'hi' : 'en',
              })
            }
          >
            {t('Start free', 'मुफ्त शुरू करें')}
          </Link>
        </div>
      </div>
      {menuOpen && (
        <div className={s.mobileOverlay} role="dialog" aria-label="Menu">
          <div className={s.mobileOverlayBackdrop} onClick={() => setMenuOpen(false)} />
          <div className={s.mobilePanel}>
            <div className={s.mobilePanelHeader}>
              <Link href="/" className={s.navLogo} onClick={() => setMenuOpen(false)}>
                <FoxyMascot size={28} />
                <strong>Alfanumrik</strong>
              </Link>
              <button type="button" className={s.mobileClose} onClick={() => setMenuOpen(false)} aria-label="Close">
                <svg className={s.icon} viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <nav>
              <ul className={s.mobileLinks}>
                {links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} onClick={() => { track('landing_nav_click', { source: 'mobile_menu', destination: link.href, label: t(link.en, link.hi), active_role: V3_ACTIVE_ROLE }); setMenuOpen(false); }}>
                      {t(link.en, link.hi)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className={s.mobileActions}>
              <button type="button" className={s.langToggle} onClick={toggleLang} aria-pressed={isHi}>
                {isHi ? <><span lang="hi">हिं</span> · EN</> : <>EN · <span lang="hi">हिं</span></>}
              </button>
              <Link href="/login" className={`${s.btn} ${s.btnGhost}`} onClick={() => setMenuOpen(false)}>
                {t('Log in', 'लॉग इन')}
              </Link>
              <Link href="/login" className={`${s.btn} ${s.btnPrimary}`} onClick={() => setMenuOpen(false)}>
                {t('Start free', 'मुफ्त शुरू करें')}
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
