'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useWelcomeV2, type Role } from './WelcomeV2Context';
import s from './welcome-v2.module.css';

const ROLES: { id: Role; en: string; hi: string }[] = [
  { id: 'parent', en: 'Parent', hi: 'अभिभावक' },
  { id: 'student', en: 'Student', hi: 'विद्यार्थी' },
  { id: 'teacher', en: 'Teacher', hi: 'शिक्षक' },
  { id: 'school', en: 'School', hi: 'विद्यालय' },
];

export default function NavV2() {
  const { isHi, toggleLang, theme, toggleTheme, role, setRole, t } = useWelcomeV2();
  const [menuOpen, setMenuOpen] = useState(false);
  const tabsRef = useRef<HTMLDivElement | null>(null);

  // Apply theme attribute on document.body for any global third-party styles, plus the .root scope
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (theme === 'dark') document.body.dataset.theme = 'dark';
    else if (theme === 'light') document.body.dataset.theme = 'light';
    else delete document.body.dataset.theme;
    return () => {
      if (typeof document !== 'undefined') delete document.body.dataset.theme;
    };
  }, [theme]);

  // Lock background scroll when full-screen menu open
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      if (typeof document !== 'undefined') document.body.style.overflow = '';
    };
  }, [menuOpen]);

  // Arrow-key navigation on the role tablist (WAI-ARIA pattern)
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next =
      e.key === 'ArrowRight'
        ? ROLES[(idx + 1) % ROLES.length]
        : ROLES[(idx - 1 + ROLES.length) % ROLES.length];
    setRole(next.id);
    // Focus the corresponding button after state updates
    requestAnimationFrame(() => {
      const btn = tabsRef.current?.querySelector<HTMLButtonElement>(
        `button[data-role="${next.id}"]`,
      );
      btn?.focus();
    });
  };

  const isDark = theme === 'dark';
  const themeIcon = isDark ? '☼' : '◐';

  return (
    <>
      <nav className={s.nav} aria-label="Primary">
        <div className={s.navInner}>
          <Link href="/" className={s.brand} aria-label="Alfanumrik home">
            <span className={s.brandMark} aria-hidden="true">A</span>
            <span className={s.brandName}>
              Alfanumrik<sup>TM</sup>
            </span>
          </Link>

          <div
            ref={tabsRef}
            className={s.roleSwitcher}
            role="tablist"
            aria-label={t('Choose your view', 'अपनी भूमिका चुनें')}
          >
            {ROLES.map((r, idx) => (
              <button
                key={r.id}
                role="tab"
                type="button"
                data-role={r.id}
                aria-selected={role === r.id}
                tabIndex={role === r.id ? 0 : -1}
                onClick={() => setRole(r.id)}
                onKeyDown={(e) => onTabKeyDown(e, idx)}
              >
                {t(r.en, r.hi)}
              </button>
            ))}
          </div>

          <div className={s.navRight}>
            <button
              type="button"
              className={s.langToggle}
              onClick={toggleLang}
              aria-pressed={isHi}
              aria-label={
                isHi ? 'Switch to English' : 'भाषा हिन्दी में बदलें'
              }
            >
              {isHi ? <><span lang="hi">हिं</span> · EN</> : <>EN · <span lang="hi">हिं</span></>}
            </button>
            <button
              type="button"
              className={s.themeToggle}
              onClick={toggleTheme}
              aria-pressed={isDark}
              aria-label={t('Toggle dark mode', 'डार्क मोड टॉगल करें')}
              title={t('Toggle dark mode', 'डार्क मोड टॉगल करें')}
            >
              <span aria-hidden="true">{themeIcon}</span>
            </button>
            <Link href="/login" className={`${s.btn} ${s.btnInk} ${s.btnArrow}`}>
              <span className={s.navCtaLabel}>{t('Start free', 'मुफ्त शुरू करें')}</span>
              <span className={s.srOnly}>{t('Start free', 'मुफ्त शुरू करें')}</span>
            </Link>
            <button
              type="button"
              className={s.menuBtn}
              onClick={() => setMenuOpen(true)}
              aria-label={t('Open menu', 'मेन्यू खोलें')}
              aria-expanded={menuOpen}
              aria-controls="welcomeV2Menu"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="square" aria-hidden="true">
                <line x1="3" y1="7" x2="21" y2="7" />
                <line x1="3" y1="13" x2="21" y2="13" />
                <line x1="3" y1="19" x2="21" y2="19" />
              </svg>
            </button>
          </div>
        </div>
      </nav>

      {/* Issue bar */}
      <div className={s.issueBar}>
        <div className={s.wrap}>
          <div className={s.issueBarInner}>
            <div className="left">
              <span>Vol. 1 · Issue 04</span>
              <span>Bengaluru · Mumbai · Delhi</span>
              <span>26 Apr 2026</span>
            </div>
            <div className="right">
              <span>CBSE 6 — 12</span>
              <span><span lang="hi">हिन्दी</span> + English</span>
              <span>{t('Built in India', 'भारत में निर्मित')}</span>
              <span>DPDPA-aligned</span>
            </div>
          </div>
        </div>
      </div>

      {/* Full-screen mobile menu (always rendered; transform controls visibility) */}
      <div
        id="welcomeV2Menu"
        className={s.menu}
        role="dialog"
        aria-modal="true"
        aria-hidden={!menuOpen}
        aria-label={t('Site menu', 'साइट मेन्यू')}
      >
        <div className={s.menuHead}>
          <Link
            href="/"
            className={s.brand}
            aria-label="Alfanumrik home"
            onClick={() => setMenuOpen(false)}
          >
            <span className={s.brandMark} aria-hidden="true">A</span>
            <span className={s.brandName}>Alfanumrik</span>
          </Link>
          <button
            type="button"
            className={s.menuBtn}
            onClick={() => setMenuOpen(false)}
            aria-label={t('Close menu', 'मेन्यू बंद करें')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="square" aria-hidden="true">
              <line x1="5" y1="5" x2="19" y2="19" />
              <line x1="19" y1="5" x2="5" y2="19" />
            </svg>
          </button>
        </div>

        <div className={s.menuBody}>
          <div className={s.menuSection}>
            <span className={s.label}>{t('I am a', 'मैं हूँ')}</span>
            <div className={s.menuRoles} role="tablist">
              {ROLES.map((r) => (
                <button
                  key={r.id}
                  role="tab"
                  type="button"
                  data-role={r.id}
                  aria-selected={role === r.id}
                  className={role === r.id ? 'active' : undefined}
                  onClick={() => {
                    setRole(r.id);
                    setMenuOpen(false);
                  }}
                >
                  {t(r.en, r.hi)}
                </button>
              ))}
            </div>
          </div>

          <div className={s.menuSection}>
            <span className={s.label}>{t('Read in', 'भाषा')}</span>
            <div className={s.menuToggles}>
              <button type="button" onClick={toggleLang} aria-label={t('Toggle language', 'भाषा बदलें')}>
                {isHi ? <><span lang="hi">हिं</span> · EN</> : <>EN · <span lang="hi">हिं</span></>}
              </button>
              <button type="button" onClick={toggleTheme} aria-label={t('Toggle theme', 'थीम बदलें')}>
                {isDark ? t('Dark · Light', 'डार्क · लाइट') : t('Light · Dark', 'लाइट · डार्क')}
              </button>
            </div>
          </div>

          <nav className={s.menuNav} aria-label={t('Sections', 'अनुभाग')}>
            <Link href="#stats" onClick={() => setMenuOpen(false)}>
              <span className="num">01</span>
              {t('By the numbers', 'आँकड़ों में')}
            </Link>
            <Link href="#how" onClick={() => setMenuOpen(false)}>
              <span className="num">02</span>
              {t('What changes', 'क्या बदलता है')}
            </Link>
            <Link href="#showcase" onClick={() => setMenuOpen(false)}>
              <span className="num">03</span>
              {t('Inside the product', 'उत्पाद के अंदर')}
            </Link>
            <Link href="#trust" onClick={() => setMenuOpen(false)}>
              <span className="num">04</span>
              {t('Voices', 'आवाज़ें')}
            </Link>
            <Link href="#pricing" onClick={() => setMenuOpen(false)}>
              <span className="num">05</span>
              {t('Plans & pricing', 'योजनाएँ')}
            </Link>
            <Link href="#cta" onClick={() => setMenuOpen(false)}>
              <span className="num">06</span>
              {t('Begin a session', 'शुरू कीजिये')}
            </Link>
          </nav>
        </div>

        <div className={s.menuFoot}>
          <span className="deva" lang="hi">
            सीखना — एक बैठक में, एक हाथ में।
          </span>
        </div>
      </div>
    </>
  );
}
