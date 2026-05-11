'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useWelcomeV2, type Role } from './WelcomeV2Context';
import { track } from '@/lib/posthog/client';
import s from './welcome-v2.module.css';

const ROLES: { id: Role; en: string; hi: string }[] = [
  { id: 'parent', en: 'Parent', hi: 'अभिभावक' },
  { id: 'student', en: 'Student', hi: 'विद्यार्थी' },
  { id: 'teacher', en: 'Teacher', hi: 'शिक्षक' },
  { id: 'school', en: 'School', hi: 'विद्यालय' },
];

interface SolutionItem {
  href: string;
  en: string;
  hi: string;
  deva: string;
}

const SOLUTIONS: SolutionItem[] = [
  { href: '/for-parents', en: 'For Parents', hi: 'अभिभावकों के लिए', deva: 'अभिभावकों के लिए' },
  { href: '/for-teachers', en: 'For Teachers', hi: 'शिक्षकों के लिए', deva: 'शिक्षकों के लिए' },
  { href: '/for-schools', en: 'For Schools', hi: 'विद्यालयों के लिए', deva: 'विद्यालयों के लिए' },
];

export default function NavV2() {
  const { isHi, toggleLang, role, setRole, t } = useWelcomeV2();
  const [menuOpen, setMenuOpen] = useState(false);
  const [solutionsOpen, setSolutionsOpen] = useState(false);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const stripTabsRef = useRef<HTMLDivElement | null>(null);
  const solutionsBtnRef = useRef<HTMLButtonElement | null>(null);
  const solutionsPanelRef = useRef<HTMLDivElement | null>(null);

  // 2026-05-11: landing is locked to light. Set body.dataset.theme='light'
  // on mount so any legacy global selectors that respond to body[data-theme]
  // resolve to the light branch instead of inheriting whatever AuthContext
  // wrote to documentElement (which may be 'dark' for system-dark visitors).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.dataset.theme = 'light';
    return () => {
      if (typeof document !== 'undefined') delete document.body.dataset.theme;
    };
  }, []);

  // Lock background scroll when full-screen menu open
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      if (typeof document !== 'undefined') document.body.style.overflow = '';
    };
  }, [menuOpen]);

  // Close Solutions dropdown on outside click + Escape
  useEffect(() => {
    if (!solutionsOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (
        solutionsPanelRef.current?.contains(target) ||
        solutionsBtnRef.current?.contains(target)
      ) {
        return;
      }
      setSolutionsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSolutionsOpen(false);
        // Restore focus to the trigger button
        requestAnimationFrame(() => solutionsBtnRef.current?.focus());
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [solutionsOpen]);

  // Arrow-key navigation on a role tablist (WAI-ARIA pattern). Shared between
  // top tablist (when present) and the relocated strip below the issue bar.
  const makeTabKeyDown =
    (containerRef: React.RefObject<HTMLDivElement | null>) =>
    (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next =
        e.key === 'ArrowRight'
          ? ROLES[(idx + 1) % ROLES.length]
          : ROLES[(idx - 1 + ROLES.length) % ROLES.length];
      const prev = role;
      setRole(next.id);
      if (prev !== next.id) {
        // Phase 5 measurement: keyboard arrow nav on the desktop role strip.
        track('landing_role_changed', {
          from_role: prev,
          to_role: next.id,
          source: 'desktop_strip',
        });
      }
      requestAnimationFrame(() => {
        const btn = containerRef.current?.querySelector<HTMLButtonElement>(
          `button[data-role="${next.id}"]`,
        );
        btn?.focus();
      });
    };

  const onStripTabKeyDown = makeTabKeyDown(stripTabsRef);

  // Keyboard nav for the Solutions dropdown menu (WAI-ARIA menu pattern).
  const onMenuItemKeyDown = (e: React.KeyboardEvent<HTMLAnchorElement>, idx: number) => {
    const items = Array.from(
      solutionsPanelRef.current?.querySelectorAll<HTMLAnchorElement>('a[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSolutionsOpen(false);
      requestAnimationFrame(() => solutionsBtnRef.current?.focus());
    }
  };

  const toggleSolutions = () => {
    setSolutionsOpen((prev) => {
      const next = !prev;
      if (next) {
        // Phase 5 measurement: fire only on open, not close.
        track('landing_solutions_dropdown_opened', { active_role: role });
        // After opening, focus the first menu item.
        requestAnimationFrame(() => {
          const first =
            solutionsPanelRef.current?.querySelector<HTMLAnchorElement>('a[role="menuitem"]');
          first?.focus();
        });
      }
      return next;
    });
  };

  // 2026-05-11: theme toggle removed from landing nav; isDark / themeIcon
  // constants deleted along with the desktop + mobile toggle buttons below.

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

          {/* Primary nav links (desktop ≥768px) — Pages, not role tabs. */}
          <div className={s.primaryNav} ref={tabsRef}>
            <Link
              href="/product"
              onClick={() =>
                track('landing_nav_click', {
                  source: 'primary',
                  destination: '/product',
                  label: t('Product', 'उत्पाद'),
                  active_role: role,
                })
              }
            >
              {t('Product', 'उत्पाद')}
            </Link>
            <div className={s.dropdownWrap}>
              <button
                ref={solutionsBtnRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={solutionsOpen}
                aria-controls="welcomeV2SolutionsMenu"
                onClick={toggleSolutions}
              >
                {t('Solutions', 'समाधान')}
                <span className="chev" aria-hidden="true">▾</span>
              </button>
              {solutionsOpen ? (
                <div
                  id="welcomeV2SolutionsMenu"
                  ref={solutionsPanelRef}
                  className={s.dropdownPanel}
                  role="menu"
                  aria-label={t('Solutions', 'समाधान')}
                >
                  {SOLUTIONS.map((sol, i) => (
                    <Link
                      key={sol.href}
                      href={sol.href}
                      role="menuitem"
                      tabIndex={-1}
                      onKeyDown={(e) => onMenuItemKeyDown(e, i)}
                      onClick={() => {
                        track('landing_nav_click', {
                          source: 'primary',
                          destination: sol.href,
                          label: t(sol.en, sol.hi),
                          active_role: role,
                        });
                        setSolutionsOpen(false);
                      }}
                    >
                      <span>{t(sol.en, sol.hi)}</span>
                      {!isHi ? (
                        <span className="deva" lang="hi">
                          {sol.deva}
                        </span>
                      ) : null}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
            <Link
              href="/pricing"
              onClick={() =>
                track('landing_nav_click', {
                  source: 'primary',
                  destination: '/pricing',
                  label: t('Pricing', 'मूल्य'),
                  active_role: role,
                })
              }
            >
              {t('Pricing', 'मूल्य')}
            </Link>
            <Link
              href="/research"
              onClick={() =>
                track('landing_nav_click', {
                  source: 'primary',
                  destination: '/research',
                  label: t('Research', 'शोध'),
                  active_role: role,
                })
              }
            >
              {t('Research', 'शोध')}
            </Link>
            <Link
              href="/about"
              onClick={() =>
                track('landing_nav_click', {
                  source: 'primary',
                  destination: '/about',
                  label: t('About', 'हमारे बारे में'),
                  active_role: role,
                })
              }
            >
              {t('About', 'हमारे बारे में')}
            </Link>
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
            {/* Theme toggle removed 2026-05-11: landing is locked to light. */}
            <Link
              href="/login"
              className={`${s.btn} ${s.btnInk} ${s.btnArrow}`}
              onClick={() =>
                track('landing_cta_click', {
                  location: 'nav',
                  destination: '/login',
                  active_role: role,
                  language: isHi ? 'hi' : 'en',
                })
              }
            >
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

      {/* Role-tabs strip (relocated below issue bar). Tablet+ visible: the
          .roleSwitcher class itself is hidden <768px (existing rule) so on
          mobile users still pick a role through the burger menu. */}
      <div className={s.roleStrip}>
        <div className={s.wrap}>
          <div className={s.roleStripInner}>
            <span className={s.roleStripLabel}>
              {t('View this page as', 'इस पृष्ठ को इस रूप में देखें')}
            </span>
            <div
              ref={stripTabsRef}
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
                  onClick={() => {
                    const prev = role;
                    setRole(r.id);
                    if (prev !== r.id) {
                      // Phase 5 measurement: explicit user-initiated role change.
                      track('landing_role_changed', {
                        from_role: prev,
                        to_role: r.id,
                        source: 'desktop_strip',
                      });
                    }
                  }}
                  onKeyDown={(e) => onStripTabKeyDown(e, idx)}
                >
                  {t(r.en, r.hi)}
                </button>
              ))}
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
                    const prev = role;
                    setRole(r.id);
                    setMenuOpen(false);
                    if (prev !== r.id) {
                      // Phase 5 measurement: role switched via mobile burger.
                      track('landing_role_changed', {
                        from_role: prev,
                        to_role: r.id,
                        source: 'mobile_burger',
                      });
                    }
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
              {/* Mobile theme toggle removed 2026-05-11: landing locked to light. */}
            </div>
          </div>

          <nav className={s.menuNav} aria-label={t('Sections', 'अनुभाग')}>
            {(
              [
                { href: '#stats', num: '01', en: 'By the numbers', hi: 'आँकड़ों में' },
                { href: '#mission', num: '02', en: 'What we are building', hi: 'हम क्या बना रहे हैं' },
                { href: '#how', num: '03', en: 'What changes', hi: 'क्या बदलता है' },
                { href: '#showcase', num: '04', en: 'Inside the product', hi: 'उत्पाद के अंदर' },
                { href: '#trust', num: '05', en: 'Voices', hi: 'आवाज़ें' },
                { href: '#pricing', num: '06', en: 'Plans & pricing', hi: 'योजनाएँ' },
                { href: '#faq', num: '07', en: 'Common questions', hi: 'सामान्य प्रश्न' },
                { href: '#cta', num: '08', en: 'Begin a session', hi: 'शुरू कीजिये' },
              ] as const
            ).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  track('landing_nav_click', {
                    source: 'mobile_sections',
                    destination: item.href,
                    label: t(item.en, item.hi),
                    active_role: role,
                  });
                  setMenuOpen(false);
                }}
              >
                <span className="num">{item.num}</span>
                {t(item.en, item.hi)}
              </Link>
            ))}
          </nav>

          <nav className={s.menuNav} aria-label={t('Pages', 'पृष्ठ')}>
            {(
              [
                { href: '/product', num: 'A', en: 'Product', hi: 'उत्पाद' },
                { href: '/for-parents', num: 'B', en: 'For Parents', hi: 'अभिभावकों के लिए' },
                { href: '/for-teachers', num: 'C', en: 'For Teachers', hi: 'शिक्षकों के लिए' },
                { href: '/for-schools', num: 'D', en: 'For Schools', hi: 'विद्यालयों के लिए' },
                { href: '/pricing', num: 'E', en: 'Pricing', hi: 'मूल्य' },
                { href: '/research', num: 'F', en: 'Research', hi: 'शोध' },
                { href: '/about', num: 'G', en: 'About', hi: 'हमारे बारे में' },
                { href: '/help', num: 'H', en: 'Help', hi: 'सहायता' },
                { href: '/contact', num: 'I', en: 'Contact', hi: 'संपर्क' },
              ] as const
            ).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  track('landing_nav_click', {
                    source: 'mobile_pages',
                    destination: item.href,
                    label: t(item.en, item.hi),
                    active_role: role,
                  });
                  setMenuOpen(false);
                }}
              >
                <span className="num">{item.num}</span>
                {t(item.en, item.hi)}
              </Link>
            ))}
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
