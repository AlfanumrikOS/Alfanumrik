'use client';

import Link from 'next/link';
import { useWelcomeV2 } from './WelcomeV2Context';
import s from './welcome-v2.module.css';

interface Col {
  headEn: string;
  headHi: string;
  links: { label: { en: string; hi: string }; href: string }[];
}

const COLS: Col[] = [
  {
    headEn: 'Product',
    headHi: 'उत्पाद',
    links: [
      { label: { en: 'Foxy tutor', hi: 'फ़ॉक्सी शिक्षक' }, href: '/foxy' },
      { label: { en: 'Mastery x-ray', hi: 'महारत एक्स-रे' }, href: '/progress' },
      { label: { en: 'Parent dashboard', hi: 'अभिभावक डैशबोर्ड' }, href: '/parent' },
      { label: { en: 'Teacher portal', hi: 'शिक्षक पोर्टल' }, href: '/teacher' },
      { label: { en: 'For schools', hi: 'विद्यालयों के लिए' }, href: '/for-schools' },
      { label: { en: 'Pricing', hi: 'मूल्य' }, href: '/pricing' },
    ],
  },
  {
    headEn: 'Company',
    headHi: 'कम्पनी',
    links: [
      { label: { en: 'About', hi: 'हमारे बारे में' }, href: '/about' },
      { label: { en: 'Founder note', hi: 'संस्थापक का नोट' }, href: '/about' },
      { label: { en: 'Press', hi: 'प्रेस' }, href: '/about' },
      { label: { en: 'Contact', hi: 'सम्पर्क' }, href: '/contact' },
    ],
  },
  {
    headEn: 'Legal',
    headHi: 'क़ानूनी',
    links: [
      { label: { en: 'Privacy', hi: 'गोपनीयता' }, href: '/privacy' },
      { label: { en: 'Terms', hi: 'शर्तें' }, href: '/terms' },
      { label: { en: 'Refunds', hi: 'धन-वापसी' }, href: '/terms' },
      { label: { en: 'Security', hi: 'सुरक्षा' }, href: '/security' },
    ],
  },
];

export default function FooterV2() {
  const { isHi, t } = useWelcomeV2();
  return (
    <footer className={s.footer} aria-labelledby="footer-v2-title">
      <h2 id="footer-v2-title" className={s.srOnly}>
        {t('Site footer', 'साइट फ़ुटर')}
      </h2>
      <div className={s.wrap}>
        <div className={s.footerGrid}>
          <div className={s.footerBrand}>
            <div className="name">
              Alfanumrik<sup>TM</sup>
            </div>
            <div className="tag">
              {t(
                'A learning workbook for the Indian home — bilingual, honest, and small enough to fit in ten minutes.',
                'भारतीय घर के लिए एक सीखने की कार्यपुस्तिका — द्विभाषी, ईमानदार, दस मिनट में पूरी।',
              )}
            </div>
            <div className="deva" lang="hi">
              अल्फ़ान्यूमरिक · भारत में, भारत के लिए, बच्चों के साथ बनाया गया।
            </div>
          </div>

          {COLS.map((col, i) => (
            // Mobile uses native <details> collapse; tablet+ CSS overrides
            // to force the column open visually. No `open` attribute needed.
            <details key={i} className={s.footAcc}>
              <summary>{t(col.headEn, col.headHi)}</summary>
              <ul>
                {col.links.map((link, li) => (
                  <li key={li}>
                    <Link href={link.href}>
                      {isHi ? link.label.hi : link.label.en}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>

        <div className={s.footerFoot}>
          <div>© 2026 Cusiosense Learning India Pvt. Ltd.</div>
          <div>CIN U85499KA2024PTC182441 · GSTIN 29AAJCC4851N1ZD</div>
          <div>{t('Bengaluru · 560034', 'बेंगलुरु · 560034')}</div>
        </div>
      </div>
    </footer>
  );
}
